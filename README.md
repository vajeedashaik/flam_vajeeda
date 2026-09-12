# Adaptive Layout Engine

A TypeScript system that takes **one declarative ad spec** — the content and the
intent behind each element, with no width, height, or position — and resolves it
into a **correct, genuinely different layout for each target "surface"** (a phone
in portrait, a broadcast lower-third, a retail kiosk, a printed QR panel, an
unknown surface someone types in live). The layouts are not hardcoded per
surface and not uniform scaling of one master layout: the engine builds an
Experience Graph from role semantics, normalizes each surface's real-world
constraints (tap ergonomics, viewing distance, attention budget) into a context,
generates several candidate layouts with different spatial strategies, scores
each with a deterministic fitness function, and picks the best — dropping and
shrinking lower-priority elements in a defined order when space runs out, while
never overlapping, clipping, or dropping an element marked "always visible".
Every resolution carries a decision trace explaining what was chosen and why.

See [ARCHITECTURE.md](ARCHITECTURE.md) for the full design.

**Contents:** [Setup](#setup) · [Running the demo](#running-the-demo) ·
[Feature overview](#feature-overview) · [Known limitations](#known-limitations) ·
[Time spent](#time-spent) · [AI tool disclosure](#ai-tool-disclosure) ·
[Live demo](#live-demo) · [Bonus points](#bonus-points) ·
[Project layout](#project-layout)

---

## Setup

Requires Node 18+.

```bash
npm install       # install dependencies
npm run dev       # start the Vite dev server (http://localhost:5173)
npm run test      # run the full Vitest suite (86 tests)
npm run build     # type-check (tsc --noEmit) + production build to dist/
npm run preview   # serve the production build locally (http://localhost:4173)
```

`npm run typecheck` runs `tsc --noEmit` on its own.

---

## Running the demo

Start `npm run dev` (or `npm run build && npm run preview` for the production
build) and open the page. A top nav bar switches between views:

- **Single surface** — the default view. Use the **surface picker** dropdown to
  switch between the 5 sample surfaces (plus a pre-shrunk 200×200 kiosk). The
  resolved layout renders at true aspect ratio, scaled to fit. Below the header
  you see the winning strategy, how many elements stayed visible, and the derived
  context flags (aspect / attention / touch / far).
- **Degradation slider** — sits directly under the single-surface layout. Two
  sliders live-shrink the selected surface's width and height; the **real**
  resolver re-runs on every change, so you watch elements shrink and then drop in
  priority order (e.g. 5/5 → 4/5 → 2/5 as the print panel goes from 620×874 down
  to 240×200).
- **Explainability panels** (under the single-surface view, updating live on
  every surface change):
  - **Layout Debugger** — the per-element decision trace ("headline: wanted
    420×96, placed at 390×96 → shrunk 7%", "logo: dropped — priority 5, no room
    left…").
  - **Layout Counterfactuals** — every candidate strategy with its score, winner
    badged "CHOSEN"; click a losing strategy to see a generated sentence naming
    the sub-score it lost on and by how many points.
  - **Layout Health Check** — a pass / warn / fail checklist derived from the
    winning candidate's six sub-scores (including `contextFit`).
- **Side-by-side (5.3)** — all 5 sample surfaces resolved at once, each in a
  plain device-style frame, each the real resolved layout (not a mockup). The
  fastest way to see that the layouts genuinely differ.
- **Stress Lab (5.1)** — click **Run Stress Test** to generate 200 randomized
  surfaces (dimensions from 100×600 to 3840×2160, random constraint mixes), run
  the real pipeline against every one, and report passed / degraded / failed
  counts plus a robustness percentage. The degraded/failed entries are listed;
  click one to load that exact surface into the single-surface view for
  inspection with the panels above.
- **Self-Healing (5.2)** — click **Load broken scenario** to run a deliberately
  adversarial spec (absurdly long headline, invalid hero image src, missing logo
  src, tiny 240×260 touch surface, optional longer German CTA). Shows the naive
  attempt beside the recovered layout, a brief "re-optimizing" beat, and the
  Debugger panel listing the shrink / drop / placeholder decisions. The CTA stays
  visible through all of it.
- **Naive vs Smart (5.4)** — the same spec and surface run through a deliberately
  dumb resolver (one uniform scale factor, diagonal stagger, overlap allowed, no
  priority logic) on the left and the real resolver on the right. On a
  constrained surface the naive side visibly overlaps and shrinks elements into
  illegibility; the smart side keeps a clean priority-ordered layout. Pick the
  surface with the dropdown.
- **Unknown surface (5.5)** — a form for width, height, minTapTarget, touchOnly,
  viewingDistance, attentionWindow. On submit it calls the same `defineSurface()`
  used by every built-in surface (so Phase 1 validation runs for real) and
  resolves through the exact same pipeline — no new code path. Enter an invalid
  combination (touchOnly with no minTapTarget) and the real validation error is
  shown verbatim, not swallowed.

---

## Feature overview

The "Addresses" column maps each feature to the official Flam evaluation
criteria — **Constraint resolution algorithm (35%)**, **Layout correctness
across surfaces (25%)**, **TypeScript & architecture (20%)**, **Example
application (10%)**, **Code quality (10%)** — and to the internal project-plan
feature numbers (`§4.x`).

| Feature | What it does | Addresses |
|---|---|---|
| Typed spec / surface models (`defineAd`, `defineSurface`) | Closed unions for roles and element types; construction-time validation with named, field-specific errors; an invalid role literal is a compile error | TypeScript & architecture (20%); core req: "compile-time or clearly-reported runtime type errors" |
| Experience Graph (`buildGraph`) | Derives proximity/exclusion edges from role semantics with a deterministic, id-agnostic rule set | Constraint resolution algorithm (35%); §4.1 semantic layout graph |
| Importance / survival tiers | `importance` (`critical`/`should-survive`/`nice-to-have`) + `visibility` (`always`/`degradable`/`decorative-only`) layered on numeric priority | Constraint resolution algorithm (35%); §4.2 |
| Context Engine (`resolveContext`) | Normalizes surface constraints (aspect, touch, far-viewing, attention budget, audio, motion) into qualitative flags with documented thresholds | Constraint resolution algorithm (35%); §4.3-context |
| Context-aware sizing + strategy bias | Far-viewing text/buttons and touch-surface CTAs request genuinely bigger sizes (§4.3-context); a `contextFit` sub-score rewards the strategy whose geometry matches the surface's aspect ratio and rewards fewer visible elements under a short attention budget or far viewing | Constraint resolution algorithm (35%); §4.3-context, §4.14 |
| Candidate generation (4 strategies) | vertical-stack / horizontal-split / grid / overlay-safe-margins, all through one shared priority-ordered placement engine | Constraint resolution algorithm (35%); Layout correctness (25%); §4.3 |
| Deterministic fitness scoring | 6 weighted sub-scores + hard-fail-to-0 rule for overlap / out-of-bounds / dropped-always / priority-inversion; pure function | Constraint resolution algorithm (35%); Code quality (10%); §4.3 |
| Performance-aware scoring term | `renderCost` sub-score (element count + mean size) breaks near-ties toward cheaper-to-render layouts | Constraint resolution algorithm (35%); §4.9 |
| Lightweight declarative constraints | safeArea, `minSize`, `minTapTarget`, `brandRules.locked` are declared on the spec/surface and read by the scorer — not hardcoded in the resolver | TypeScript & architecture (20%); §4.4 / §4.6 |
| Priority degradation cascade | Shrink toward minSize, then drop lowest-priority-first in a strict monotone cascade; `visibility:"always"` elements never dropped | Constraint resolution algorithm (35%); core req: "priority-based degradation, not overlap/clip"; §4.5 |
| Decision trace + Layout Debugger panel | Per-element plain-language reasoning ("shrunk 7%", "dropped — priority 5…") updating live on surface change | Code quality (10%); §4.7 |
| Layout Counterfactuals panel | Every candidate + score; click a loser for a generated sentence naming the sub-score gap (`explainLoss`) | Code quality (10%); §4.7b |
| Layout Health Check panel | Pass/warn/fail checklist derived from the same 6 sub-scores | Code quality (10%); Example application (10%); §4.7c |
| Side-by-side multi-surface view | All 5 surfaces resolved and rendered at once in device-style frames | Layout correctness across surfaces (25%); §4.16 |
| Stress Lab | 200 randomized surfaces incl. extremes; tiered pass/degraded/failed; **0 failed every run**; ~65% robustness | Layout correctness across surfaces (25%); §4.10 |
| Self-healing demo | Recovers from long text + broken images + tiny surface + translated copy simultaneously | Layout correctness (25%); §4.13; official bonus "text-measurement-aware layout" |
| Real text measurement (`text-measure.ts`) | Canvas `measureText()` for the true rendered width of long / translated strings; node fallback preserves ordering | Constraint resolution algorithm (35%); official bonus "text-measurement-aware layout"; §4.13 / §4.17 |
| Naive-vs-smart comparison | The real output beside a deliberately dumb uniform-scaling resolver | Example application (10%); §4.19 (proves it is not "uniform scaling passed off as adaptation") |
| Degradation slider | Live re-resolve as the surface shrinks; watch shrink→drop in order | Example application (10%); §4.18 |
| Live unknown-surface input | Type a brand-new surface, resolve it through the identical pipeline; real validation errors shown verbatim | TypeScript & architecture (20%); Example application (10%); §4.20 (live-interview bonus rehearsal) |

---

## Known limitations

Real, specific to what was built (more technical depth in
[ARCHITECTURE.md §10](ARCHITECTURE.md#10-limitations--what-id-improve-with-more-time)):

- **`contextFit`'s bonus/penalty sizes are reasoned, not tuned.** Context now
  genuinely changes element sizing (far-viewing text, touch CTAs) and which
  strategy wins (a `contextFit` sub-score rewards aspect-matched strategies and
  fewer visible elements under a short attention budget or far viewing) — see
  [ARCHITECTURE.md §4](ARCHITECTURE.md#4-candidate-generation--scoring). The
  exact magnitudes (`+20`/`−15` shape bonuses, `1.3×`/`1.15×` size scales) are
  hand-chosen constants, not calibrated against real ad performance data.
- **Candidate generation is 4 fixed strategies, not an exhaustive search.** No
  parameter sweep, no packing algorithm, no refinement of the winner.
  `contextFit` picks the best-suited of four; it doesn't invent a fifth. On
  some mid-size surfaces the best of four is only adequate — that is the
  remaining "degraded" band in the Stress Lab.
- **The Stress Lab "robustness" number (~65%) is a quality bar, not a
  correctness bar.** "passed" means score ≥ 70. Hard-invariant safety (no
  overlap / clip / dropped-always, ever) held on 100% of surfaces in every run;
  "failed" is always 0. The headline percentage understates correctness.
- **Text measurement uses the Canvas `measureText()` API**, which differs
  slightly from the browser's final text layout (kerning, font fallback,
  wrapping). In the Node test environment there is no canvas, so a linear
  approximation (`length × fontSize × 0.52`) is used — it preserves ordering, not
  absolute pixels.
- **`alignment` edges are typed but never derived**; only proximity and exclusion
  edges are built, and no strategy reads edge data for placement yet.
- **One renderer only.** `ResolvedLayout` is renderer-agnostic data and
  `render-dom.ts` is a deliberate stub, but the only implemented
  `ResolvedLayout → pixels` path is `SurfaceStage.tsx` (React DOM). No Canvas
  renderer was built, so the renderer-agnostic claim is sound by construction but
  undemonstrated.
- **`overlay-safe-margins` caps at 4 elements** (four corners) and always drops
  the 5th, so it rarely wins on the 5-element sample ad.
- **Sample data only.** Specs and surfaces are code-defined; the demo renders
  role-tinted boxes, not real ad copy or imagery.

---

## Time spent

Approximately **1 day** of focused work, across six specified phases
(`phase1.md`–`phase6.md`).

---

## AI tool disclosure

Claude Code (Anthropic) was used throughout implementation. Development ran in
six explicitly specified phases (`phase1.md`–`phase6.md` in this repo); at each
phase a human wrote the specification, reviewed the generated code, ran the tests
and the browser checks, and only then moved to the next phase. No phase was
accepted without its acceptance criteria being met. The author has read the
entire codebase and can explain and defend every part of it — the type design,
the edge-derivation rules, the scoring weights and hard-fail rule, the
degradation cascade, and the stress/self-healing methodology.

---

## Live demo

Not yet deployed.

Locally: `npm run build && npm run preview` → http://localhost:4173

---

## Bonus points

Where the feature table above maps to the grading rubric, this one maps to the
project plan's own differentiator list (`§4.x`) and gives a verdict for each —
**Implemented**, **Partial** (the mechanism exists but is not fully wired
through), or **Skipped**.

| # | Feature | Status | Notes |
|---|---|---|---|
| 4.1 | Semantic layout graph (typed relational edges) | **Implemented** | proximity + exclusion edges derived from roles; `alignment` typed but not derived; edges not yet read by placement |
| 4.2 | Importance / survival tiers | **Implemented** | `importance` + `visibility` unions; `visibility:"always"` enforced as a hard-fail in scoring |
| 4.3 | Candidate generation + deterministic fitness scoring | **Implemented** | 4 strategies, 6 weighted sub-scores, hard-fail rule, determinism test |
| 4.3-context | Context-aware adaptation | **Implemented** | far-viewing inflates text/button preferred size, touch inflates the clickable CTA (candidates.ts); a `contextFit` sub-score rewards the aspect-matched strategy and fewer visible elements under short attention / far viewing (scoring.ts) — composition strategy itself changes, not just sizes (verified: broadcastLowerThird's winner flips from `grid` to `horizontal-split`) |
| 4.4 | Lightweight declarative constraint rules | **Implemented** | safeArea / minSize / minTapTarget / brandRules read by the scorer, declared on spec+surface |
| 4.5 | Graceful degradation engine | **Implemented** | strict priority-monotone shrink→drop cascade; documented in ARCHITECTURE §5 |
| 4.6 | Brand-safe adaptation | **Partial** | `brandRules.locked` + brand `minSize` are honoured as a `constraintViolations` penalty; not every advertiser rule from the plan (e.g. `product.mustStayDominant`, `headline.canWrapNotTruncate`) is modelled |
| 4.7 | Layout Debugger | **Implemented** | live per-element decision-trace panel |
| 4.7b | Layout Counterfactuals | **Implemented** | click a losing candidate → `explainLoss()` names the largest sub-score gap and the point delta |
| 4.7c | Layout Health Check | **Implemented** | pass/warn/fail checklist on the 6 sub-scores |
| 4.9 | Performance-aware composition | **Implemented** | `renderCost` sub-score (weight 0.06) as a tie-breaker inside the same fitness function |
| 4.10 | Automated stress testing ("Stress Lab") | **Implemented** | 200 randomized surfaces, tiered pass/degraded/failed, click-through inspection; 0 failed every run; robustness moved from ~50% to ~65% once `contextFit` shipped |
| 4.13 | Self-healing / fault-tolerant layout (combined stressors) | **Implemented** | long headline + invalid hero src + missing logo src + tiny surface + longer German CTA, all at once; recovers with CTA kept (now via `grid`, 4/4 visible — `contextFit`'s square-aspect bonus improved on the pre-fix `vertical-stack`, 3/4 visible) |
| 4.14 | Interactive vs. passive layout strategy | **Implemented** | touch surfaces get a genuinely bigger CTA (candidates.ts sizing) and `contextFit` penalizes `overlay-safe-margins` (corner-spread targets) under touch; far-viewing/short-attention surfaces reward strategies that keep fewer, larger elements visible |
| 4.16 | Side-by-side multi-surface view | **Implemented** | all 5 surfaces at once in phone/wide/square frames, each a real resolved layout |
| 4.17 | Language-aware adaptation | **Implemented** (scoped) | self-healing demo has an EN/DE locale toggle; the longer German CTA is measured and re-resolved rather than overflowing |
| 4.18 | Live degradation slider | **Implemented** | width/height sliders re-run the real resolver on every change |
| 4.19 | Naive vs. smart comparison view | **Implemented** | real resolver vs. uniform-scaling baseline, side by side, per surface |
| 4.20 | Live "unknown surface" input | **Implemented** | form → `defineSurface()` → identical pipeline; invalid combos surface the real error |
| 4.21 | Canvas renderer (second backend) | **Skipped** | `ResolvedLayout` is renderer-agnostic data and `render-dom.ts` is a stub seam, but no Canvas backend and no DOM/Canvas toggle were built. The renderer-swap claim is sound by construction, not demonstrated |
| Pillar A note | Optional AI Semantic Parser | **Skipped** (by design) | roles/priority are authored manually in the spec; no AI in the ingestion or decision path |

Official bonus points called out in the brief:

- **"text-measurement-aware layout"** — **Implemented** (`text-measure.ts`, used
  by candidate placement and exercised by the self-healing + language demos).
- **"add a new renderer without touching the resolution algorithm"** —
  **Structurally supported, not demonstrated** (no Canvas renderer built; see
  4.21).
- **"resolve an unseen surface live in the interview"** — **Implemented**
  (Unknown-surface view; verified in the regression sweep with a 2600×360
  surface).

---

## Project layout

```
src/
  core/
    spec.ts                  ad spec types + defineAd()
    surfaces.ts              surface profile types + defineSurface()
    sample-data.ts           1 sample ad + 5 sample surfaces
    graph.ts                 Experience Graph (buildGraph, getRelatedNodes)
    context.ts               Context Engine (resolveContext)
    candidates.ts            4 candidate strategies + shared placement engine
    scoring.ts               deterministic fitness scoring (scoreCandidate)
    resolver.ts              orchestration: generate → score → pick → trace
    trace.ts                 DecisionTrace + explainLoss()
    text-measure.ts          Canvas measureText() with node fallback
    naive-resolver.ts        deliberately dumb baseline (5.4)
    stress-lab.ts            generateRandomSurfaces + runStressTest (5.1)
    self-healing-scenario.ts adversarial spec + tiny surface (5.2)
    render-dom.ts            deliberate stub (framework-agnostic renderer seam)
    spec.invalid-example.ts.txt   compile-error demonstration (excluded from build)
    __tests__/               11 Vitest suites, 86 tests
  components/
    SurfaceStage.tsx         the one ResolvedLayout → pixels renderer
    LayoutDebugger.tsx       explainability panel 1
    LayoutCounterfactuals.tsx explainability panel 2
    LayoutHealthCheck.tsx    explainability panel 3
    StressLab.tsx MultiSurfaceView.tsx SelfHealingDemo.tsx
    NaiveVsSmart.tsx DegradationSlider.tsx UnknownSurfaceInput.tsx
    useCountUp.ts             presentation-only number animation hook
  styles/
    theme.css                design system — glassmorphism + claymorphism,
                              dark-first with a light toggle, CSS custom
                              properties, prefers-reduced-motion aware
  App.tsx main.tsx
phase1.md … phase6.md        the phase specifications this was built against
ARCHITECTURE.md
```

The UI is a presentation layer only: all styling lives in `styles/theme.css`
plus `className`s on component wrappers. No `src/core/**` file is imported by a
style concern, and the resolver output is unchanged. Theme choice (system /
light / dark) is toggled from the nav and persisted to `localStorage`.
