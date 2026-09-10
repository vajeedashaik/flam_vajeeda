# ARCHITECTURE

How the Adaptive Layout Engine turns one surface-independent ad spec into a
correct, genuinely different layout per surface. Every claim below is tied to a
specific file and function in `src/core/`; where a rule matters, the actual code
is quoted rather than paraphrased.

---

## 1. Resolution flow

```
                 ┌───────────────┐      ┌────────────────┐
   AdSpec ──────▶│  buildGraph   │─────▶│ ExperienceGraph│
 (defineAd)      │   graph.ts    │      │ nodes + edges  │
                 └───────────────┘      └───────┬────────┘
                                                │
 SurfaceProfile ─▶┌───────────────┐             │
 (defineSurface)  │ resolveContext│──▶ Context  │
                  │  context.ts   │   (flags)   │
                  └───────────────┘      │      │
                                         ▼      ▼
                              ┌─────────────────────────┐
                              │   generateCandidates    │  candidates.ts
                              │  4 spatial strategies:  │
                              │  vertical-stack,        │
                              │  horizontal-split,      │
                              │  grid, overlay-safe-    │
                              │  margins                │
                              └───────────┬─────────────┘
                                          │ Candidate[]
                                          ▼
                              ┌─────────────────────────┐
                              │     scoreCandidate      │  scoring.ts
                              │  5 weighted sub-scores  │
                              │  + hard-fail → 0        │
                              └───────────┬─────────────┘
                                          │ ScoreBreakdown[]
                                          ▼
                              ┌─────────────────────────┐
                              │  resolveLayout picks    │  resolver.ts
                              │  highest overall (ties  │
                              │  → earliest = vertical- │
                              │  stack)                 │
                              └───────────┬─────────────┘
                                          │
                        ┌─────────────────┴───────────────────┐
                        ▼                                     ▼
             ┌────────────────────┐               ┌───────────────────────┐
             │  ResolvedLayout    │               │   DecisionTrace       │  trace.ts
             │  elements[] with   │               │  every candidate's    │
             │  x/y/w/h/visible   │               │  score, winner, why,  │
             │                    │               │  per-element notes     │
             └─────────┬──────────┘               └───────────┬───────────┘
                       ▼                                      ▼
             ┌────────────────────┐               ┌───────────────────────┐
             │  SurfaceStage.tsx  │               │  LayoutDebugger /      │
             │  ResolvedLayout →  │               │  Counterfactuals /     │
             │  positioned DOM    │               │  HealthCheck panels    │
             │  (the only        │               │                       │
             │  renderer today)   │               │                       │
             └────────────────────┘               └───────────────────────┘
```

`resolveLayout(graph, context, surface)` in [`src/core/resolver.ts`](src/core/resolver.ts)
is the whole orchestration:

```ts
const candidates = generateCandidates(graph, context, surface);
const scores = candidates.map((candidate) =>
  scoreCandidate(candidate, graph, context, surface),
);

let winningIndex = 0;
for (let i = 1; i < scores.length; i++) {
  if (scores[i]!.overall > scores[winningIndex]!.overall) {
    winningIndex = i;
  }
}

const winner = candidates[winningIndex]!;
const trace = buildTrace(candidates, scores, winningIndex);
return { layout: { elements: winner.elements }, trace };
```

There is **no per-surface branching anywhere in this path**. `resolver.ts`,
`candidates.ts` and `scoring.ts` contain zero surface ids and zero ad-element
ids; `resolver.test.ts` enforces this with a source-level regex check.

---

## 2. Experience Graph design (`src/core/graph.ts`)

### Node structure

`GraphNode extends AdElement` — every Phase-1 field is carried through verbatim,
plus a computed `edges` array:

```ts
export interface GraphNode extends AdElement {
  /** Every edge that touches this node (as `from` or as `to`). */
  edges: GraphEdge[];
}
```

`AdElement` (from [`src/core/spec.ts`](src/core/spec.ts)) fields:

