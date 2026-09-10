/**
 * Layout resolver.
 *
 * Phase 3 rewrite: instead of one greedy top-down pass, resolveLayout() now
 * orchestrates candidates.ts + scoring.ts —
 *
 *   1. generateCandidates(graph, context, surface)  → several strategies
 *   2. score every candidate with the deterministic fitness function
 *   3. pick the highest-scoring candidate (ties → the earliest, which is
 *      vertical-stack: the safe priority-ordered fallback)
 *   4. build a DecisionTrace recording every candidate's score and why one won
 *   5. return { layout, trace }
 *
 * There is NO per-surface branching here: the same code path runs for every
 * surface. resolver.test.ts checks this file (and candidates.ts / scoring.ts)
 * for hard-coded surface ids and asserts there are none.
 */

import { generateCandidates } from "./candidates";
import { scoreCandidate } from "./scoring";
import { buildTrace, type DecisionTrace } from "./trace";
import type { Context } from "./context";
import type { ExperienceGraph } from "./graph";
import type { SurfaceProfile } from "./surfaces";

export interface ResolvedElement {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  visible: boolean;
  role: string;
}

export interface ResolvedLayout {
  elements: ResolvedElement[];
}

export interface ResolveResult {
  layout: ResolvedLayout;
  trace: DecisionTrace;
}

/**
 * Resolve a layout for one surface via candidate generation + scoring.
 *
 * The returned `layout.elements` contains every graph node — the ones that did
 * not fit are present with `visible: false` (so callers can still see what was
 * dropped). Every visible element is guaranteed fully on-surface and
 * non-overlapping: candidates that break either invariant score 0 and cannot
 * win, and each strategy's placement engine additionally drops any element that
 * would violate it.
 */
export function resolveLayout(
  graph: ExperienceGraph,
  context: Context,
  surface: SurfaceProfile,
): ResolveResult {
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
}
