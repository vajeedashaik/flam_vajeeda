PHASE 3 — Multi-Surface Support + Priority Degradation + Candidate Generation & Scoring

Context: Phase 2 built the Experience Graph (src/core/graph.ts), Context Engine
(src/core/context.ts), and an MVP single-pass resolver (src/core/resolver.ts) that
works correctly for ONE surface, verified via unit tests and a chrome-devtools
overlap check. Do not regress those Phase 2 guarantees — every test written in
Phase 2 must still pass after this phase.

GOAL FOR THIS PHASE
1. Upgrade the resolver from a single greedy pass into: generate multiple candidate
   layouts per surface, score each with a deterministic fitness function, select
   the best-scoring candidate.
2. Prove the SAME resolver code path produces genuinely different, correct layouts
   across all 5 surface profiles from Phase 1's sample data — not per-surface
   branches.
3. Prove graceful priority-based degradation on the most constrained surface
   (retailKiosk or a deliberately shrunk variant) — lower-priority elements shrink
   then drop, higher-priority elements remain intact.
4. Build a real (if unstyled) surface-picker demo UI so this is testable end-to-end,
   replacing Phase 2's single-surface App.tsx.
5. Capture and expose a decision trace + score breakdown for every resolution — not
   rendered nicely yet (that's Phase 4), just captured as structured data attached
   to the result, so nothing needs to be re-architected later to add the debugger UI.

Do NOT build yet: the debugger/counterfactuals/health-check UI panels, stress lab,
self-healing, canvas renderer, or any of the final demo polish (slider, naive-vs-
smart comparison, etc.). Those are Phases 4 and 5.

FOLDER STRUCTURE CHANGES
src/
  core/
    candidates.ts         — generateCandidates(graph, context, surface): Candidate[]
    scoring.ts             — scoreCandidate(candidate, graph, context, surface): ScoreBreakdown
    resolver.ts             — REWRITE: resolveLayout now orchestrates candidates.ts +
                                scoring.ts instead of doing one greedy pass directly
    trace.ts               — DecisionTrace type + trace-building helpers
  core/__tests__/
    candidates.test.ts
    scoring.test.ts
    resolver.test.ts        — UPDATE existing tests to match new resolver behavior;
                                keep the overlap/no-clip invariant tests, they must
                                still pass
  App.tsx                  — REWRITE: surface picker (dropdown or tabs, plain HTML
                                controls are fine, no styling library needed) that
                                switches between all 5 surfaces from Phase 1's
                                sample-data.ts and re-renders the resolved layout live

REQUIREMENTS — candidates.ts
- Candidate = { strategy: "vertical-stack" | "horizontal-split" | "overlay-safe-margins"
    | "grid"; elements: ResolvedElement[] }
- generateCandidates() must produce at least 3 of these 4 strategies for any given
  graph/context/surface combination — parameterize each strategy generation function
  by the surface's actual dimensions/safeArea/constraints, don't hardcode surface
  names anywhere in this file. Write a code comment explicitly confirming this file
  contains zero references to specific surface names or ids.
- Each strategy function independently handles priority ordering and shrink/drop
  logic from Phase 2's resolver (reuse/extract that logic, don't duplicate it three
  times — factor a shared `placeElementsInOrder(elements, availableSpace, strategyLayoutFn)`
  helper if needed).

REQUIREMENTS — scoring.ts
- ScoreBreakdown = { constraintViolations: number; priorityPreservation: number;
    visualBalance: number; tapTargetCompliance: number; renderCost: number;
    overall: number }  (each sub-score 0-100, overall is the weighted sum — define
    and comment the weights, e.g. constraintViolations weighted heaviest as a penalty)
- scoreCandidate() computes each sub-score from real properties of the candidate —
  e.g. renderCost as a function of element count + estimated pixel area (this is
  the performance-aware term — keep it simple: fewer/larger elements = lower cost,
  document the formula).
- A candidate with ANY overlap or out-of-bounds element must score 0 overall
  (hard-fail, not just a penalty) — write a test asserting this explicitly.
- Export scoreCandidate as pure and side-effect-free — same inputs always produce
  same score (test this with a determinism test: call it twice with identical
  inputs, assert identical output).