| field | type | meaning |
|---|---|---|
| `id` | `string` | unique within the spec |
| `type` | `"text" \| "image" \| "button"` | closed union |
| `role` | `"primary" \| "hero" \| "action" \| "branding" \| "secondary"` | closed union |
| `priority` | `number` (positive) | lower = more critical |
| `importance?` | `"critical" \| "should-survive" \| "nice-to-have"` | |
| `interaction?` | `"clickable" \| "static"` | |
| `visibility?` | `"always" \| "degradable" \| "decorative-only"` | drives the drop order |
| `minSize?` | `{ width; height }` | hard floor for shrinking |
| `preferredSize?` | `{ width; height }` | target size |
| `brandRules?` | `{ locked?; minSize? }` | `locked` forbids resize away from preferred |
| `text?` | `string` | literal string; when present it is measured, not guessed (Phase 5) |
| `fontSize?` | `number` | px, used when measuring `text` (default 16) |
| `src?` | `string` | image source; missing/broken → placeholder box, slot kept |

### Edge types

`GraphEdgeType = "proximity" | "alignment" | "exclusion"`. Edges are conceptually
undirected; `from`/`to` are filled in spec-element order so the same spec always
produces the same edge list.

### Derivation rule set (quoted from `buildGraph`)

```ts
// Rule P — proximity between each "secondary" and each "action".
for (const secondary of elementsWithRole("secondary")) {
  for (const action of elementsWithRole("action")) {
    edges.push({ from: secondary.id, to: action.id, type: "proximity" });
  }
}

// Rule X — exclusion between each "hero" and each "branding".
for (const hero of elementsWithRole("hero")) {
  for (const branding of elementsWithRole("branding")) {
    edges.push({ from: hero.id, to: branding.id, type: "exclusion" });
  }
}
```

* **Rule P (proximity):** secondary content (price, disclaimer, rating) is only
  meaningful directly beside the call-to-action it qualifies, so downstream
  phases must evaluate the pair together.
* **Rule X (exclusion):** the hero is the focal visual and branding is a
  persistent mark; they must never overlap on any surface.
* **`alignment`** edges are part of the type but are not auto-derived yet.

The rules are keyed on `role` only — never on specific ids — so they generalise
to any spec built with `defineAd()`. `getRelatedNodes(graph, nodeId, edgeType?)`
is the read helper for downstream code.

---

## 3. Context Engine (`src/core/context.ts`)

`resolveContext(surface)` collapses a rich `SurfaceProfile` into six qualitative
flags. Every threshold is a named constant at the top of the file:

```ts
const ASPECT_TALL_MAX_RATIO = 0.8;   // width/height ≤ 0.8  → "tall"
const ASPECT_WIDE_MIN_RATIO = 1.25;  // width/height ≥ 1.25 → "wide"; between → "square"
const FAR_VIEWING_MIN_CM = 100;      // numeric viewingDistance ≥ 100cm → far
const ATTENTION_SHORT_MAX_S = 3;     // attentionWindow ≤ 3s  → "short"
const ATTENTION_LONG_MIN_S = 15;     // attentionWindow ≥ 15s → "long"; between → "medium"
const ATTENTION_DEFAULT = "medium";  // when the surface declares no attentionWindow
```

| Context field | derived from | rule |
|---|---|---|
| `aspectRatioClass` | `width / height` | `≤ 0.8` tall · `≥ 1.25` wide · else square |
| `isTouchInteractive` | `touchOnly === true \|\| interaction === "touch"` | |
| `isFarViewing` | `viewingDistance` | `"far"` → true; number `≥ 100` (cm) → true; `"near"`/absent → false |
| `attentionBudget` | `attentionWindow` (seconds) | `≤ 3` short · `≥ 15` long · else medium · absent → medium |
| `hasAudio` | `audio === true` | defaults false — never assume audio is usable |
| `allowsMotion` | `motion === true` | defaults false — never assume motion is usable |

**How context currently biases downstream decisions:** `Context` is threaded
through `generateCandidates` and `scoreCandidate` (stable signature), and is
surfaced in the demo header (aspect / attention / touch / far). The scoring and
placement math today is pure geometry plus each element's role / priority /
declared minimums — `context` is accepted but not yet read by the scorer
(`void context;` in both files). This is a deliberate, documented seam: the plumbing
is in place so context-biased placement can be added without changing any
signatures. See §10.

---

## 4. Candidate generation + scoring

### Strategies actually implemented (`src/core/candidates.ts`)

`generateCandidates()` **always** returns all four (≥ 3 required) so the scorer
has a real choice:

