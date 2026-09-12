import { describe, it, expect } from "vitest";
import { scoreCandidate, computeAdjacencyFit, computeCompositionCohesion } from "../scoring";
import { availableBox, generateCandidates, type Candidate } from "../candidates";
import { buildGraph } from "../graph";
import type { ExperienceGraph } from "../graph";
import { resolveContext } from "../context";
import { resolveLayout } from "../resolver";
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
 * A clean, valid layout: three non-overlapping in-bounds boxes inside the
 * safe area, keeping priorities 1-3 (headline, cta, product-image — all
 * `visibility: "always"` since §7.8, product-image being "the highlight") and
 * dropping the two `"degradable"`/`"decorative-only"` elements, price and
 * logo (priorities 4-5 — no priority inversion). The cta meets retailKiosk's
 * 60px minTapTarget.
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

/**
 * §7.1 — computeAdjacencyFit consumes graph.edges' "proximity" data (Rule P:
 * every "secondary" role paired with every "action" role). The sample spec
 * has exactly one such edge: price (secondary) ↔ cta (action).
 */
describe("computeAdjacencyFit (§7.1: wiring the Experience Graph's proximity edges into scoring)", () => {
  it("scores a proximity-linked pair placed close together higher than the same pair in opposite corners", () => {
    const kiosk = surfaceProfiles.retailKiosk; // roomy — corners are genuinely far apart
    const box = availableBox(kiosk);

    const close = cleanCandidate(); // headline/cta/product-image stacked, price dropped — replace price with a close placement
    close.elements[3] = vis("price", "secondary", 48, 246, 140, 48); // directly beside the cta (48,160,200,64)

    const far: Candidate = {
      strategy: "overlay-safe-margins",
      notes: [],
      elements: [
        vis("headline", "primary", box.x, box.y, 420, 96),
        vis("cta", "action", box.x, box.y, 200, 64), // top-left corner
        dropped("product-image", "hero"),
        vis("price", "secondary", box.x + box.width - 140, box.y + box.height - 48, 140, 48), // opposite, bottom-right corner
        dropped("logo", "branding"),
      ],
    };

    const closeScore = computeAdjacencyFit(close, graph, kiosk);
    const farScore = computeAdjacencyFit(far, graph, kiosk);
    expect(closeScore).toBeGreaterThan(farScore);
  });

  it("returns a neutral 100 for a graph with zero proximity edges", () => {
    const noProximityGraph: ExperienceGraph = {
      nodes: graph.nodes,
      edges: graph.edges.filter((e) => e.type !== "proximity"),
    };
    expect(computeAdjacencyFit(cleanCandidate(), noProximityGraph, surface)).toBe(100);
  });

  it("skips a pair where one element was dropped — neutral, not penalized", () => {
    const ctaDropped: Candidate = {
      strategy: "vertical-stack",
      notes: [],
      elements: [
        vis("headline", "primary", 48, 48, 420, 96),
        dropped("cta", "action"),
        vis("product-image", "hero", 48, 160, 480, 480),
        vis("price", "secondary", 48, 650, 140, 48),
        dropped("logo", "branding"),
      ],
    };
    // The only proximity edge (price ↔ cta) has its cta endpoint dropped, so
    // there are zero EVALUABLE pairs — same neutral outcome as no edges at all.
    expect(computeAdjacencyFit(ctaDropped, graph, surface)).toBe(100);
  });

  it("is deterministic — identical inputs produce an identical score", () => {
    const a = computeAdjacencyFit(cleanCandidate(), graph, surface);
    const b = computeAdjacencyFit(cleanCandidate(), graph, surface);
    expect(a).toBe(b);
  });

  it("on a real surface where overlay-safe-margins spreads price/cta into opposite corners, a candidate that keeps them close scores strictly higher adjacencyFit — proving the graph's proximity data now has a real effect", () => {
    const kiosk = surfaceProfiles.retailKiosk;
    const kioskCtx = resolveContext(kiosk);
    const candidates = generateCandidates(graph, kioskCtx, kiosk);
    const overlay = candidates.find((c) => c.strategy === "overlay-safe-margins")!;
    const verticalStack = candidates.find((c) => c.strategy === "vertical-stack")!;

    // Sanity: confirm this candidate really is the far-corners shape the
    // phase 7 bug report describes — cta and price several hundred px apart.
    const overlayCta = overlay.elements.find((e) => e.id === "cta")!;
    const overlayPrice = overlay.elements.find((e) => e.id === "price")!;
    expect(overlayCta.visible && overlayPrice.visible).toBe(true);
    const overlayDist = Math.hypot(
      overlayCta.x + overlayCta.width / 2 - (overlayPrice.x + overlayPrice.width / 2),
      overlayCta.y + overlayCta.height / 2 - (overlayPrice.y + overlayPrice.height / 2),
    );
    expect(overlayDist).toBeGreaterThan(500); // genuinely far apart, not a rounding artifact

    const overlayAdjacency = computeAdjacencyFit(overlay, graph, kiosk);
    const verticalAdjacency = computeAdjacencyFit(verticalStack, graph, kiosk);
    expect(verticalAdjacency).toBeGreaterThan(overlayAdjacency);

    // And it is not just an isolated sub-score number: scoreCandidate's overall
    // weighted total now reports this same gap as part of `adjacencyFit`, so
    // it genuinely feeds into which candidate the resolver prefers.
    const overlayFull = scoreCandidate(overlay, graph, kioskCtx, kiosk);
    const verticalFull = scoreCandidate(verticalStack, graph, kioskCtx, kiosk);
    expect(overlayFull.adjacencyFit).toBe(overlayAdjacency);
    expect(verticalFull.adjacencyFit).toBe(verticalAdjacency);
  });

  it("full pipeline: the resolver's actual winner on a wide sample surface beats overlay-safe-margins outright and shows strictly more content", () => {
    // broadcastLowerThird is the wide surface where overlay-safe-margins used
    // to win outright (84/100) with price/cta in opposite corners before §7.1.
    // §7.7 promoted price/logo to visibility:"always", which changes
    // overlay-safe-margins's OWN 4-corner shape too (it now seats the 4
    // always-elements and drops product-image instead of logo) — so its own
    // price↔cta adjacency can coincidentally improve. The invariant that
    // actually matters is unchanged: overlay's scattered/incomplete
    // composition must not be the resolver's actual choice, and whichever
    // candidate wins must show at least as much content.
    const wide = surfaceProfiles.broadcastLowerThird;
    const wideCtx = resolveContext(wide);
    const candidates = generateCandidates(graph, wideCtx, wide);
    const overlay = candidates.find((c) => c.strategy === "overlay-safe-margins")!;
    const overlayScore = scoreCandidate(overlay, graph, wideCtx, wide);
    const overlayVisible = overlay.elements.filter((e) => e.visible).length;

    const scores = candidates.map((c) => scoreCandidate(c, graph, wideCtx, wide));
    let winningIndex = 0;
    for (let i = 1; i < scores.length; i++) {
      if (scores[i]!.overall > scores[winningIndex]!.overall) winningIndex = i;
    }
    const winner = candidates[winningIndex]!;
    const winnerScore = scores[winningIndex]!;
    const winnerVisible = winner.elements.filter((e) => e.visible).length;

    expect(winner.strategy).not.toBe("overlay-safe-margins");
    expect(winnerScore.overall).toBeGreaterThan(overlayScore.overall);
    expect(winnerVisible).toBeGreaterThanOrEqual(overlayVisible);
  });
});

