import { describe, it, expect } from "vitest";
import { generateCandidates, type Candidate, type CandidateStrategy } from "../candidates";
import { buildGraph } from "../graph";
import { resolveContext } from "../context";
import { productAd, surfaceProfiles } from "../sample-data";

const ALL_STRATEGIES: CandidateStrategy[] = [
  "vertical-stack",
  "horizontal-split",
  "overlay-safe-margins",
  "grid",
];

const graph = buildGraph(productAd);

function strat(cands: Candidate[], s: CandidateStrategy): Candidate {
  const c = cands.find((x) => x.strategy === s);
  if (!c) throw new Error(`no candidate for strategy ${s}`);
  return c;
}
function el(c: Candidate, id: string) {
  const e = c.elements.find((x) => x.id === id);
  if (!e) throw new Error(`no element ${id}`);
  return e;
}

// Two surfaces with very different aspect ratios.
const SURFACES = ["retailKiosk", "broadcastLowerThird"] as const;

describe("generateCandidates", () => {
  for (const key of SURFACES) {
    const surface = surfaceProfiles[key];
    const ctx = resolveContext(surface);
    const cands = generateCandidates(graph, ctx, surface);

    it(`${key}: returns >= 3 distinct, valid strategies`, () => {
      const strategies = new Set(cands.map((c) => c.strategy));
      expect(strategies.size).toBeGreaterThanOrEqual(3);
      for (const c of cands) {
        expect(ALL_STRATEGIES).toContain(c.strategy);
      }
    });

    it(`${key}: vertical-stack and horizontal-split differ in RELATIVE arrangement (not just scale)`, () => {
      const vs = strat(cands, "vertical-stack");
      const hs = strat(cands, "horizontal-split");

      const vHead = el(vs, "headline");
      const vCta = el(vs, "cta");
      const hHead = el(hs, "headline");
      const hCta = el(hs, "cta");

      // vertical-stack: the action sits BELOW the primary, sharing a left edge.
      expect(vCta.y).toBeGreaterThan(vHead.y);
      expect(vCta.x).toBeCloseTo(vHead.x, 3);

      // horizontal-split: the action sits RIGHT OF the primary, sharing a top edge.
      expect(hCta.x).toBeGreaterThan(hHead.x);
      expect(hCta.y).toBeCloseTo(hHead.y, 3);

      // The primary→action offset flips axis between the two layouts, so one is
      // provably not a uniformly-scaled copy of the other.
      const verticalDelta = vCta.y - vHead.y;
      const horizontalDelta = hCta.x - hHead.x;
      expect(verticalDelta).toBeGreaterThan(0);
      expect(horizontalDelta).toBeGreaterThan(0);
    });

    it(`${key}: grid is 2-D — visible elements occupy at least two distinct rows`, () => {
      const g = strat(cands, "grid");
      const vis = g.elements.filter((e) => e.visible);
      const rowYs = vis.map((e) => Math.round(e.y));
      const distinctRows = new Set(rowYs);
      expect(distinctRows.size).toBeGreaterThanOrEqual(2);
      // At least two elements share a row (same y) — impossible in a pure
      // vertical stack, so grid differs structurally from vertical-stack too.
      expect(rowYs.length - distinctRows.size).toBeGreaterThanOrEqual(1);
    });
  }
});