| strategy | geometry |
|---|---|
| `vertical-stack` | one column, elements stacked top→bottom, each as wide as the usable box; the safe priority-ordered fallback and the tie-break winner |
| `horizontal-split` | one row, elements left→right, each as tall as the box |
| `grid` | row-major grid of `ceil(sqrt(n))` columns, each element clamped to its cell |
| `overlay-safe-margins` | four elements anchored to the four corners (`tl, br, tr, bl`), each capped at half the box per axis so corners can't overlap; the two highest-priority elements land in **opposite** corners; a 5th element and beyond are dropped |

All four run through one shared engine, `placeElementsInOrder(requests, box,
layoutFn)`, so priority ordering and shrink/drop logic live in exactly one place.
Resolution order is canonical: `priority` ascending, then `id` ascending as a
tie-break (`orderedRequests`).

Text/button elements that carry a literal `text` string are sized from a real
`measureText()` pass (`src/core/text-measure.ts`) instead of `preferredSize`:

```ts
if ((node.type === "text" || node.type === "button") && node.text !== undefined) {
  const fontSize = node.fontSize ?? DEFAULT_FONT_SIZE;      // 16
  const measuredWidth = Math.ceil(measureTextWidth(node.text, fontSize));
  const lineHeight = Math.ceil(fontSize * LINE_HEIGHT_FACTOR); // 1.3
  preferred = {
    width: Math.max(measuredWidth, node.minSize?.width ?? 0),
    height: Math.max(lineHeight, node.minSize?.height ?? 0, node.preferredSize?.height ?? 0),
  };
}
```

### ScoreBreakdown sub-scores and weights (quoted from `src/core/scoring.ts`)

```ts
const WEIGHTS = {
  constraintViolations: 0.35,
  priorityPreservation: 0.3,
  tapTargetCompliance: 0.15,
  visualBalance: 0.12,
  renderCost: 0.08,
} as const;                       // sum = 1

const VIOLATION_PENALTY = 25;     // points off constraintViolations per soft violation
const EPS = 0.5;
```

| sub-score (0–100) | how it is computed |
|---|---|
| `constraintViolations` | `100 − 25 × (violation count)`, floored at 0. One violation per visible element that: sits outside the surface **safe area**; was forced below its spec `minSize`; is `brandRules.locked` but resized away from `preferredSize`; or is `interaction:"clickable"` but smaller than `surface.minTapTarget` on either axis. |
| `priorityPreservation` | each node weighted `(maxPriority − priority + 1)` (priority 1 worth most); score = % of total weight still `visible`. |
| `visualBalance` | `0.65 × centreScore + 0.35 × evenScore`. `centreScore` = how close the area-weighted centroid of visible elements is to the centre of the usable box (`1 − offset/halfDiagonal`). `evenScore` = `1 − min(coefficient of variation of element areas, 1)`. |
| `tapTargetCompliance` | `100` if the surface has no `minTapTarget` or no interactive element is visible; else % of visible `clickable` elements meeting the minimum on **both** axes. |
| `renderCost` | `rawCost = 5 × visibleCount + 20 × (1 − min(avgFrac × 4, 1))` where `avgFrac` = mean element area as a fraction of the usable box; `score = clamp(100 − rawCost, 0, 100)`. Fewer / larger elements are cheaper. |
| `overall` | `Math.round(Σ subScore × weight)`, **or `0` on a hard-fail**. |

### Hard-fail rule (quoted)

```ts
const hardFail =
  vis.length === 0 ||
  anyOverlap(vis) ||
  anyOutOfSurface(vis, surface) ||
  dropsAnAlwaysElement(candidate, byId) ||
  hasPriorityInversion(candidate, byId);
```

`overall` becomes `0` (sub-scores still reported, for the trace) when the
candidate: renders nothing; has **any** overlap between visible elements; has
**any** visible element off the surface bounds (`x < −0.5`, `y < −0.5`,
`x + w > surface.width + 0.5`, `y + h > surface.height + 0.5`); drops an element
the spec marks `visibility: "always"`; or shows a lower-priority element while a
higher-priority one was dropped (priority inversion). A hard-fail candidate can
never win — this is the invariant the Stress Lab verifies end-to-end (§8).

`scoreCandidate` is pure: a determinism test calls it twice with identical inputs
and asserts identical output. No `Date`, no `Math.random`, no I/O.

---

## 5. Priority / degradation logic

This is the shrink-then-drop cascade in `placeElementsInOrder`
([`src/core/candidates.ts`](src/core/candidates.ts)), invoked once per strategy;
`resolver.ts` then scores the results and picks one. Step by step, for each
element **in priority order** (`priority` asc, `id` asc):

