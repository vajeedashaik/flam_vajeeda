/**
 * DecisionTrace — structured "why this layout" data attached to every
 * resolution. Not rendered nicely yet; Phase 4's debugger UI consumes this
 * object directly, so the strings here are written to be read by a person.
 */

import type { Candidate } from "./candidates";
import type { ScoreBreakdown } from "./scoring";

export interface DecisionTrace {
  /** Every candidate's strategy name and full score breakdown. */
  candidateScores: { strategy: string; score: ScoreBreakdown }[];
  /** The strategy whose candidate was selected. */
  winningStrategy: string;
  /**
   * One plain sentence explaining the pick, e.g.
   * `grid scored highest: 92/100 (vertical-stack=84, horizontal-split=91, overlay-safe-margins=0)`.
   */
  winningRationale: string;
  /**
   * One readable line per element the winning candidate shrank or dropped, e.g.
   * `logo: wanted 96×32, placed at 80×32 → shrunk 17%` or
   * `price: dropped — priority 4, no room left once every higher-priority element was placed`.
   */
  perElementNotes: string[];
}

/** Assemble the trace once the resolver has scored every candidate and picked one. */
export function buildTrace(
  candidates: Candidate[],
  scores: ScoreBreakdown[],
  winningIndex: number,
): DecisionTrace {
  const candidateScores = candidates.map((candidate, i) => ({
    strategy: candidate.strategy,
    score: scores[i]!,
  }));

  const winner = candidates[winningIndex]!;
  const winnerOverall = scores[winningIndex]!.overall;

  const others = candidateScores
    .filter((_, i) => i !== winningIndex)
    .map((cs) => `${cs.strategy}=${cs.score.overall}`)
    .join(", ");

  const winningRationale =
    `${winner.strategy} scored highest: ${winnerOverall}/100` +
    (others.length > 0 ? ` (${others})` : "");

  return {
    candidateScores,
    winningStrategy: winner.strategy,
    winningRationale,
    perElementNotes: winner.notes,
  };
}

/** The five weighted sub-scores, in the order the UI lists them. */
const SUB_SCORES: {
  key: keyof Omit<ScoreBreakdown, "overall">;
  /** Plain-language name of the sub-score. */
  label: string;
  /** Likely real-world cause when this sub-score is the one that dragged a candidate down. */
  cause: string;
}[] = [
  {
    key: "constraintViolations",
    label: "constraint compliance",
    cause: "an element likely broke its safe area, declared minimum size, or brand lock",
  },
  {
    key: "priorityPreservation",
    label: "priority preservation",
    cause: "it likely dropped more (or more important) content to make things fit",
  },
  {
    key: "visualBalance",
    label: "visual balance",
    cause: "its elements likely sat off-centre or varied too much in size",
  },
  {
    key: "tapTargetCompliance",
    label: "tap-target compliance",
    cause: "a tap target likely fell below the surface's minimum",
  },
  {
    key: "renderCost",
    label: "render efficiency",
    cause: "it likely used more, smaller elements — more expensive to draw",
  },
];

/**
 * Plain-language "why this candidate lost to the winner".
 *
 * Looks at every sub-score, finds the one where the winner beats this candidate
 * by the widest margin, and names it with the actual point gap. When no
 * sub-score is worse (a hard-fail zeroes `overall` while the sub-scores can stay
 * healthy), it falls back to the overall-score gap.
 *
 * Deterministic and derived entirely from the two ScoreBreakdown objects — no
 * hardcoded per-candidate text.
 */
export function explainLoss(
  candidateScore: ScoreBreakdown,
  winningScore: ScoreBreakdown,
): string {
  let worst: (typeof SUB_SCORES)[number] | null = null;
  let worstGap = 0;

  for (const s of SUB_SCORES) {
    const gap = winningScore[s.key] - candidateScore[s.key];
    if (gap > worstGap) {
      worstGap = gap;
      worst = s;
    }
  }

  if (worst === null) {
    const overallGap = winningScore.overall - candidateScore.overall;
    if (overallGap <= 0) {
      return "Scored no lower than the winner on any measure — it lost only the tie-break.";
    }
    return (
      `Scored ${overallGap} point${overallGap === 1 ? "" : "s"} lower overall ` +
      `with no single sub-score to blame — likely a hard-fail ` +
      `(overlap, off-surface, or a dropped must-keep element) zeroed its total.`
    );
  }

  return (
    `Scored ${worstGap} point${worstGap === 1 ? "" : "s"} lower on ${worst.label} ` +
    `(${winningScore[worst.key]} vs ${candidateScore[worst.key]}) — ${worst.cause}.`
  );
}
