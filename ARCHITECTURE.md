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

**How context biases downstream decisions:** `Context` is threaded through
`generateCandidates` and `scoreCandidate` and is surfaced in the demo header
(aspect / attention / touch / far) — but it also genuinely changes both the
element sizes requested (§4, "Context-aware sizing") and which strategy wins
(§4, "contextFit sub-score").

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
layoutFn, growAxes)`, so priority ordering and shrink/drop/grow logic live in
exactly one place. Resolution order is canonical: `priority` ascending, then
`id` ascending as a tie-break (`orderedRequests`).

### Grow into slack (§4c — comparative analysis, `Adaptive-Resizing-Logic.md`)

A companion analysis compared this project's resizing approach against three
other independent implementations of the same brief. The one capability
present in another project (a two-pass "measure, then redistribute leftover
space" allocator) and genuinely absent here was: **every element only ever
shrank toward its preferred size, never grew past it** — a spacious surface
left dead whitespace around a small element instead of using the room. That
gap is now closed, scoped conservatively:

* Each strategy declares which axes are safe to grow (`GrowAxes`, passed to
  `placeElementsInOrder`) — safe meaning the strategy's own slot ceiling on
  that axis is independent per element, never reduced by what a sibling did:
  * `vertical-stack`: width is free (every element sees the same `box.width`);
    height is the cascading, cursor-based axis and stays shrink-only.
  * `horizontal-split`: the mirror — height is free, width is cascading.
  * `grid`: both axes are free (cell geometry comes from row/col alone).
  * `overlay-safe-margins`: **opts out entirely** — a right/bottom-anchored
    corner's own `x`/`y` is derived from its own final width/height
    (`box.width - w`), so growing would also require re-deriving position;
    not worth the coupling for a strategy whose whole point is hugging the
    margin, not filling space.
* Growth is capped at `GROWTH_CAP_FACTOR = 1.4` × the element's **own**
  preferred size (not "fill the whole slot") — a small CTA on a 1920px-wide
  broadcast surface becomes a nicely-sized button, not an edge-to-edge bar.
  Being relative to each element's own preferred also means two elements with
  different preferred sizes (e.g. a far-viewing-inflated headline vs. a near
  one) still end up different sizes after growth, not both maxed at the same
  slot ceiling.
* `brandRules.locked` elements are exempt — growth is skipped entirely
  (`request.locked`), so a locked logo never balloons past its declared
  `preferredSize`, preserving the existing brand-lock guarantee in
  `constraintViolationsScore` exactly as before.
* `sizeAxis(preferred, slotMax, canGrow)` unifies both directions: shrink-only
  is `Math.min(preferred, slotMax)`; growable is `Math.min(slotMax,
  preferred × 1.4)` — when `preferred > slotMax` (needs shrinking) the second
  form still resolves to `slotMax`, so growth and shrink share one formula.
* The Layout Debugger gets a third note type alongside shrink/drop —
  `growNote()` — e.g. `headline: wanted 411×96, grew to 411×134 (+40%) — extra
  room available`, shown with a ✓ rather than the shrink note's ⚠️.

Verified live: on `mobileLandscape` (844×390), `horizontal-split` wins and
both `headline` and `cta` grow 40% in height (the free axis there) — visibly
bigger, more confident copy on a screen with genuine room, not just
avoiding overflow on a small one. `candidates.test.ts` ("grow into slack,
capped, brand-lock exempt") asserts all of the above, including that the hard
non-overlap/in-bounds invariants still hold for every strategy with growth
active.

**What was deliberately NOT ported** from the same analysis, and why:
* A different project's "only keep a drop if it measurably raised the score"
  retry loop — doesn't map cleanly onto strategy-vs-strategy selection (our
  architecture picks between complete candidates, it doesn't retry drops
  within one); the complexity wasn't worth it for the same outcome our
  scoring already achieves.
* A different project's proportional-to-content-rect sizing (e.g. `fontSize =
  contentHeight × 0.28`) instead of advertiser-declared `minSize`/`preferredSize`
  — a deliberate, tested architectural choice here (§6), not an oversight;
  proportional formulas trade away the "advertiser states intent, engine
  respects it" guarantee this project is built around.
* A 13-step graduated degradation pipeline (tighten spacing → hide decorative
  content → shrink CTA, in measured-impact order) — explicitly the kind of
  scope the project brief warns against over-engineering (§4.4's "lightweight,
  not a general-purpose solver"); the existing single-pass shrink-then-drop
  cascade already has a documented, tested degradation order (§5).

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

### Context-aware sizing (§4.3-context)

After the base preferred size is computed (from `measureText`, `preferredSize`,
or the fallback), `toRequest(node, context)` applies up to two more
context-derived multipliers, in order, before the request is handed to a
strategy:

```ts
const FAR_VIEWING_TEXT_SCALE = 1.3;  // legibility at a distance
const TOUCH_TARGET_SCALE = 1.15;     // a genuinely bigger CTA, not just tap-target-legal

