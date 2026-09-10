PHASE 5 — Stress Lab + Self-Healing + Demo Polish

Context: Phases 1–4 built: typed spec/surface models, the Experience Graph, Context
Engine, a candidate-generation + deterministic-scoring resolver, and 3 explainability
panels (Debugger, Counterfactuals, Health Check) — all verified working via unit
tests and chrome-devtools screenshots across all 5 sample surfaces. Do not modify
core resolver/scoring/candidates logic in this phase unless a specific requirement
below explicitly calls for it (self-healing does require one small addition — see
below). Everything else in this phase is new UI/features built ON TOP of the
existing, working core.

This is a large phase — work through the sub-sections in order (5.1 → 5.5) and do
not skip ahead if an earlier sub-section's acceptance check fails.

═══════════════════════════════════════
5.1 — STRESS LAB
═══════════════════════════════════════
GOAL: Automatically generate randomized surface/context profiles, run the resolver
against each, and report tiered pass/degraded/failed results with click-through
inspection.

FILES TO ADD
  src/core/stress-lab.ts       — generateRandomSurfaces(count), runStressTest(spec, surfaces)
  src/components/StressLab.tsx  — UI panel
  src/core/__tests__/stress-lab.test.ts

REQUIREMENTS — stress-lab.ts
- generateRandomSurfaces(count: number): SurfaceProfile[]
    - Randomize width/height across a wide range including extremes (e.g. as narrow
      as 100x600, as wide as 3840x400, as small as 200x200).
    - Randomize constraint combinations (minTapTarget, touchOnly, viewingDistance,
      attentionWindow) — but respect Phase 1's cross-field validation (e.g. if
      touchOnly is true, always include a valid minTapTarget) so defineSurface()
      doesn't throw during generation.
- runStressTest(spec: AdSpec, surfaces: SurfaceProfile[]): StressResult
    - StressResult = { total: number; passed: number; degraded: number; failed: number;
        details: { surface: SurfaceProfile; outcome: "passed"|"degraded"|"failed";
        overallScore: number; reason?: string }[] }
    - For each surface: build graph, resolve context, resolve layout.
    - "failed" = any hard invariant violation (overlap, out-of-bounds) — this should
      be structurally impossible given Phase 3's scoring hard-fail rule, but verify
      it end-to-end here rather than assuming.
    - "degraded" = resolved successfully (no invariant violation) but overall score
      below a threshold you define and document (e.g. < 70).
    - "passed" = no violation and score ≥ threshold.

REQUIREMENTS — StressLab.tsx
- A "Run Stress Test" button that runs runStressTest() with generateRandomSurfaces(200).
- Displays: total tested, passed/degraded/failed counts, robustness percentage
  (passed / total).
- A list of the degraded/failed entries specifically (not all 200) — clicking one
  loads that exact surface into the main canvas/picker so it can be inspected using
  the existing Debugger/Counterfactuals/Health Check panels from Phase 4.

TESTS — stress-lab.test.ts
- generateRandomSurfaces(50) produces 50 surfaces that all pass defineSurface()
  validation without throwing (loop and assert no exceptions).
- runStressTest() on 200 generated surfaces produces zero "failed" entries (this is
  the real proof of Phase 3's hard-invariant claim at scale — if any failures show
  up, STOP and report back before continuing, do not paper over it).

5.1 ACCEPTANCE CHECK (do before moving to 5.2):
- All stress-lab tests pass.
- Using chrome-devtools MCP: click "Run Stress Test" in the running app, screenshot
  the results summary, and click into one degraded entry, screenshotting that it
  correctly loads into the main view. Report the actual robustness percentage
  achieved.

═══════════════════════════════════════
5.2 — SELF-HEALING (combined failure demo)
═══════════════════════════════════════
GOAL: Demonstrate the pipeline recovering from multiple simultaneous failure
conditions at once, rather than breaking.

SMALL CORE ADDITION REQUIRED: candidates.ts currently assumes text elements have a
fixed estimated size. Add real text measurement: a small utility
(src/core/text-measure.ts) using an offscreen canvas's `measureText()` API to get
actual rendered width for a given font size/string, and use it when placing text
elements instead of a fixed guess. This directly enables long/translated headlines
to be measured accurately rather than estimated.

FILES TO ADD
  src/core/text-measure.ts
  src/core/self-healing-scenario.ts   — a deliberately broken AdSpec: unusually long
                                          headline text, an image element with a
                                          missing/invalid src, on a small surface,
                                          plus a second variant of the CTA with much
                                          longer translated text (e.g. German)
  src/components/SelfHealingDemo.tsx   — a button that loads this broken scenario
                                          into the resolver and displays before/after

REQUIREMENTS
- resolver.ts must handle a missing image gracefully (treat as if the element still
  occupies its role/priority slot for layout purposes, but render a visible
  placeholder box rather than crashing or leaving a broken img).
- Long/translated text must use text-measure.ts's real measurement to decide
  wrap/shrink/truncate, not a fixed character-count guess.
