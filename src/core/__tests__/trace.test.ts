import { describe, it, expect } from "vitest";
import { explainLoss } from "../trace";
import type { ScoreBreakdown } from "../scoring";

/**
 * Build a ScoreBreakdown from partial sub-scores. `overall` defaults to the
 * arithmetic mean of the eight sub-scores unless explicitly given — enough for
 * these tests, which only care about relative sub-score gaps.
 */
function breakdown(partial: Partial<ScoreBreakdown>): ScoreBreakdown {
  const sub = {
    constraintViolations: partial.constraintViolations ?? 100,
    priorityPreservation: partial.priorityPreservation ?? 100,
    visualBalance: partial.visualBalance ?? 100,
    tapTargetCompliance: partial.tapTargetCompliance ?? 100,
    contextFit: partial.contextFit ?? 100,
    renderCost: partial.renderCost ?? 100,
    adjacencyFit: partial.adjacencyFit ?? 100,
    compositionCohesion: partial.compositionCohesion ?? 100,
  };
  const overall =
    partial.overall ??
    Math.round(
      (sub.constraintViolations +
        sub.priorityPreservation +
        sub.visualBalance +
        sub.tapTargetCompliance +
        sub.contextFit +
        sub.renderCost +
        sub.adjacencyFit +
        sub.compositionCohesion) /
        8,
    );
  return { ...sub, overall };
}

describe("explainLoss", () => {
  it("names tap-target compliance when that sub-score has the largest gap", () => {
    const winner = breakdown({ tapTargetCompliance: 100 });
    const loser = breakdown({
      tapTargetCompliance: 89, // 11-point gap — the biggest
      visualBalance: 96,
      renderCost: 98,
    });
    const msg = explainLoss(loser, winner);
    expect(msg.toLowerCase()).toMatch(/tap.target/);
    expect(msg).toMatch(/11/); // the actual point gap
  });

  it("names visual balance when that sub-score has the largest gap", () => {
    const winner = breakdown({ visualBalance: 90 });
    const loser = breakdown({
      visualBalance: 62, // 28-point gap — the biggest
      tapTargetCompliance: 95,
      constraintViolations: 90,
    });
    const msg = explainLoss(loser, winner);
    expect(msg.toLowerCase()).toContain("balance");
    expect(msg).toMatch(/28/);
  });

  it("names constraint compliance when that sub-score has the largest gap", () => {
    const winner = breakdown({ constraintViolations: 100 });
    const loser = breakdown({
      constraintViolations: 50, // 50-point gap — the biggest
      visualBalance: 88,
      priorityPreservation: 90,
    });
    const msg = explainLoss(loser, winner);
    expect(msg.toLowerCase()).toContain("constraint");
    expect(msg).toMatch(/50/);
  });

  it("always mentions the numeric point gap, not just a qualitative word", () => {
    const winner = breakdown({ priorityPreservation: 100 });
    const loser = breakdown({ priorityPreservation: 73 });
    const msg = explainLoss(loser, winner);
    expect(msg).toMatch(/\d+/);
    expect(msg).toMatch(/27/);
  });

  it("falls back to the overall gap when no sub-score is worse (e.g. hard-fail)", () => {
    const winner = breakdown({ overall: 78 });
    const loser = breakdown({ overall: 0 }); // hard-failed but sub-scores equal
    const msg = explainLoss(loser, winner);
    expect(msg).toMatch(/78/);
  });
});