/**
 * §7.2 — audit of visualBalance's actual behaviour. Before this phase, it was
 * suspected of rewarding "spread out" layouts, which would fight directly
 * against adjacencyFit. Investigation (see ARCHITECTURE.md §4e) found that
 * visualBalanceScore measures two things ONLY: how close the area-WEIGHTED
 * CENTROID of all visible elements sits to the box centre, and how even their
 * areas are — neither of which is "inter-element distance." A symmetric
 * arrangement has the same centroid whether its elements are clustered
 * together or pushed to opposite corners, so the formula is provably
 * INDIFFERENT to spread, not a reward for it. No formula change was made;
 * this test documents that actual, intended behaviour explicitly, closing the
 * "no dedicated test" gap the phase brief called out.
 */
describe("scoreCandidate — visualBalance (§7.2 audit: confirms it does not reward spreading elements apart)", () => {
  it("scores a symmetric close cluster the same as the same two elements pushed to opposite corners, when both are centred on the box", () => {
    const kiosk = surfaceProfiles.retailKiosk;
    const box = availableBox(kiosk);
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;

    const clustered: Candidate = {
      strategy: "vertical-stack",
      notes: [],
      elements: [
        vis("headline", "primary", cx - 110, cy - 50, 100, 100),
        vis("cta", "action", cx + 10, cy - 50, 100, 100),
        dropped("product-image", "hero"),
        dropped("price", "secondary"),
        dropped("logo", "branding"),
      ],
    };
    const spread: Candidate = {
      strategy: "overlay-safe-margins",
      notes: [],
      elements: [
        vis("headline", "primary", box.x, box.y, 100, 100),
        vis("cta", "action", box.x + box.width - 100, box.y + box.height - 100, 100, 100),
        dropped("product-image", "hero"),
        dropped("price", "secondary"),
        dropped("logo", "branding"),
      ],
    };

    const clusteredScore = scoreCandidate(clustered, graph, ctx, kiosk).visualBalance;
    const spreadScore = scoreCandidate(spread, graph, ctx, kiosk).visualBalance;

    // Same area-weighted centroid (both symmetric around the box centre) and
    // same size-evenness (identical element sizes) → the formula cannot tell
    // them apart, by design of what it measures.
    expect(clusteredScore).toBe(spreadScore);
  });

  it("rewards an off-centre candidate less than an otherwise-identical centred one", () => {
    const kiosk = surfaceProfiles.retailKiosk;
    const box = availableBox(kiosk);
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;

    const centred: Candidate = {
      strategy: "vertical-stack",
      notes: [],
      elements: [
        vis("headline", "primary", cx - 100, cy - 50, 200, 100),
        dropped("cta", "action"),
        dropped("product-image", "hero"),
        dropped("price", "secondary"),
        dropped("logo", "branding"),
      ],
    };
    const offCentre: Candidate = {
      ...centred,
      elements: [
        vis("headline", "primary", box.x, box.y, 200, 100), // jammed into the top-left corner
        dropped("cta", "action"),
        dropped("product-image", "hero"),
        dropped("price", "secondary"),
        dropped("logo", "branding"),
      ],
    };

    const centredScore = scoreCandidate(centred, graph, ctx, kiosk).visualBalance;
    const offCentreScore = scoreCandidate(offCentre, graph, ctx, kiosk).visualBalance;
    expect(centredScore).toBeGreaterThan(offCentreScore);
  });
});

