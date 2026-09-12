# Adaptive Resizing Logic — How Each of the 4 Projects Actually Decides Layout

All four projects solve the same underlying problem — take one declarative ad spec and produce a correct, meaningfully different layout for whatever screen/surface dimensions it's given — but they take four genuinely different approaches to *deciding* what that layout should look like as the aspect ratio and size change. Below is each project's resizing logic defined on its own terms, followed by its specific strengths and weaknesses **for that resizing logic specifically** (not the codebase as a whole).

---

## 1. `adaptive-layout-engine` — Fixed Template Cascade + Shared Two-Pass Allocator

**How it decides layout as the screen changes:**

`selectTemplate(surface)` looks at exactly two numbers — aspect ratio (`width/height`) and total pixel count — and runs them through a fixed, ordered cascade of five thresholds to pick one of five layout archetypes:

```ts
if (aspect > 3.2)  return 'strip'      // ultra-wide lower-thirds
if (aspect > 1.25) return 'split'      // landscape: art one side, copy the other
if (aspect >= 0.8) return 'stack'      // near-square: vertical rhythm
if (pixels >= 1_000_000) return 'overlay'  // large portrait: full-bleed art + scrim
return 'column'                        // small portrait: simple vertical column
```

Once a template is chosen, every element is routed through **one shared placement primitive**, `stack()`: it splits the available track by per-role *weight* (not fixed pixel sizes), measures each slot, and — critically — does a **second pass**: whatever vertical space is left unclaimed after the first pass gets redistributed back across the slots by the same weights, so text and imagery actually grow into leftover space on a larger surface rather than leaving dead whitespace. This is the one place in any of the four projects where growing *into* extra space, not just shrinking to fit less, is a first-class part of the resize logic.

When something doesn't fit, `solve()` doesn't just drop by static priority — `pickVictim()` restricts the removal candidate pool to whichever elements *actually caused* the specific overflow that occurred, and the entire layout is recomputed from scratch after every drop (not patched). This repeats until it fits or every element that can be dropped has been.

**Pros of this resizing logic:**
- The two-pass "measure, then redistribute slack" allocation is the only mechanism among all four projects that makes a layout genuinely *use* a larger surface better, rather than just avoiding overflow on a smaller one.
- Dropping only the element(s) provably responsible for the specific overflow (rather than blind priority order) means a low-priority element that was never actually in the way is never needlessly sacrificed.
- One placement primitive (`stack()`) is reused everywhere, so there's no risk of the resize behavior diverging between templates — a fix or improvement to slot allocation instantly applies to all five templates at once.
- Resolution is pure and re-run from a clean slate every pass, so there's no state-dependent bug where an earlier drop leaves stale geometry behind.

