PHASE 7 — Wire the Experience Graph into Scoring (adjacencyFit) + Fix Visual Balance
          Corner-Spreading + Unsatisfiable-Surface Test

Context: Phases 1–6 built a working candidate-generation-and-scoring resolver with
an Experience Graph (src/core/graph.ts) that derives "proximity" edges (e.g. between
"secondary" and "action" role elements) and "exclusion" edges (e.g. between "hero"
and "branding") from role semantics. Verified by inspection: graph.edges and
getRelatedNodes() are currently referenced ONLY inside graph.ts and graph.test.ts —
no strategy in candidates.ts and no rule in scoring.ts ever reads edge data. This
means the graph's proximity relationships (e.g. "price belongs beside CTA") exist
but have zero effect on the actual resolved layout. Visually, this produces
layouts where related elements (price and CTA) end up in opposite corners of the
surface with a large empty void between them — confirmed against a real screenshot
where price sat bottom-left and CTA sat bottom-right on a surface with substantial
unused center space.

This phase has three parts. Do NOT modify graph.ts's edge-derivation logic, the
core resolver orchestration in resolver.ts, candidates.ts's placement strategies'
STRUCTURE (vertical-stack/horizontal-split/grid/overlay-safe-margins must remain
the same four strategies), or any UI component from Phases 1–6 beyond what's
explicitly required to display the new sub-score. This is a scoring-layer fix, not
an architecture change — the goal is to make an already-correct idea actually
influence output, not to redesign anything.

═══════════════════════════════════════
7.1 — ADJACENCY FIT SUB-SCORE (the main fix)
═══════════════════════════════════════
GOAL: Add a new deterministic sub-score to ScoreBreakdown that rewards candidates
where graph-proximity-linked element pairs end up spatially close together, and
penalizes candidates where they're far apart — directly consuming graph.edges data
that currently goes unused.

FILES TO MODIFY
  src/core/scoring.ts    — add adjacencyFit computation
  src/core/__tests__/scoring.test.ts   — new tests for adjacencyFit

REQUIREMENTS
- Extend ScoreBreakdown (defined in scoring.ts, used by trace.ts and the UI panels)
  with a new field: `adjacencyFit: number` (0-100, same scale as existing sub-scores).
  If changing this shared type requires updates elsewhere (trace.ts, the
  LayoutHealthCheck/LayoutCounterfactuals components from Phase 4), make ONLY the
  minimal additive changes needed — add a new checklist row to LayoutHealthCheck.tsx
  for "Element grouping" using the same ✓/⚠/✕ threshold pattern already used for the
  other five sub-scores, and ensure LayoutCounterfactuals' explainLoss() can now
  also identify adjacencyFit as the largest-gap sub-score when relevant (it already
  iterates over ScoreBreakdown fields generically — confirm this, don't hardcode a
  new branch if the existing logic already generalizes).