1. **If the cascade flag is set** (a higher-priority element already failed to
   fit): push the element as `visible: false`, add a `dropped` note, continue.
2. **Ask the strategy for a slot** — `{ x, y, maxWidth, maxHeight }` or `null`.
   `null` → set the cascade flag, drop this element, continue.
3. **Shrink to fit the slot:** `width = min(preferred.width, slot.maxWidth)`,
   `height = min(preferred.height, slot.maxHeight)`. Shrinking never goes below
   the element's declared `min` (that is checked in the next step, not clamped).
4. **Fit test** — the element is placed only if **all** hold:
   * `slot.maxWidth > 0 && slot.maxHeight > 0`
   * `width ≥ request.min.width − EPS` and `height ≥ request.min.height − EPS`
     (`EPS = 0.001` here) — i.e. it did **not** have to shrink below `minSize`
   * it is fully inside the usable box (`withinBox`)
   * it does **not** overlap any already-placed visible element
5. **If the fit test fails:** set the cascade flag, push the element as
   `visible: false`, add a `dropped` note, continue. (So once one element can't
   fit, every lower-priority element after it is also dropped — a strict
   priority-monotone cascade. A higher-priority element never loses its place to
   a lower-priority one.)
6. **If it fits but was shrunk** (`width < preferred.width − EPS` or
   `height < preferred.height − EPS`): add a `shrunk N%` note.
7. Push the placed element (`visible: true`).

Notes produced here become `DecisionTrace.perElementNotes` for the **winning**
candidate only. Example strings, verbatim from the code:

* `logo: wanted 96×32, placed at 80×32 → shrunk 17%`
* `price: dropped — priority 4, no room left once every higher-priority element was placed`

Because a candidate that drops an element marked `visibility: "always"`
hard-fails to `0` in scoring (§4), the effective degradation order is:
**decorative / degradable / lower-priority elements shrink then drop first;
`visibility:"always"` elements stay** (they may shrink, never disappear).

---

## 6. TypeScript design

### Closed unions

```ts
export type ElementRole = "primary" | "hero" | "action" | "branding" | "secondary";
export type ElementType = "text" | "image" | "button";
export type ElementImportance = "critical" | "should-survive" | "nice-to-have";
export type ElementInteraction = "clickable" | "static";
export type ElementVisibility = "always" | "degradable" | "decorative-only";
export type ViewingDistance = "near" | "far" | number;
export type SurfaceInteractionMode = "none" | "touch" | "remote";
```

None of these is `string`. A typo in a literal spec object is a compile error,
not a value that flows through the resolver and misbehaves at runtime.

### Factory functions

`defineAd(config)` and `defineSurface(config)` are the only supported way to
build a spec / surface. They validate at construction time and throw a **named,
specific** error (`AdSpecValidationError` / `SurfaceValidationError`) identifying
the offending element and field:

* `defineAd` — valid role from the union; no duplicate ids; every `priority` a
  positive finite number; at least one element.
* `defineSurface` — `width`/`height` positive; optional numeric fields positive
  when present; `safeArea` insets non-negative; **cross-field:**
  `touchOnly === true` requires a positive `minTapTarget`.

The cross-field rule is what the "unknown surface" demo trips when you tick
touchOnly and leave minTapTarget blank — the real error text is shown verbatim:

```
Surface "unknown-…" is touchOnly but defines no minTapTarget.
A touch-only surface must specify minTapTarget (px).
```

### Compiler-error example (captured Phase 1, in `src/core/spec.invalid-example.ts.txt`)

```ts
export const brokenAd = defineAd({
  id: "broken-ad",
  elements: [
    { id: "headline", type: "text", role: "primry", priority: 1 }, // <-- typo
  ],
});
```

```
src/core/scratch.ts(9,7): error TS2820: Type '"primry"' is not assignable
to type 'ElementRole'. Did you mean '"primary"'?
(process exits with code 2)
```

Other rejections in the same vein: `type: "img"` → TS2322 (valid:
`"text" | "image" | "button"`); `importance: "meh"` → TS2322; `priority: "1"` →
TS2322 (string vs number); missing `role` → TS2741. The file is stored as
`.ts.txt` and excluded in `tsconfig.json` so it never breaks the build.