**Cons of this resizing logic:**
- The five templates are a **fixed rule cascade**, not an adaptive search — for any given aspect ratio there is exactly one possible macro-structure, decided once and never reconsidered. An unusual aspect ratio (e.g. one that's just barely on the wrong side of the `1.25` or `0.8` boundary) gets whichever template the cascade assigns it, even if a different one would compose better — there's no mechanism to try alternatives and compare.
- All the adaptivity happens *within* a template (via `stack()`'s weighting); the template *choice itself* doesn't adapt to content — e.g. `split` is used for every landscape surface regardless of whether the spec actually has a hero image worth putting in a dedicated column.
- No scoring or quality comparison exists at all — there's no way to ask "was this the best available layout for this surface," only "did it fit."

---

## 2. `adaptive-layout-engine-1` — Candidate Generation + Weighted Scoring (Argmax)

**How it decides layout as the screen changes:**

`classify(surface)` maps raw `(width, height)` to one of **eight** archetypes (`micro`, `strip`, `banner`, `square`, `portrait`, `vertical`, `landscape`, `ultrawide`) using aspect ratio, minimum dimension, and total area together — a finer-grained classification than either of the other rule-based projects.

Instead of that archetype picking *one* template, it **gates which of six independent strategies are even allowed to compete** (`strip`, `stack`, `split`, `hero-overlay`, `sidebar`, `poster`), and each applicable strategy proposes **1–3 concrete region-map variants** of its own (e.g. `strip` proposes both a plain `logo-message-cta` line and, for wide formats with a background image, an `overlay-lower-third` variant). This produces **6–12 full candidate layouts** for a single resolve.

Every candidate is then actually placed — real text measurement and balanced line-wrapping (`text/fit.ts` tries every line count up to `maxLines` and keeps whichever minimizes visual raggedness), real focal-point-aware image cropping — and graded by an **11-rule weighted rubric** (`legibility`, `no-collision`, `containment`, `safe-area`, plus softer aesthetic rules), where hard-failure rules carry the heaviest weights specifically so they can't be outvoted by cosmetic wins. The highest-scoring candidate wins (deterministic tie-break: score → strategy affinity → name).

All the actual space-splitting math — in every strategy, for both rows and columns — funnels through one shared primitive, `solveTracks()`: a CSS-flexbox-like solver that distributes space by weight, clamps to per-track min/max, and iteratively redistributes slack from clamped tracks to the rest until it reaches a fixed point.

If the winning candidate scores below a `goodEnough` threshold (default `0.82`) or leaves a `required` element unplaced, the engine sheds one element (`nextToDrop`, priority + a fixed role-shed order) and **reruns the entire tournament** — but only keeps that drop if it measurably raised the score; otherwise it's discarded and the original stands.

**Pros of this resizing logic:**
- This is the only one of the four that genuinely *searches* for the best layout for a given size rather than computing a single deterministic one — for any surface, multiple structurally different compositions are actually built and objectively compared, not just assumed.
- The scoring rubric formalizes what "good on this surface" means numerically (legible text, no collisions, respects safe area, sensible fill), so the choice between candidates is explainable and traceable (`narrate.ts` turns the winning decision into a plain-English explanation), not just implicit in which `if` branch fired.
- The shared `solveTracks()` primitive means every strategy's resizing behavior is built from the same well-tested flex-like math — no strategy can silently diverge in how it handles slack or overflow.
- Degradation is provably useful: a drop is only kept if it actually improved the score, so the engine never sheds content for no benefit.

**Cons of this resizing logic:**
- The cost of the search scales directly with candidate count — 6–12 full placements (with real text measurement and image analysis) per resolve, and again per degradation retry, is meaningfully more computation than a single deterministic pass; the project's own benchmarks show this is fast in practice (~1.7ms), but it's an inherently more expensive strategy than a fixed-template approach.
- The rubric's weights and thresholds (`3, 3, 2.6, 2.4, 2.2, ...`, `goodEnough = 0.82`) are hand-picked, and nothing tests that the specific numbers correlate with what a human would judge as the best-looking candidate — the search picks the highest score under this rubric, which is a proxy for quality, not quality itself.
- The larger the surface space explored, the more surface area exists for a strategy to be miscalibrated for an aspect ratio nobody tested (e.g. a strategy's `affinity` value is author-chosen, not derived) — the rubric would eventually catch a genuinely bad layout, but a mediocre one could still "win" a weak field of candidates on a given size.

---

## 3. `Adaptive-layout-engine-2` — Aspect-Ratio-Only Strategy Switch + Per-Strategy Greedy Cursor Placement

**How it decides layout as the screen changes:**

`computeFlowStrategy(ar)` is the narrowest classifier of the four — it looks at **aspect ratio alone** (not size or pixel count) and returns one of four strategies:

```ts
if (ar > 2.5)              return "broadcast-strip";  // ultrawide
if (ar >= 0.85 && ar<=1.15) return "grid";             // square-ish
if (ar > 1.15)              return "row";              // landscape
return "column";                                       // portrait (ar < 0.85)
```

Each strategy is then handled by its **own, independently-written placement function** (`placeColumn`, `placeRow`, `placeGrid`, `placeBroadcastStrip`). Every one of these functions follows the same shape but reimplements it from scratch: for each element (already sorted by priority), compute a role-based "natural size" via hand-tuned proportional formulas (e.g. in column mode a hero image claims `contentHeight * 0.45`; in broadcast mode headline text gets `fontSize = contentHeight * 0.28`), clamp it against hard constraints (`minTextSize`, `minTapTarget`) via `applyHardConstraints`, then try to place it at a moving cursor position — if it doesn't fit at natural size, shrink it toward `minScaleFactor` (spec-defined, default `0.6`); if it still doesn't fit, drop it with a human-readable reason (e.g. *"Element height 340px exceeds remaining space 210px"*).

Because sizing constants are proportional to the content rect's own dimensions (`contentWidth * 0.42`, `Math.sqrt(area) * 0.035`, etc.) rather than fixed pixels, the layout genuinely rescales continuously as width/height change within a strategy — this is what the project's own "Fluid Stress Test" feature demonstrates by animating the surface size and watching every element's position recompute every frame.

**Pros of this resizing logic:**
- The purest, most predictable mental model of any of the four: exactly one aspect-ratio number maps to exactly one strategy, with no scoring, search, or classification-by-pixel-count muddying the decision — trivial to explain and to verify by reading `computeFlowStrategy` alone.
- Sizing heuristics are proportional to the *live* content rect, not fixed pixel breakpoints, so resizing is genuinely continuous — there's no "snap" between sizes within a single strategy, which is exactly what makes the fluid drag-resize and animated stress-test features in the demo look smooth.
- The shrink-then-drop degradation per element is well-instrumented: every drop carries a specific numeric reason, which is good for debugging *why* something disappeared at a given size.
- Hard constraints (tap target, min text size) are applied before placement is attempted, guaranteeing a button is touch-safe or text is legible *before* the greedy algorithm ever tries to fit it — sizing can shrink around a constraint but never violate it.

**Cons of this resizing logic:**
- The four placement functions independently reimplement the same "compute natural size → clamp → try to place → shrink → drop" shape with no shared allocator, so a fix or improvement to that pattern (e.g. the redistribute-slack idea from the minimalist project) has to be made up to four times, and already has drifted: only `placeColumn` applies shrink/drop degradation to the hero image itself — `placeRow` and `placeBroadcastStrip` place hero/logo unconditionally at a fixed fraction with no fallback if it doesn't fit.
- Because aspect ratio is the *only* input to strategy selection, there's a verified, reproducible correctness bug: `placeBroadcastStrip` derives its logo/hero strip widths from `height` alone (assuming height is small relative to width for any surface past the `ar > 2.5` threshold), with no check that the resulting text-area's right edge actually stays within the surface — at a live-custom surface like 900×320 (`ar = 2.81`, well inside what the demo's own custom-surface builder allows), this overflows the frame by over 300px, directly contradicting the project's own stated invariant that placed elements never exceed surface bounds.
- There is no post-hoc geometric audit anywhere in the pipeline (unlike the other three projects, which each independently re-verify placements after the fact) and zero automated tests, which is exactly why the overflow above shipped undetected — nothing catches a strategy's per-strategy math being wrong for a size nobody manually tried.
- Because the four strategies are hard-partitioned by exact aspect-ratio bands with no shared candidate comparison, there's no way to notice if, say, `row` would actually have produced a better layout than `grid` for a surface that landed just inside the square band.

---

## 4. `FlamaAi` — All Strategies Always Generated, Validity as the Scoring Floor, Ordered Cost-Based Degradation

**How it decides layout as the screen changes:**

FlamaAi doesn't classify the surface into an archetype at all before generating layouts. Instead, **all five strategies are unconditionally generated in full for every single resolve**, regardless of aspect ratio: `verticalStack`, `horizontalSplitMediaLeft`, `horizontalSplitMediaRight`, `compactHorizontalStrip`, `centeredHero`. Each one independently computes its own element positions from the surface's usable area (post-safe-area).

The distinctive design decision is in scoring: rather than a separate lightweight heuristic, each candidate is scored by constructing a full dummy `ResolvedLayout` and running the *actual* `validateResolvedLayout` audit against it — the same function that checks bounds containment, safe-area respect, AABB collisions, minimum text size, minimum tap target, and required-element visibility used for the final sanity check on the chosen layout. An invalid candidate is given a hard-floor negative score (`-10000 + violations × -100`) that no amount of aesthetic bonus can ever outweigh — guaranteeing a valid layout always beats an invalid one, structurally, not just usually. Valid candidates then get an aspect-ratio-affinity bonus specific to that strategy (e.g. `verticalStack` gets `+350` when `canvasRatio < 0.9`, `compactHorizontalStrip` gets `+350` when `canvasRatio >= 3.0` or the surface is very short), plus bonuses for visible-element count and a "sweet spot" space-utilization curve (peaking at 35–75% fill), minus a penalty proportional to accumulated degradation cost.

If a strategy's initial layout is invalid for the given size, a **13-step degradation pipeline**, each step carrying an explicit `impactScore` from `5` (reduce spacing 70%→40%) to `80` (reduce CTA to minimum tap target), is applied cumulatively — in increasing order of how much it hurts the ad — against a cloned degradation state, re-generating and re-validating after each step, until the strategy either becomes valid or the steps run out. The engine then picks whichever of the five strategies produced the highest-scoring valid result; if literally none validate, it falls back to the best-scoring one anyway and flags a warning.

**Pros of this resizing logic:**
- Reusing the real, final-check validator as the *scoring* penalty (rather than a separate approximation of "is this layout okay") is a genuinely elegant unification: it's structurally impossible for an invalid layout to be preferred over a valid one, because invalidity isn't a soft penalty, it's a floor no valid score can be below.
- Not gating strategies by a pre-computed archetype means an aspect ratio that would fall awkwardly between two hand-picked archetype thresholds in the other projects still gets *all five* strategies evaluated fairly on that exact size — there's no risk of a surface being excluded from a strategy that would actually have suited it well.
- The 13-step degradation pipeline is ordered by *measured impact*, not just element priority, so a layout that needs a small concession gets exactly that (e.g. tightening spacing) before anything more drastic (hiding content, shrinking the CTA) is even considered — this maps well onto the intuitive "try the least damaging fix first" instinct.
- This project's test suite deliberately constructs an *impossible* surface (a 100×40 frame with an unreachable 120px tap target) and asserts the engine reports `valid: false` gracefully rather than crashing or silently shipping a broken layout — none of the other three projects test their resizing logic against a genuinely unsatisfiable case.

**Cons of this resizing logic:**
- Always generating and fully laying out all five strategies regardless of surface shape is wasteful compared to the archetype-gated approach of the other candidate-based project — a tall portrait surface still gets a full `compactHorizontalStrip` layout built and scored even though its aspect-ratio bonus formula guarantees it will lose, which is pure discarded computation on every single resolve.
- Each of the five strategies independently re-derives its own sizing, spacing, and positioning math from scratch (the single file holding all five is 1,171 lines, the largest and most duplicated placement logic of any of the four projects) — a correctness fix to, say, how vertical spacing is computed would need to be made in up to five separate places, and nothing structurally prevents them from drifting apart from each other over time.
- No strategy is itself responsible for staying within bounds — correctness is entirely delegated to the post-hoc validator plus the degradation loop reacting to its failures, meaning a strategy's own placement code has zero local guarantee it won't overflow; it just trusts that if it did, something downstream will notice and try to fix it.
- The degradation pipeline restarts from its first step and re-applies every previously-successful step from scratch on each retry within the same strategy (rather than resuming from where it left off), which is quadratic in the number of steps — negligible in practice since there are only 13, but a design smell if the pipeline ever grew.
- Like the maximalist project, the scoring formula's constants (base `500`, `+350`/`+150`/`-150`/`-200` aspect bonuses, `utilization × 2` penalty, flat `+50` CTA bonus) are extensive and hand-tuned with no test verifying the composite ranking tracks actual perceived quality — and unlike the maximalist sibling, neither its README nor its architecture doc flags these as provisional.

---

## Side-by-Side: The Core Resize Decision

| | `adaptive-layout-engine` | `adaptive-layout-engine-1` | `Adaptive-layout-engine-2` | `FlamaAi` |
|---|---|---|---|---|
| **What triggers a layout change** | Aspect ratio + pixel count | Aspect ratio + min dimension + area (8 archetypes) | Aspect ratio only | Nothing pre-filters — every resize re-evaluates all 5 strategies fresh |
| **Decision mechanism** | Fixed rule cascade → 1 template | Archetype gates strategies → 6–12 candidates → weighted-rubric argmax | Fixed rule cascade → 1 strategy | No gating → all 5 candidates → validity floor + aspect/utilization scoring → argmax |
| **Placement math** | One shared allocator (`stack()`), used by all 5 templates | One shared allocator (`solveTracks()`), used by all 6 strategies | 4 independently hand-written placement functions (duplicated) | 5 independently hand-written strategy functions (duplicated, most of any project) |
| **Does it grow into extra space, or only shrink to fit less?** | Grows into slack via a genuine 2nd allocation pass | Grows/shrinks via weighted min/max track solving | Only shrinks (natural size → `minScaleFactor` → drop); no growth-into-slack pass | Only shrinks via degradation steps; no growth-into-slack pass |
| **Degradation trigger** | Remove only the element(s) that actually caused the specific overflow | Remove lowest-effective-priority element, but only keep the drop if it measurably raised the score | Per-element: shrink to `minScaleFactor`, then drop, with a text reason | 13 impact-ordered steps applied cumulatively per strategy until valid |
| **Self-verification of correctness** | Re-runs `solve()` from scratch each pass (no stale state) | 11-rule scoring rubric implicitly checks legibility/collision/containment on every candidate | None — no post-hoc audit, no tests; verified reproducible overflow bug in `broadcast-strip` | Reuses the real final validator as the per-candidate score itself — the strongest self-verification of the four |