- Write `computeAdjacencyFit(candidate, graph): number`:
    1. Get every proximity edge from the graph: `getRelatedNodes(graph, nodeId, "proximity")`
       for each node, or iterate graph.edges directly filtered to type === "proximity"
       — use whichever the existing graph.ts API makes cleanest, don't add a new
       graph API unless nothing suitable exists.
    2. For each proximity-linked pair where BOTH elements are visible in this
       candidate: compute the Euclidean distance between their bounding-box centers,
       normalized by (surface diagonal or average element size — pick one, document
       which and why in a code comment).
    3. Convert normalized distance to a 0-100 score per pair: closer = higher score.
       Document the exact formula and thresholds in a comment — no unexplained magic
       numbers.
    4. If a proximity-linked element is NOT visible (was dropped), that pair
       contributes a neutral/skip value (document your choice — e.g. skip it
       entirely from the average, since the exclusion is already enforced elsewhere
       and a dropped element being "far" from its pair is meaningless).
    5. If there are zero proximity edges in the graph for this spec, return a
       neutral 100 (don't penalize specs with no relational structure).
    6. Average across all evaluated pairs for the candidate's final adjacencyFit.
- Wire adjacencyFit into the overall weighted score in scoreCandidate() alongside
  the existing five sub-scores. Pick and document a weight — it should be
  meaningful enough to actually change which candidate wins (that's the whole
  point of this phase) but should NOT override the existing hard-fail rule
  (overlap/out-of-bounds must still force overall = 0 regardless of adjacencyFit).
- This must NOT introduce any new overlap risk — adjacencyFit is a scoring signal
  that influences which valid candidate wins, it must never cause the placement
  logic itself to move elements closer in a way that could violate the existing
  no-overlap/in-bounds hard invariant. Placement logic in candidates.ts stays
  untouched; only which already-valid candidate scores highest may change.

TESTS TO WRITE (scoring.test.ts)
- computeAdjacencyFit() returns a higher score for a manually-constructed candidate
  where a proximity-linked pair (e.g. price + CTA) is spatially close than for an
  otherwise-identical candidate where the same pair is placed in opposite corners.
- computeAdjacencyFit() returns neutral (100) for a spec with zero proximity edges.
- computeAdjacencyFit() correctly skips/neutrally-handles a pair where one element
  was dropped (visible: false).
- Determinism test: same candidate + same graph called twice → identical score.
- Full-pipeline test: using the existing sample spec (headline/hero/price/cta/logo)
  on at least one surface where the previous winning strategy was "grid" or
  "overlay-safe-margins" with price/CTA far apart, assert that after this change
  the winning candidate's adjacencyFit score is HIGHER than it would have been
  under the previous grid arrangement — if you can, directly compare against a
  hardcoded "grid with corners" candidate constructed manually in the test to prove
  the new sub-score would have penalized it relative to a grouped alternative.

7.1 ACCEPTANCE CHECK:
- All new tests pass.
- Re-run the FULL existing test suite from all prior phases — zero regressions,
  paste complete output.
- Using chrome-devtools MCP: screenshot the single-surface view for the surface
  that most visibly showed the disconnected-corners problem before this change
  (identify which one from the earlier screenshots — likely retailKiosk or a
  similar square/roomy surface). Confirm visually that price and CTA (or whichever
  proximity-linked pair exists in the sample spec) now render closer together than
  before, with less dead space between them. Also screenshot the Layout Health
  Check panel showing the new "Element grouping" row populated with a real score.

═══════════════════════════════════════
7.2 — AUDIT AND FIX VISUAL BALANCE'S CORNER-SPREADING BIAS
═══════════════════════════════════════
GOAL: Determine whether the existing visualBalance sub-score formula rewards
"elements spread apart / evenly distributed across the full surface" versus
rewarding "elements grouped together with purposeful negative space" — these
produce opposite results, and the corner-spread screenshot suggests the former is
currently being rewarded, which fights directly against the adjacencyFit fix in 7.1.

STEPS
1. Read the current visualBalance implementation in scoring.ts and report back,
   in plain language, exactly what geometric property it measures and rewards.
   Do this BEFORE changing anything — I want to know what it currently does.
2. If it rewards spreading elements evenly across the full surface bounding box
   (e.g. by rewarding even whitespace distribution or penalizing "clustering"),
   this is the root cause working against 7.1 and must be adjusted: change it to
   reward a coherent overall composition (e.g. penalize excessive UNUSED
   contiguous whitespace in the center/middle of the surface specifically, rather
   than penalizing elements being near each other) — document the exact new
   formula and why it no longer conflicts with adjacencyFit.
3. If it does NOT reward spreading (i.e. the corner-spread outcome in the
   screenshot was caused by something else — e.g. the grid strategy's own
   placement logic naturally produces that shape and no sub-score was rewarding
   it, it just wasn't being penalized), report that finding instead of changing
   anything unnecessarily, and rely on 7.1's adjacencyFit alone to fix the
   observed behavior.
4. Either way, add a test in scoring.test.ts asserting visualBalance's actual,
   current, intended behavior explicitly (whatever it ends up being after this
   phase) — this sub-score currently has no dedicated test and that's a gap
   regardless of whether it changes.

7.2 ACCEPTANCE CHECK:
- Full test suite still passes, zero regressions.
- Written report (in your response, not a new doc file) stating clearly: what
  visualBalance measured before, whether it was changed, and why.

═══════════════════════════════════════
7.3 — UNSATISFIABLE-SURFACE TEST (closes the one gap vs. sibling projects)
═══════════════════════════════════════
GOAL: Add a test proving the engine fails gracefully — not by crashing or silently
producing an invalid layout — when given a surface that is mathematically
impossible to satisfy.

FILES TO ADD/MODIFY
  src/core/__tests__/resolver.test.ts   — new test case
  (add a helper impossible surface to sample-data.ts or construct it inline in
  the test — your choice, document which)

REQUIREMENTS
- Construct a surface that cannot possibly satisfy its own constraints — e.g. a
  100×40 surface with touchOnly: true and minTapTarget: 120 (a tap target larger
  than the entire surface). This must pass Phase 1's defineSurface() validation
  (it's a valid SurfaceProfile shape, just geometrically unsatisfiable) — if
  defineSurface() itself rejects this for an unrelated reason, adjust the example
  until it's a valid SurfaceProfile that is merely impossible to lay out.
- Run the full pipeline (buildGraph → resolveContext → resolveLayout) against it.
- Assert: the function does NOT throw/crash, and the result has EITHER a clear,
  low/hard-failed score (overall = 0 or every candidate hard-failed) OR — if you
  implement this — a resolved layout with zero visible elements (everything
  correctly dropped) rather than any overlapping/out-of-bounds output.
- If resolveLayout's return type doesn't currently make "this surface could not
  be satisfied" easy to check directly, that's fine for this phase — the test can
  inspect trace.candidateScores to confirm all candidates hard-failed. Do NOT
  add a new `valid` field to the return type in this phase — that's a larger API
  change, out of scope here, note it as a follow-up instead if genuinely needed.

7.3 ACCEPTANCE CHECK:
- New test passes, proving no crash and no invariant violation on an impossible
  surface — paste the test output.
- Full suite, zero regressions.

═══════════════════════════════════════
FINAL PHASE 7 ACCEPTANCE CRITERIA
═══════════════════════════════════════
1. `tsc --noEmit` clean.
2. FULL test suite from every phase (1 through 7) passes with zero failures —
   paste complete output.
3. Production build (`npm run build`) still succeeds.
4. All chrome-devtools screenshots from 7.1's acceptance check delivered.
5. The plain-language report from 7.2 delivered.
6. Re-run the Stress Lab (200 surfaces) via chrome-devtools MCP one more time and
   confirm the "failed" count is still 0 — this is the regression check that
   matters most, since 7.1/7.2 touch scoring.ts directly. If failed > 0 after this
   change, STOP, do not proceed, and report the exact failure before doing
   anything else.
7. Show the full diff (or before/after excerpts) of scoring.ts.

Report back with all of the above.