`tsconfig.json` is `strict` plus `noUncheckedIndexedAccess`,
`exactOptionalPropertyTypes`, `noUnusedLocals`, `noUnusedParameters`,
`noFallthroughCasesInSwitch`.

---

## 7. Extensibility proof

### Can a new surface be added without touching resolver.ts / candidates.ts / scoring.ts?

**Yes.** A surface is just a `SurfaceProfile` value produced by
`defineSurface()`. Every strategy in `candidates.ts` is parameterised only by
`surface.width`, `surface.height`, `surface.safeArea` and each element's role /
priority / size constraints; scoring reads only geometry plus `minTapTarget` /
`safeArea`. There is no surface-id switch anywhere in the resolution path, and
`resolver.test.ts` fails the build if one is introduced. The **"unknown surface"
demo** is the live proof: it takes six numbers typed into a form, calls
`defineSurface()`, and runs the *exact same* `buildGraph → resolveContext →
resolveLayout` path — no new code branch — and the layout resolves. The
regression sweep did this with a 2600×360 ultra-wide touch surface that is not
one of the five samples; it resolved to a `grid` layout, 5/5 elements visible,
zero console errors.

### Can a new renderer (Canvas) be added without touching those files?

**Structurally yes, and the seam already exists — but a Canvas renderer was not
built.** `resolveLayout` returns a plain data `ResolvedLayout`
(`{ elements: { id, x, y, width, height, visible, role }[] }`) with no DOM or
React in it. Today exactly one consumer turns that into pixels:
`src/components/SurfaceStage.tsx`. `src/core/render-dom.ts` is a deliberate stub
left from Phase 2 with a header comment stating it will hold the
framework-agnostic construction once React is a thin wrapper. A Canvas renderer
would be a second consumer of the same `ResolvedLayout` contract and would not
require any change to `resolver.ts` / `candidates.ts` / `scoring.ts`. Honest
caveat: because it wasn't actually implemented, the claim rests on the shape of
the contract, not on a demonstrated port.

---

## 8. Stress test methodology + results

`src/core/stress-lab.ts`.

**`generateRandomSurfaces(count, rng = Math.random)`** builds `count` valid
`SurfaceProfile`s:

* 25% of surfaces take a dimension from a fixed `EXTREME_DIMENSIONS` list
  (`100×600`, `3840×400`, `200×200`, `3840×2160`, `320×50`, `120×2000`,
  `2400×180`); the rest get fully random `width ∈ [100, 3840]`,
  `height ∈ [120, 2400]`.
* random `touchOnly`; **if `touchOnly` then a valid `minTapTarget` is always
  included** so Phase 1 cross-field validation never throws during generation;
  random `viewingDistance` (`near` / `far` / `30–400` cm / absent); random
  `attentionWindow` (`1–60` s, present 70% of the time).
* every profile is run through `defineSurface()` before being returned.
* a seeded `mulberry32` PRNG (`seededRng`) is available so test runs are
  reproducible; the Stress Lab UI uses unseeded `Math.random`.

**`runStressTest(spec, surfaces)`** builds the graph once, then for every
surface runs the real `resolveContext → resolveLayout`, takes the visible
elements, and checks hard invariants with `findInvariantViolation()` — a bounds
+ overlap check written **independently of `scoring.ts`** so it is a genuine
cross-check, not the scorer asserting about itself. Tiers:

* **failed** — a hard invariant was actually broken end-to-end (overlap, or an
  element clipped off-surface).
* **degraded** — resolved cleanly but the winning candidate's `overall` score is
  below `DEGRADED_SCORE_THRESHOLD = 70` (documented constant; Phase 3's weighted
  score puts well-fitting layouts in the 80s–90s, so `< 70` means enough content
  was shrunk or dropped that a human reviewer would notice).
* **passed** — no violation and `overall ≥ 70`.

### Results (production build, 200 randomized surfaces)

| metric | value |
|---|---|
| total | 200 |
| passed | 106 |
| degraded | 94 |
| **failed** | **0** |
| robustness (passed / total) | **53.0%** |

Repeated seeded/unseeded runs land in a **49–54%** "robustness" band and, in
every run, **0 failed**. The number that matters for correctness is `failed = 0`:
across 200 adversarial surfaces including `3840×2160` and `120×2000`, the
hard-invariant guarantee from §4 held every time. The ~50% "robustness" figure is
the *quality* bar (score ≥ 70), not a correctness bar — see §10 for why that
metric is soft.