REQUIREMENTS — resolver.ts (rewrite)
- resolveLayout(graph, context, surface): { layout: ResolvedLayout; trace: DecisionTrace }
    1. candidates = generateCandidates(graph, context, surface)
    2. scores = candidates.map(c => scoreCandidate(c, graph, context, surface))
    3. pick highest-scoring candidate
    4. build a DecisionTrace (see trace.ts) recording every candidate's score
       breakdown and which one won and why (e.g. "candidate B scored highest:
       94/100, others: A=71, C=83")
    5. return both the resolved layout and the trace

REQUIREMENTS — trace.ts
- DecisionTrace = { candidateScores: { strategy: string; score: ScoreBreakdown }[];
    winningStrategy: string; perElementNotes: string[] }
- perElementNotes: plain-language strings, one per element that was shrunk or
  dropped, e.g. "logo: needed 120x40, available 80x40 → shrunk 33%" or
  "description: dropped, priority 4, insufficient space at priority 1-3 satisfied".
  This is what Phase 4's debugger UI will render directly — keep the strings
  genuinely readable, not internal jargon.

REQUIREMENTS — App.tsx surface picker
- Dropdown/tabs to switch between: mobilePortrait, mobileLandscape,
  broadcastLowerThird, retailKiosk, printQRPanel.
- On switch, re-run buildGraph -> resolveContext -> resolveLayout for the newly
  selected surface and re-render.
- Render the surface container at its real aspect ratio (scaled down to fit the
  viewport if needed, e.g. broadcastLowerThird at 1920x250 should be visibly scaled
  but proportionally correct — use a simple `transform: scale()` or width/height
  percentage, document which you chose).
- Temporarily also render the raw DecisionTrace as plain JSON text below the canvas
  (unstyled is fine) so we can visually confirm trace data exists — Phase 4 replaces
  this with the real debugger UI.

TESTS TO WRITE / UPDATE (Vitest)
- candidates.test.ts: generateCandidates() returns ≥3 distinct strategies for at
  least 2 different surfaces; assert the strategies differ meaningfully in element
  positions (not just uniformly scaled versions of each other — write an assertion
  comparing relative x/y arrangements, not just absolute values).
- scoring.test.ts: 
  - A candidate with a manually-constructed overlap scores 0 overall.
  - Determinism test (same input twice → same output).
  - A candidate satisfying more constraints scores strictly higher than one
    satisfying fewer, holding everything else equal (construct both manually).
- resolver.test.ts:
  - For all 5 sample surfaces, resolveLayout() produces zero overlaps and zero
    out-of-bounds elements (loop over all 5, assert for each).
  - On retailKiosk shrunk to an artificially tiny size (e.g. modify a cloned copy
    to 200x200), assert that the lowest-priority element (branding/logo) has
    visible: false while the CTA (action role) has visible: true — this is the
    explicit degradation-order proof.
  - Assert the SAME resolveLayout function (no surface-name branching) is called
    for all 5 surfaces — this can be a code-level check (grep resolver.ts /
    candidates.ts for literal surface id strings and assert none exist) rather than
    a runtime test if easier; if you do this, write it as an actual automated test
    (e.g. read the source file and regex-check it), not just a comment claiming it.

ACCEPTANCE CRITERIA — DO NOT PROCEED PAST THIS PHASE UNTIL ALL OF THESE PASS
1. `tsc --noEmit` clean.
2. All Vitest tests pass, including the updated Phase 2 tests — paste full output.
3. Using chrome-devtools MCP on the running dev server:
   a. Screenshot the demo on EACH of the 5 surfaces (5 screenshots), switching via
      the picker.
   b. Visually confirm (and state explicitly in your report) that the layouts are
      NOT uniformly scaled copies of each other — describe at least 2 concrete
      structural differences you observe between, say, mobilePortrait and
      broadcastLowerThird.
   c. On the shrunk/tiny surface test case, screenshot it and confirm branding/logo
      is absent while CTA is visibly present and intact.
   d. Pull the DOM snapshot on at least 2 surfaces and confirm zero overlapping
      bounding boxes at the browser level (not just unit tests).
4. Show me all 5 screenshots, the raw DecisionTrace JSON for at least 2 surfaces,
   and the full contents of candidates.ts and scoring.ts.

Stop after these criteria are met — do not build the debugger UI, stress lab, or
any demo polish yet. Report back with results.