/**
 * §7.4 — computeCompositionCohesion judges the WHOLE visible set as one
 * composition, not just one declared graph pair (that's adjacencyFit's job).
 * A real ad's elements are never independent pieces scattered into separate
 * corners with a dead void between them; this sub-score is what stops a
 * strategy like overlay-safe-margins from winning just because its
 * constraintViolations/priorityPreservation numbers happen to be clean.
 */
describe("computeCompositionCohesion (§7.4: the whole ad must read as one connected composition)", () => {
  it("returns neutral 100 when fewer than two elements are visible", () => {
    const single: Candidate = {
      strategy: "vertical-stack",
      notes: [],
      elements: [
        vis("headline", "primary", 48, 48, 420, 96),
        dropped("cta", "action"),
        dropped("product-image", "hero"),
        dropped("price", "secondary"),
        dropped("logo", "branding"),
      ],
    };
    expect(computeCompositionCohesion(single)).toBe(100);
  });

  it("scores a tightly packed cluster of elements higher than the same elements scattered into far corners", () => {
    const packed: Candidate = {
      strategy: "vertical-stack",
      notes: [],
      elements: [
        vis("headline", "primary", 0, 0, 200, 100),
        vis("cta", "action", 0, 100, 100, 60),
        vis("product-image", "hero", 100, 100, 100, 60),
        dropped("price", "secondary"),
        dropped("logo", "branding"),
      ],
    };
    const scattered: Candidate = {
      strategy: "overlay-safe-margins",
      notes: [],
      elements: [
        vis("headline", "primary", 0, 0, 200, 100), // top-left
        vis("cta", "action", 1800, 0, 100, 60), // top-right, far away
        vis("product-image", "hero", 0, 1800, 100, 60), // bottom-left, far away
        dropped("price", "secondary"),
        dropped("logo", "branding"),
      ],
    };

    const packedScore = computeCompositionCohesion(packed);
    const scatteredScore = computeCompositionCohesion(scattered);
    expect(packedScore).toBeGreaterThan(scatteredScore);
    // The scattered case should read as genuinely bad, not just "a bit worse".
    expect(scatteredScore).toBeLessThan(20);
  });

  it("is deterministic — identical inputs produce an identical score", () => {
    const c = cleanCandidate();
    const a = computeCompositionCohesion(c);
    const b = computeCompositionCohesion(c);
    expect(a).toBe(b);
  });

  it("does not penalize a legitimate full-width composition that efficiently fills its own footprint", () => {
    // A wide banner showing its FULL content (coverage = 1, same as any other
    // candidate that drops nothing): headline/cta/image/price/logo laid out
    // left-to-right, each large relative to the small gaps between them —
    // this is a normal, good wide-format ad (like a real lower-third), not
    // "scattered corners with a dead void." It should score well despite
    // spanning the surface.
    const wideBanner: Candidate = {
      strategy: "horizontal-split",
      notes: [],
      elements: [
        vis("headline", "primary", 0, 0, 500, 200),
        vis("cta", "action", 510, 0, 300, 200),
        vis("product-image", "hero", 820, 0, 400, 200),
        vis("price", "secondary", 1230, 0, 250, 200),
        vis("logo", "branding", 1490, 0, 150, 200),
      ],
    };
    expect(computeCompositionCohesion(wideBanner)).toBeGreaterThan(90);
  });

  it("on every real sample surface, overlay-safe-margins's scattered corners never score BETTER than vertical-stack's clustered arrangement on compositionCohesion", () => {
    // Not a strict ">" everywhere: on a wide-but-short surface, vertical-stack
    // itself has to drop content to fit (§7.6 — its own coverage suffers), so
    // it can land in a near-tie with overlay rather than a clean win. What
    // must never happen is overlay's scattered corners coming out AHEAD.
    for (const surfaceKey of [
      "mobilePortrait",
      "mobileLandscape",
      "broadcastLowerThird",
      "retailKiosk",
      "printQRPanel",
    ] as const) {
      const s = surfaceProfiles[surfaceKey];
      const sCtx = resolveContext(s);
      const candidates = generateCandidates(graph, sCtx, s);
      const overlay = candidates.find((c) => c.strategy === "overlay-safe-margins")!;
      const vertical = candidates.find((c) => c.strategy === "vertical-stack")!;

      const overlayCohesion = computeCompositionCohesion(overlay);
      const verticalCohesion = computeCompositionCohesion(vertical);
      expect(
        verticalCohesion,
        `${surfaceKey}: expected vertical-stack's cohesion (${verticalCohesion}) >= overlay-safe-margins's (${overlayCohesion})`,
      ).toBeGreaterThanOrEqual(overlayCohesion);
    }
  });

  it("REGRESSION GUARD: overlay-safe-margins's scattered-corners arrangement does not win the real resolver on any of the 5 sample surfaces", () => {
    // This is the exact user-facing bug this sub-score exists to fix: an ad
    // whose components are split across separate corners with a dead void in
    // the middle must never be the pipeline's actual choice.
    for (const surfaceKey of [
      "mobilePortrait",
      "mobileLandscape",
      "broadcastLowerThird",
      "retailKiosk",
      "printQRPanel",
    ] as const) {
      const s = surfaceProfiles[surfaceKey];
      const { trace } = resolveLayout(graph, resolveContext(s), s);
      expect(
        trace.winningStrategy,
        `${surfaceKey} resolved to overlay-safe-margins's scattered-corners layout`,
      ).not.toBe("overlay-safe-margins");
    }
  });

  /**
   * §7.6 — density alone made compositionCohesion gameable: a candidate that
   * DROPS elements shrinks its own footprint along with them, so "fewer
   * things packed tighter" could measure as denser than "everything shown,
   * slightly looser." On the real `mobileLandscape` and `broadcastLowerThird`
   * surfaces this let vertical-stack win while silently dropping price (and
   * the logo) — a real, user-reported "where did price go" bug — even though
   * grid/horizontal-split could have shown all 5 elements. The `coverage`
   * factor added to `computeCompositionCohesion` closes that loophole; this
   * is the regression guard proving every real sample surface now shows the
   * full ad.
   */
  it("REGRESSION GUARD: every element stays visible on every one of the 5 real sample surfaces — a strategy may never win by silently dropping content to look 'tighter'", () => {
    for (const surfaceKey of [
      "mobilePortrait",
      "mobileLandscape",
      "broadcastLowerThird",
      "retailKiosk",
      "printQRPanel",
    ] as const) {
      const s = surfaceProfiles[surfaceKey];
      const { layout } = resolveLayout(graph, resolveContext(s), s);
      const visibleCount = layout.elements.filter((e) => e.visible).length;
      expect(visibleCount, `${surfaceKey}: only ${visibleCount}/5 elements visible`).toBe(5);
    }
  });
});
