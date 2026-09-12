import { describe, it, expect } from "vitest";
import { scoreCandidate } from "../scoring";
import type { Candidate } from "../candidates";
import { buildGraph } from "../graph";
import { resolveContext } from "../context";
import { productAd, surfaceProfiles } from "../sample-data";
import type { ResolvedElement } from "../resolver";

const graph = buildGraph(productAd);
const surface = surfaceProfiles.retailKiosk; // has minTapTarget: 60, safeArea insets
const ctx = resolveContext(surface);

function vis(
  id: string,
  role: string,
  x: number,
  y: number,
  width: number,
  height: number,
): ResolvedElement {
  return { id, role, x, y, width, height, visible: true };
}
function dropped(id: string, role: string): ResolvedElement {
  return { id, role, x: 0, y: 0, width: 0, height: 0, visible: false };
}

/**
 * A clean, valid layout: three non-overlapping in-bounds boxes inside the safe
 * area, keeping priorities 1-3 and dropping 4-5 (no priority inversion). The
 * cta meets retailKiosk's 60px minTapTarget.
 */
function cleanCandidate(): Candidate {
  return {
    strategy: "vertical-stack",
    notes: [],
    elements: [
      vis("headline", "primary", 48, 48, 420, 96),
      vis("cta", "action", 48, 160, 200, 64),
      vis("product-image", "hero", 48, 240, 480, 480),
      dropped("price", "secondary"),
      dropped("logo", "branding"),
    ],
  };
}

describe("scoreCandidate", () => {
  it("a candidate with any overlap scores 0 overall (hard-fail)", () => {
    const c = cleanCandidate();
    // Move the cta on top of the headline.
    c.elements[1] = vis("cta", "action", 60, 60, 200, 64);
    expect(scoreCandidate(c, graph, ctx, surface).overall).toBe(0);
  });

  it("is deterministic — identical inputs produce an identical breakdown", () => {
    const a = scoreCandidate(cleanCandidate(), graph, ctx, surface);
    const b = scoreCandidate(cleanCandidate(), graph, ctx, surface);
    expect(a).toEqual(b);
  });

  it("satisfying more constraints scores strictly higher, all else equal", () => {
    const good = cleanCandidate();

    // Identical layout except the cta is shrunk below the 60px minTapTarget:
    // exactly one extra soft violation, same positions, same element count.
    const bad = cleanCandidate();
    bad.elements[1] = vis("cta", "action", 48, 160, 200, 50);

    const gScore = scoreCandidate(good, graph, ctx, surface);
    const bScore = scoreCandidate(bad, graph, ctx, surface);

    expect(gScore.constraintViolations).toBeGreaterThan(bScore.constraintViolations);
    expect(gScore.overall).toBeGreaterThan(bScore.overall);
  });

  it("a valid clean candidate scores above 0", () => {
    expect(scoreCandidate(cleanCandidate(), graph, ctx, surface).overall).toBeGreaterThan(0);
  });
});

describe("scoreCandidate — contextFit (§4.3-context)", () => {
  it("rewards horizontal-split over vertical-stack on a wide surface, all else equal", () => {
    const wideSurface = surfaceProfiles.broadcastLowerThird;
    const wideCtx = resolveContext(wideSurface);
    expect(wideCtx.aspectRatioClass).toBe("wide");

    const vertical: Candidate = { ...cleanCandidate(), strategy: "vertical-stack" };
    const horizontal: Candidate = { ...cleanCandidate(), strategy: "horizontal-split" };

    const vScore = scoreCandidate(vertical, graph, wideCtx, wideSurface);
    const hScore = scoreCandidate(horizontal, graph, wideCtx, wideSurface);

    expect(hScore.contextFit).toBeGreaterThan(vScore.contextFit);
  });

  it("rewards vertical-stack over horizontal-split on a tall surface, all else equal", () => {
    const tallSurface = surfaceProfiles.retailKiosk;
    const tallCtx = resolveContext(tallSurface);
    expect(tallCtx.aspectRatioClass).toBe("tall");

    const vertical: Candidate = { ...cleanCandidate(), strategy: "vertical-stack" };
    const horizontal: Candidate = { ...cleanCandidate(), strategy: "horizontal-split" };

    const vScore = scoreCandidate(vertical, graph, tallCtx, tallSurface);
    const hScore = scoreCandidate(horizontal, graph, tallCtx, tallSurface);

    expect(vScore.contextFit).toBeGreaterThan(hScore.contextFit);
  });

  it("rewards fewer visible elements under a short attention budget, strategy held constant", () => {
    const shortAttentionSurface = surfaceProfiles.mobilePortrait; // attentionWindow: 3s
    const shortCtx = resolveContext(shortAttentionSurface);
    expect(shortCtx.attentionBudget).toBe("short");

    const twoVisible: Candidate = {
      strategy: "vertical-stack",
      notes: [],
      elements: [
        vis("headline", "primary", 48, 48, 420, 96),
        vis("cta", "action", 48, 160, 200, 64),
        dropped("product-image", "hero"),
        dropped("price", "secondary"),
        dropped("logo", "branding"),
      ],
    };
    const fourVisible: Candidate = {
      strategy: "vertical-stack",
      notes: [],
      elements: [
        vis("headline", "primary", 48, 48, 420, 96),
        vis("cta", "action", 48, 160, 200, 64),
        vis("product-image", "hero", 48, 240, 480, 480),
        vis("price", "secondary", 48, 730, 64, 24),
        dropped("logo", "branding"),
      ],
    };

    const fewerScore = scoreCandidate(twoVisible, graph, shortCtx, shortAttentionSurface);
    const moreScore = scoreCandidate(fourVisible, graph, shortCtx, shortAttentionSurface);

    expect(fewerScore.contextFit).toBeGreaterThan(moreScore.contextFit);
  });

  it("is not affected by surface geometry — only strategy, visible count, and context", () => {
    // Same candidate, same context-derived flags, two different surfaces: the
    // contextFit sub-score must be identical because it never reads `surface`.
    const a = scoreCandidate(cleanCandidate(), graph, ctx, surfaceProfiles.retailKiosk);
    const b = scoreCandidate(cleanCandidate(), graph, ctx, surfaceProfiles.printQRPanel);
    expect(a.contextFit).toBe(b.contextFit);
  });
});
