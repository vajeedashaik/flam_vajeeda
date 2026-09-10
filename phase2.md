PHASE 2 — Experience Graph + Context Engine + MVP Resolver (single surface)

Context: Phase 1 built typed AdSpec and SurfaceProfile models (src/core/spec.ts,
src/core/surfaces.ts, src/core/sample-data.ts), fully tested. Do not modify those
files' public shape unless genuinely necessary — if you must change something in
them, tell me explicitly what and why before doing it.

GOAL FOR THIS PHASE
1. Build the Experience Graph: convert an AdSpec into a graph structure (nodes +
   relational edges) that becomes the source of truth for everything downstream.
2. Build a Context Engine: given a SurfaceProfile, produce a normalized "context"
   object that later phases will use to bias layout decisions.
3. Build a first, deliberately SIMPLE resolver (single greedy priority-ordered pass —
   no candidate generation/scoring yet, that's Phase 3) that produces a real layout
   for ONE surface at a time.
4. Render that resolved layout to actual DOM/CSS in a minimal React demo page, so we
   have something visible to test with chrome-devtools MCP for the first time.

Do NOT build: multi-candidate generation, fitness scoring, degradation across
multiple surfaces, any UI beyond the minimal demo page described below. Those are
later phases. Keep this phase's resolver intentionally basic — it just needs to be
CORRECT for one surface, not smart yet.

FOLDER STRUCTURE TO ADD
src/
  core/
    graph.ts              — ExperienceGraph type + buildGraph(spec): ExperienceGraph
    context.ts             — Context type + resolveContext(surface): Context
    resolver.ts             — resolveLayout(graph, context): ResolvedLayout (single pass)
    render-dom.ts            — pure function: ResolvedLayout -> nothing (this phase
                                 renders via React directly, see App.tsx below; keep
                                 render-dom.ts as a placeholder/stub with a comment
                                 explaining it will hold the framework-agnostic
                                 rendering logic once React is just a thin wrapper —
                                 don't over-build this yet)
  core/__tests__/
    graph.test.ts
    context.test.ts
    resolver.test.ts
  App.tsx                  — minimal demo: renders the sample ad spec resolved
                                against ONE hardcoded surface (mobilePortrait)

REQUIREMENTS — graph.ts (Experience Graph)
- ExperienceGraph = { nodes: GraphNode[], edges: GraphEdge[] }
- GraphNode wraps an AdSpec element and adds: computed edges list, and passthrough
  of all Phase-1 fields (importance, interaction, visibility, minSize,
  preferredSize, brandRules).
- GraphEdge = { from: string; to: string; type: "proximity" | "alignment" | "exclusion" }
- buildGraph(spec: AdSpec): ExperienceGraph
    - Auto-derive at least these edges from role semantics (document the rule you use):
        - proximity edge between any element with role "secondary" (e.g. price) and
          the element with role "action" (CTA) — they should be evaluated as a pair.
        - exclusion edge between "hero" and "branding" elements (they must never
          overlap, regardless of surface).
    - This derivation logic must be a clear, commented, deterministic rule set — not
      hardcoded per specific element id. It should generalize to any AdSpec built
      with defineAd(), not just the sample data.
- Export a helper `getRelatedNodes(graph, nodeId, edgeType?)` for later phases.

REQUIREMENTS — context.ts (Context Engine)
- Context = normalized surface context: 
    { aspectRatioClass: "tall" | "wide" | "square",
      isTouchInteractive: boolean,
      isFarViewing: boolean,
      attentionBudget: "short" | "medium" | "long",
      hasAudio: boolean,
      allowsMotion: boolean }
- resolveContext(surface: SurfaceProfile): Context
    - aspectRatioClass derived from width/height ratio (document your thresholds).
    - isFarViewing derived from viewingDistance (handle both the "near"|"far" enum
      case AND numeric cm case from Phase 1's type).
    - attentionBudget derived from attentionWindow if present, else default "medium".
    - Write this as pure, deterministic logic — no magic unexplained numbers; put
      the thresholds in named constants at the top of the file.

REQUIREMENTS — resolver.ts (MVP single-pass resolver)
- ResolvedLayout = { elements: ResolvedElement[] }
- ResolvedElement = { id: string; x: number; y: number; width: number; height: number;
    visible: boolean; role: string }  (extend as needed, keep typed)
- resolveLayout(graph: ExperienceGraph, context: Context, surface: SurfaceProfile): ResolvedLayout
    - Sort nodes by priority (ascending = most critical first).
    - Walk the surface's available space top-down, placing each element in priority
      order, respecting surface.safeArea if present.
    - If an element doesn't fit at its preferredSize, shrink it toward minSize before
      moving to the next element.
    - If it still doesn't fit even at minSize, mark `visible: false` (drop it) rather
      than overlapping or clipping — cleanly skip it, do not render partial/clipped
      elements.
    - HARD INVARIANT (write a test for this): no two visible ResolvedElements'
      bounding boxes overlap, and no visible element's bounds exceed the surface's
      width/height (or safeArea if present).
    - This is deliberately a simple greedy pass — no candidate generation or scoring
      yet. That's fine for this phase.

REQUIREMENTS — App.tsx (minimal demo page)
- Import the sample ad spec and the mobilePortrait surface from Phase 1's sample-data.ts.
- Call buildGraph -> resolveContext -> resolveLayout, then render each visible
  ResolvedElement as an absolutely-positioned <div> inside a container div sized to
  the surface's width/height (use a fixed pixel-to-CSS mapping, no scaling tricks yet).
- Each element div should show its role as text content so we can visually confirm
  which element is which.
- No styling polish needed — this is a correctness check, not the final demo UI.

TESTS TO WRITE (Vitest)
- graph.test.ts: buildGraph() produces the expected proximity and exclusion edges
  for the sample spec; verify it also works on a hand-built minimal spec with
  different roles (proving it's not hardcoded to the sample data).
- context.test.ts: resolveContext() produces correct classifications for at least
  3 distinct surface profiles from Phase 1's sample data (mobilePortrait,
  broadcastLowerThird, retailKiosk) — assert exact expected Context values for each.
- resolver.test.ts:
  - resolveLayout() on mobilePortrait with the sample spec produces zero overlapping
    visible elements (write an explicit overlap-detection assertion, don't eyeball it).
  - resolveLayout() on a deliberately tiny surface (e.g. 100x100) causes at least one
    low-priority element to be dropped (visible: false) rather than clipped or
    overlapping — assert this explicitly.

ACCEPTANCE CRITERIA — DO NOT PROCEED PAST THIS PHASE UNTIL ALL OF THESE PASS
1. `tsc --noEmit` clean.
2. All Vitest tests pass — paste full output.
3. Run the dev server (`npm run dev`), then use chrome-devtools MCP to:
   a. Navigate to the local dev URL.
   b. Take a screenshot of the rendered page.
   c. Use the DOM/accessibility snapshot to confirm the number of rendered element
      divs matches the number of `visible: true` elements the resolver returned for
      mobilePortrait (log the resolver's raw output alongside the screenshot for
      comparison).
   d. Confirm via the accessibility/DOM snapshot that no element's bounding box
      (via getBoundingClientRect or computed style) overlaps another's — this is a
      real browser-level check, not just the unit test.
4. Show me the screenshot, the devtools inspection output, and the full contents of
   graph.ts, context.ts, and resolver.ts.

Stop after these criteria are met and report back — do not start multi-surface
support, candidate generation, or scoring. Those are Phase 3.