- SelfHealingDemo.tsx shows: "Layout invalid — re-optimizing" message briefly, then
  the successfully recovered layout, with the Debugger panel showing which elements
  were adjusted and why (reusing Phase 4's existing panel, not a new one).

TESTS
- text-measure.test.ts: measureText() returns a larger width for a longer string at
  the same font size (basic sanity, not exact pixel matching).
- A resolver test: running the self-healing scenario produces a layout with zero
  overlaps/out-of-bounds elements (same hard invariant, applied to this specific
  adversarial input) AND the CTA element remains visible: true despite everything
  else going wrong around it.

5.2 ACCEPTANCE CHECK:
- Tests pass. Using chrome-devtools MCP: screenshot the broken scenario resolving
  successfully, and screenshot the Debugger panel showing the specific
  shrink/drop/placeholder decisions made for this scenario.

═══════════════════════════════════════
5.3 — SIDE-BY-SIDE MULTI-SURFACE VIEW
═══════════════════════════════════════
GOAL: Show all 5 surfaces rendering the same spec simultaneously, not one at a time.

FILES TO ADD
  src/components/MultiSurfaceView.tsx

REQUIREMENTS
- A toggle to switch the main demo between "single surface + picker" (existing) and
  "side-by-side" mode.
- Side-by-side mode renders all 5 surfaces at once, each appropriately scaled to fit
  in a grid, each wrapped in a simple device-style frame (a plain CSS border/shape
  is enough — phone-like rounded rect for mobile, wide rect for broadcast, square
  for kiosk; no need for elaborate bezel graphics).
- Each mini-render must be the real resolved layout for that surface (reuse existing
  resolver calls), not a static mockup image.

5.3 ACCEPTANCE CHECK: chrome-devtools screenshot of side-by-side mode showing all 5
surfaces with visibly different, correct layouts at once.

═══════════════════════════════════════
5.4 — NAIVE-VS-SMART COMPARISON + DEGRADATION SLIDER
═══════════════════════════════════════
GOAL: Prove the engine is doing more than uniform scaling, and make degradation
watchable in real time.

FILES TO ADD
  src/core/naive-resolver.ts     — a deliberately dumb resolver: uniformly scales
                                     every element by the same factor to fit the
                                     surface, no priority logic, allowed to overlap
                                     if it must (this is intentionally the "bad"
                                     baseline, don't make it secretly smart)
  src/components/NaiveVsSmart.tsx  — side-by-side: naive-resolver output vs. real
                                       resolver output, same spec, same surface
  src/components/DegradationSlider.tsx  — a width/height slider that live-shrinks
                                            the currently selected surface and
                                            re-runs the real resolver on every
                                            change, showing elements shrink/drop
                                            in real time

5.4 ACCEPTANCE CHECK: chrome-devtools screenshot of the naive-vs-smart comparison on
a constrained surface (should look visibly worse on the naive side — overlapping or
illegibly tiny elements), and a screenshot sequence (3 screenshots at different
slider positions) showing progressive degradation on the smart side.

═══════════════════════════════════════
5.5 — LIVE "UNKNOWN SURFACE" INPUT (rehearsal for live interview bonus)
═══════════════════════════════════════
GOAL: A simple form to type in a brand-new surface's constraints and see it resolve
instantly, no code changes.

FILES TO ADD
  src/components/UnknownSurfaceInput.tsx

REQUIREMENTS
- Form fields for width, height, minTapTarget, touchOnly, viewingDistance,
  attentionWindow (matching Phase 1's SurfaceProfile type).
- On submit, call defineSurface() with the entered values (so Phase 1's validation
  runs for real) and resolve/render immediately using the existing pipeline — zero
  new resolver code path, this must go through the exact same functions as every
  other surface.
- If defineSurface() throws (invalid combination), show the actual error message
  from Phase 1, don't swallow it.

5.5 ACCEPTANCE CHECK: chrome-devtools test — enter a surface profile that was NOT
in the original 5 samples (pick unusual dimensions/constraints), submit, and
screenshot the correctly resolved result.

═══════════════════════════════════════
OPTIONAL BONUS (only attempt if 5.1–5.5 are all done and solid): CANVAS RENDERER
═══════════════════════════════════════
Add src/core/render-canvas.ts implementing the same ResolvedLayout → visual output
contract as the DOM renderer, but drawing to a <canvas> element instead — proving
the resolver output is renderer-agnostic. Add a DOM/Canvas toggle to the main view.
Skip this entirely if you're short on time; it's explicitly a bonus, not required.

═══════════════════════════════════════
FINAL PHASE 5 ACCEPTANCE CRITERIA
═══════════════════════════════════════
1. `tsc --noEmit` clean.
2. ALL tests from every phase still pass — run the full suite, paste complete output.
3. All 5 sub-section chrome-devtools checks above completed with screenshots.
4. Confirm explicitly: did the stress lab run at 200 surfaces produce 0 "failed"
   entries? State the exact robustness percentage.
5. Show me the full file tree at this point.

Report back with all of the above before we move to Phase 6 (docs + final regression).