The unit test `stress-lab.test.ts` asserts `generateRandomSurfaces(50)` never
throws and `runStressTest` on 200 surfaces produces **zero** "failed" entries.

---

## 9. Self-healing approach

`src/core/self-healing-scenario.ts` + `src/components/SelfHealingDemo.tsx`.

The scenario deliberately triggers several failure modes at once:

| failure mode | how it is handled |
|---|---|
| headline string absurdly long for the surface | `text-measure.ts` measures the real rendered width; the placement engine shrinks it toward `minSize` and, if it still won't fit, the cascade drops lower-priority elements first — the headline (`visibility:"always"`, priority 1) is never dropped |
| hero image `src` points at an unresolvable host (`https://invalid.invalid/…`) | the element keeps its layout slot; `SurfaceStage` swaps the `<img>` for a dashed placeholder box on `onError` — no broken-image glyph, no crash |
| logo image has `src: ""` (no usable image at all) | rendered directly as a placeholder box, slot kept |
| whole ad on a 240×260 touch panel | normal shrink-then-drop cascade (§5); logo (lowest priority) is dropped |
| second locale swaps the CTA for a ~40%-longer German string | measured, not guessed; CTA shrinks 32% but stays visible |

The demo shows the naive resolver's attempt (overlapping / clipped) beside the
recovered layout, a brief *"Layout invalid — re-optimizing…"* beat, then the
recovered result with the Phase 4 `LayoutDebugger` panel (reused verbatim) fed a
trace whose per-element notes are augmented with the placeholder decisions.

**Verified in the regression sweep:** `vertical-stack`, **3/4 elements visible**,
CTA present at 240×56, logo dropped, hero shown as a placeholder box, zero
overlaps. The resolver test asserts the self-healing scenario produces a layout
with zero overlaps / out-of-bounds **and** `cta.visible === true` despite
everything else going wrong.

---

## 10. Limitations + what I'd improve with more time

* **Context is plumbed but not yet consumed by scoring.** `scoreCandidate` and
  the strategy functions take `Context` and immediately `void` it. Aspect /
  attention / far-viewing / touch classifications are computed and displayed but
  do not yet bias placement or scoring. Next step: e.g. weight `renderCost`
  higher on `attentionBudget: "short"`, bias toward `horizontal-split` on
  `aspectRatioClass: "wide"`, inflate the effective `minTextSize` on
  `isFarViewing`.
* **Candidate generation is 4 fixed strategies, not a search.** No parameter
  sweep (gutters, alignment, orientation), no packing/bin-fit, no iterative
  refinement of the winner. On some mid-size surfaces the best of four is only
  "fine" — that is exactly the ~50% "degraded" band in the Stress Lab. A real
  improvement would be a small local search seeded by the best strategy.
* **The "robustness" metric conflates quality with correctness.** `passed`
  requires `score ≥ 70`; true robustness (no hard invariant ever broken) is
  effectively 100% across every run. The 53% headline number understates
  correctness and overstates how often the layout is genuinely poor. I'd split
  the metric into "invariant-safe %" (the real guarantee) and "quality %".
* **Text measurement uses the Canvas `measureText()` API**, which is close to but
  not identical to the browser's final text layout (kerning, font fallback,
  sub-pixel rounding, `text-wrap: balance`). In the Vitest "node" environment
  there is no canvas, so a linear fallback (`length × fontSize × 0.52`) is used —
  it preserves ordering (longer string → wider) but not absolute pixels.
* **`alignment` edges are typed but never derived.** The Experience Graph only
  produces `proximity` and `exclusion` edges today; nothing consumes edge data
  for actual placement yet — edges inform which pairs *should* be co-evaluated
  but the strategies don't read them.
* **One renderer only.** `render-dom.ts` is still a stub; `SurfaceStage.tsx` is
  the sole `ResolvedLayout → pixels` path. The renderer-agnostic claim (§7) is
  sound by construction but undemonstrated. A Canvas renderer + a DOM/Canvas
  toggle is the cleanest way to prove it.
* **`overlay-safe-margins` silently caps at 4 elements** (four corners). For a
  5-element spec it always drops the 5th, so it rarely wins on the sample ad —
  acceptable as one of four options, but it is not a general strategy.
* **No persistence / no real ad content.** Specs and surfaces are code-defined
  sample data; the demo renders role-tinted boxes, not real copy or imagery
  (except the deliberately-broken self-healing images).