if (context.isFarViewing && (node.type === "text" || node.type === "button")) {
  preferred = { width: ceil(preferred.width * FAR_VIEWING_TEXT_SCALE), height: ceil(preferred.height * FAR_VIEWING_TEXT_SCALE) };
}
if (context.isTouchInteractive && node.interaction === "clickable") {
  preferred = { width: ceil(preferred.width * TOUCH_TARGET_SCALE), height: ceil(preferred.height * TOUCH_TARGET_SCALE) };
}
```

Only `text`/`button` elements inflate on far viewing — an `image`'s
`preferredSize` already **is** its intended on-screen size, not a proxy for
rendered type that should grow. Only `interaction: "clickable"` elements
inflate on touch — this is what makes a phone's CTA visibly bigger than the
same CTA on a remote-driven broadcast surface (§4.14), on top of whatever
`surface.minTapTarget` already requires. `min` is never scaled — the
advertiser's declared floor is unchanged, so a bigger *preferred* size only
means the element is more likely to shrink or push out lower-priority content,
never that a previously-valid layout becomes invalid. This is real on the
sample ad: mobilePortrait's CTA (touch) is `230×65` instead of the
undeclared-context `200×56`; broadcastLowerThird's headline (far-viewing) is
`546×125` instead of `420×96` — verified live, not just asserted (see
`candidates.test.ts`, "context-aware element sizing").

### ScoreBreakdown sub-scores and weights (quoted from `src/core/scoring.ts`)

```ts
const WEIGHTS = {
  constraintViolations: 0.32,
  priorityPreservation: 0.28,
  tapTargetCompliance: 0.14,
  contextFit: 0.1,
  visualBalance: 0.1,
  renderCost: 0.06,
} as const;                       // sum = 1

const VIOLATION_PENALTY = 25;     // points off constraintViolations per soft violation
const EPS = 0.5;
```

| sub-score (0–100) | how it is computed |
|---|---|
| `constraintViolations` | `100 − 25 × (violation count)`, floored at 0. One violation per visible element that: sits outside the surface **safe area**; was forced below its spec `minSize`; is `brandRules.locked` but resized away from `preferredSize`; or is `interaction:"clickable"` but smaller than `surface.minTapTarget` on either axis. |
| `priorityPreservation` | each node weighted `(maxPriority − priority + 1)` (priority 1 worth most); score = % of total weight still `visible`. |
| `tapTargetCompliance` | `100` if the surface has no `minTapTarget` or no interactive element is visible; else % of visible `clickable` elements meeting the minimum on **both** axes. |
| `contextFit` | §4.3-context / §4.14 — see below. |
| `visualBalance` | `0.65 × centreScore + 0.35 × evenScore`. `centreScore` = how close the area-weighted centroid of visible elements is to the centre of the usable box (`1 − offset/halfDiagonal`). `evenScore` = `1 − min(coefficient of variation of element areas, 1)`. |
| `renderCost` | `rawCost = 5 × visibleCount + 20 × (1 − min(avgFrac × 4, 1))` where `avgFrac` = mean element area as a fraction of the usable box; `score = clamp(100 − rawCost, 0, 100)`. Fewer / larger elements are cheaper. |
| `overall` | `Math.round(Σ subScore × weight)`, **or `0` on a hard-fail**. |

#### contextFit sub-score (`contextFitScore`, `src/core/scoring.ts`)

The direct answer to "how does context change *which layout wins*, not just
how big things are drawn". Starts at a neutral `60` and applies named,
independent bonuses/penalties — every one traceable to a specific `Context`
flag, so a counterfactual explanation is never an opaque number:

| rule | condition | effect |
|---|---|---|
| shape match | `aspectRatioClass: "wide"` | `+20` horizontal-split, `+10` grid, `−15` vertical-stack |
| shape match | `aspectRatioClass: "tall"` | `+20` vertical-stack, `+5` grid, `−15` horizontal-split |
| shape match | `aspectRatioClass: "square"` | `+10` grid or overlay-safe-margins |
| quick glance | `attentionBudget: "short"` | `+` up to `20`, shrinking by `4` per visible element — rewards fewer, larger elements |
| across the room | `isFarViewing` | `+` up to `12`, shrinking by `3` per visible element — same "fewer, larger" logic, passively |
| thumb reach | `isTouchInteractive` and strategy is `overlay-safe-margins` | `−10` — spreading targets into the four corners is harder to reach than a stacked/split column |

Result clamped to `[0, 100]`. Depends only on `candidate.strategy`, the
candidate's visible-element count, and the (already-pure) `Context` — never on
`surface`, so it is exactly as deterministic as every other sub-score
(`scoring.test.ts` asserts this directly). This is what flipped
broadcastLowerThird's winning strategy from `grid` to `horizontal-split` after
this was added — a wide, far-viewing surface now genuinely prefers the
strategy whose own geometry runs along the wide axis, not just whichever
strategy happens to pack the most pixels.

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
| passed | 129 |
| degraded | 71 |
| **failed** | **0** |
| robustness (passed / total) | **64.5%** |

Repeated unseeded runs land in a **62–68%** "robustness" band and, in every run,
**0 failed**. This band moved up from the pre-`contextFit` **49–54%** band once
§4.3-context started genuinely biasing which strategy wins (a context-suited
strategy clears the 70-point quality bar more often) — a real, measured
improvement, not a re-tuned threshold. The number that matters for correctness
is `failed = 0`: across 200 adversarial surfaces including `3840×2160` and
`120×2000`, the hard-invariant guarantee from §4 held every time. The
robustness figure is the *quality* bar (score ≥ 70), not a correctness bar —
see §10 for why that metric is soft.

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
| whole ad on a 240×260 touch panel | normal shrink-then-drop cascade (§5), now picking `grid` — a square-ish, touch surface earns `grid` a `contextFit` bonus over `vertical-stack`, and packing 2-D fits all four elements where the old 1-D stack dropped the logo |
| second locale swaps the CTA for a ~40%-longer German string | measured, not guessed, then touch-inflated on top (§4.3-context) |

The demo shows the naive resolver's attempt (overlapping / clipped) beside the
recovered layout, a brief *"Layout invalid — re-optimizing…"* beat, then the
recovered result with the Phase 4 `LayoutDebugger` panel (reused verbatim) fed a
trace whose per-element notes are augmented with the placeholder decisions.

**Verified in the regression sweep (English locale):** `grid`, **4/4 elements
visible** — headline shrunk 92% to 120×120, CTA shrunk 71% to a touch-inflated
120×65 (from a measured 409×65 want), hero and logo both rendered as
placeholder boxes in their slots, zero overlaps. Before `contextFit` existed,
the same input resolved to `vertical-stack` with only 3/4 visible (logo
dropped) — the context-aware strategy choice is a strictly better outcome here,
not just a different one. The resolver test asserts the self-healing scenario
produces a layout with zero overlaps / out-of-bounds **and**
`cta.visible === true` despite everything else going wrong.

---

## 10. Limitations + what I'd improve with more time

* **`contextFit`'s bonus/penalty magnitudes are hand-chosen, not tuned.** The
  `+20` / `−15` shape-match numbers and the scale factors (`1.3` far-viewing,
  `1.15` touch) are reasoned, documented constants (§4), not the output of any
  search or calibration against real ad performance data. They move the
  Stress Lab's robustness band up by ~15 points in the expected direction,
  which is evidence they point the right way, not proof they're optimal.
* **Only two placement dimensions are context-scaled** (far-viewing text/button
  size, touch CTA size). The plan also calls out `attentionWindow` changing
  *which elements* appear at all (not just sizing) and richer touch affordances
  (spacing, thumb-zone placement) — `contextFit`'s attention/far bonuses reward
  a strategy for naturally dropping to fewer elements, but nothing forces that
  outcome directly.
* **Candidate generation is still 4 fixed strategies, not a search.** No
  parameter sweep (gutters, alignment, orientation), no packing/bin-fit, no
  iterative refinement of the winner. `contextFit` picks the best of four
  context-suited candidates; it doesn't invent a fifth. That ceiling is the
  remaining "degraded" band in the Stress Lab (§8).
* **The "robustness" metric conflates quality with correctness.** `passed`
  requires `score ≥ 70`; true robustness (no hard invariant ever broken) is
  effectively 100% across every run regardless of the quality threshold. The
  ~65% headline number still understates correctness and overstates how often
  the layout is genuinely poor. I'd split the metric into "invariant-safe %"
  (the real guarantee) and "quality %".
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
* **No persistence / one hardcoded product.** The sample ad (DIOR Backstage
  Rosy Glow Stick, real photo + copy, styled as a Nykaa PDP ad) and surfaces
  are code-defined, not loaded from any catalog or CMS — swapping products
  means editing `sample-data.ts` by hand.
* **Font-fit is a single-pass approximation, not exact.** `SurfaceStage`'s
  `fitFontSize` scales a text element's font size by `boxHeight /
  wrappedBlockHeight` in one shot (reusing `measureTextBlock`) rather than
  iterating to convergence — since narrower glyphs at a smaller font can
  re-wrap into fewer lines than the first estimate assumed, the fitted size is
  occasionally a shade more conservative (smaller) than the true optimum, never
  larger. Purely cosmetic: it never touches the resolved `x/y/width/height`
  the resolver actually guarantees non-overlapping.
