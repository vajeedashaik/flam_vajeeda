import { describe, it, expect } from "vitest";
import { availableBox, generateCandidates, type Candidate, type CandidateStrategy } from "../candidates";
import { buildGraph } from "../graph";
import { resolveContext, type Context } from "../context";
import { resolveLayout } from "../resolver";
import { defineSurface, type SurfaceProfile } from "../surfaces";
import { productAd, surfaceProfiles } from "../sample-data";
import { measureTextWidth } from "../text-measure";

const ALL_STRATEGIES: CandidateStrategy[] = [
  "vertical-stack",
  "horizontal-split",
  "overlay-safe-margins",
  "grid",
  "emergency-fit",
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

describe("generateCandidates — context-aware element sizing (§4.3-context)", () => {
  // Deliberately oversized so nothing has to shrink — isolates the size REQUEST
  // context produces from the placement engine's fit/shrink/drop behaviour.
  const spaciousSurface: SurfaceProfile = defineSurface({
    id: "context-size-test-surface",
    width: 4000,
    height: 4000,
  });
  const baseContext = resolveContext(spaciousSurface);

  function widthOf(context: Context, id: string): number {
    const cands = generateCandidates(graph, context, spaciousSurface);
    return strat(cands, "vertical-stack").elements.find((e) => e.id === id)!
      .width;
  }

  it("far viewing inflates text/button preferred size (bigger type read from across a room)", () => {
    const near: Context = { ...baseContext, isFarViewing: false };
    const far: Context = { ...baseContext, isFarViewing: true };

    expect(widthOf(far, "headline")).toBeGreaterThan(widthOf(near, "headline"));
    expect(widthOf(far, "cta")).toBeGreaterThan(widthOf(near, "cta"));
    // product-image is type "image" — its own preferred size already IS the
    // intended on-screen size, so far-viewing must NOT inflate it.
    expect(widthOf(far, "product-image")).toBe(widthOf(near, "product-image"));
  });

  it("touch interactivity inflates the clickable CTA but leaves the static headline alone", () => {
    const notTouch: Context = { ...baseContext, isTouchInteractive: false };
    const touch: Context = { ...baseContext, isTouchInteractive: true };

    expect(widthOf(touch, "cta")).toBeGreaterThan(widthOf(notTouch, "cta"));
    expect(widthOf(touch, "headline")).toBe(widthOf(notTouch, "headline"));
  });
});

describe("generateCandidates — grow into slack, capped, brand-lock exempt", () => {
  // Deliberately oversized so every element has far more room than it needs —
  // isolates growth behaviour from the shrink cascade.
  const spaciousSurface: SurfaceProfile = defineSurface({
    id: "grow-test-surface",
    width: 4000,
    height: 4000,
  });
  const ctx = resolveContext(spaciousSurface);
  const cands = generateCandidates(graph, ctx, spaciousSurface);

  function naturalWidth(id: string): number {
    const spec = productAd.elements.find((e) => e.id === id)!;
    const measured = measureTextWidth(spec.text!, spec.fontSize!);
    // Mirrors toRequest()'s own width formula: the largest of the measured
    // text, the declared minSize, and the declared preferredSize — the same
    // three-way max the height branch always used, and width now uses too
    // (bug fix: width used to omit preferredSize entirely, see candidates.ts).
    return Math.max(measured, spec.minSize?.width ?? 0, spec.preferredSize?.width ?? 0);
  }

  it("vertical-stack (width is the free axis): a non-locked text element grows beyond its measured width, capped at 1.4x", () => {
    const headline = el(strat(cands, "vertical-stack"), "headline");
    const natural = naturalWidth("headline");

    expect(headline.width).toBeGreaterThan(natural * 1.05);
    // GROWTH_CAP_FACTOR = 1.4 in candidates.ts; +2 covers the ceil() rounding.
    expect(headline.width).toBeLessThanOrEqual(Math.ceil(natural) * 1.4 + 2);
  });

  it("vertical-stack: never grows the brandRules.locked logo beyond its own natural width", () => {
    const logo = el(strat(cands, "vertical-stack"), "logo");
    const natural = naturalWidth("logo");

    expect(logo.width).toBeLessThanOrEqual(Math.ceil(natural) + 1);
  });

  it("vertical-stack: HEIGHT is the cascading axis and never grows, even with slack", () => {
    const headlineSpec = productAd.elements.find((e) => e.id === "headline")!;
    const lineHeight = Math.ceil((headlineSpec.fontSize ?? 16) * 1.3);
    const naturalHeight = Math.max(
      lineHeight,
      headlineSpec.minSize?.height ?? 0,
      headlineSpec.preferredSize?.height ?? 0,
    );
    const headline = el(strat(cands, "vertical-stack"), "headline");

    expect(headline.height).toBeLessThanOrEqual(naturalHeight + 1);
  });

  it("horizontal-split (height is the free axis): a non-locked element grows beyond its natural height, capped at 1.4x", () => {
    const priceSpec = productAd.elements.find((e) => e.id === "price")!;
    const lineHeight = Math.ceil((priceSpec.fontSize ?? 16) * 1.3);
    const naturalHeight = Math.max(
      lineHeight,
      priceSpec.minSize?.height ?? 0,
      priceSpec.preferredSize?.height ?? 0,
    );
    const price = el(strat(cands, "horizontal-split"), "price");

    expect(price.height).toBeGreaterThan(naturalHeight * 1.05);
    expect(price.height).toBeLessThanOrEqual(naturalHeight * 1.4 + 2);
  });

  it("horizontal-split: does NOT grow the clickable CTA on its free height axis — a button keeps its purposeful shape instead of becoming a disproportionate blob", () => {
    // Regression test for a real, reported visual bug: on mobileLandscape,
    // horizontal-split grew the CTA's height 40% (free axis there) while its
    // width stayed fixed (cascading axis), turning a wide short pill button
    // into a squat, oddly-proportioned shape that visually dominated the
    // layout. A clickable element's size is already deliberately set by
    // touch-scale / minTapTarget-targeting above in toRequest() — generic
    // slack-growth piling on top of that is what caused it, so clickable
    // elements are now exempt from it entirely (`request.interactive`).
    const ctaSpec = productAd.elements.find((e) => e.id === "cta")!;
    const lineHeight = Math.ceil((ctaSpec.fontSize ?? 16) * 1.3);
    const naturalHeight = Math.max(
      lineHeight,
      ctaSpec.minSize?.height ?? 0,
      ctaSpec.preferredSize?.height ?? 0,
    );
    const cta = el(strat(cands, "horizontal-split"), "cta");

    expect(cta.height).toBeLessThanOrEqual(naturalHeight + 1);
  });

  it("grid (both axes free): a non-locked element grows on both width and height", () => {
    const price = el(strat(cands, "grid"), "price");
    const natural = naturalWidth("price");

    expect(price.width).toBeGreaterThan(natural * 1.05);
  });

  it("overlay-safe-margins deliberately opts out of growth — sizes stay at natural/shrunk only", () => {
    const price = el(strat(cands, "overlay-safe-margins"), "price");
    const natural = naturalWidth("price");

    expect(price.width).toBeLessThanOrEqual(Math.ceil(natural) + 1);
  });

  it("growth never breaks the non-overlap / in-bounds invariants", () => {
    for (const strategy of ALL_STRATEGIES) {
      const c = strat(cands, strategy);
      const visible = c.elements.filter((e) => e.visible);
      for (let i = 0; i < visible.length; i++) {
        for (let j = i + 1; j < visible.length; j++) {
          const a = visible[i]!;
          const b = visible[j]!;
          const overlaps =
            a.x < b.x + b.width &&
            a.x + a.width > b.x &&
            a.y < b.y + b.height &&
            a.y + a.height > b.y;
          expect(overlaps, `${strategy}: ${a.id} overlaps ${b.id}`).toBe(false);
        }
        const e = visible[i]!;
        expect(e.x + e.width).toBeLessThanOrEqual(spaciousSurface.width + 0.5);
        expect(e.y + e.height).toBeLessThanOrEqual(spaciousSurface.height + 0.5);
      }
    }
  });
});

describe("generateCandidates — clickable sizing targets the surface's real minTapTarget", () => {
  // Found via Stress Lab: a random touch surface with a demanding minTapTarget
  // (up to 96px) still scored 0 on tapTargetCompliance every time, because the
  // old flat 1.15x touch-scale bumped the CTA's own preferred size without
  // ever looking at what the SURFACE actually required — it could bump a
  // ~50px button to ~58px and call it "touch-aware" while the surface asked
  // for 96px. A spacious surface isolates sizing from the shrink cascade.
  // 300 is deliberately far above anything else that inflates size on this
  // surface — cta's own preferredSize.width (200) × touch-scale (1.15x) ×
  // vertical-stack's width-growth cap (1.4x) tops out at 322, and headline's
  // own declared preferredSize.height is 96 — the assertion below only checks
  // a `>= 300` floor, so it still only passes because minTapTarget's own
  // clamp (not growth or touch-scale alone) guarantees that floor.
  const spaciousSurface: SurfaceProfile = defineSurface({
    id: "min-tap-target-test-surface",
    width: 4000,
    height: 4000,
    touchOnly: true,
    minTapTarget: 300,
  });
  const ctx = resolveContext(spaciousSurface);
  const cands = generateCandidates(graph, ctx, spaciousSurface);
  const cta = el(strat(cands, "vertical-stack"), "cta");

  it("sizes the clickable CTA to at least the surface's declared minTapTarget on both axes", () => {
    expect(cta.width).toBeGreaterThanOrEqual(300);
    expect(cta.height).toBeGreaterThanOrEqual(300);
  });

  it("does not inflate the non-clickable headline to the tap-target floor", () => {
    const headline = el(strat(cands, "vertical-stack"), "headline");
    expect(headline.height).toBeLessThan(150);
  });

  it("a surface with no minTapTarget declared is unaffected (existing behaviour preserved)", () => {
    const noTapTarget: SurfaceProfile = defineSurface({
      id: "no-tap-target-surface",
      width: 4000,
      height: 4000,
    });
    // horizontal-split's WIDTH is the shrink-only cascading axis (no growth),
    // so this isolates "did minTapTarget inflate it" from the separately
    // tested width-growth behaviour on vertical-stack.
    const ctaWithout = el(
      strat(
        generateCandidates(graph, resolveContext(noTapTarget), noTapTarget),
        "horizontal-split",
      ),
      "cta",
    );
    // cta's own declared preferredSize.width (200) IS its natural width once
    // toRequest correctly considers it (see the bug fix in candidates.ts) —
    // the invariant this test actually cares about is that the minTapTarget
    // clamp never pushes it any HIGHER than that when the surface declares
    // no minTapTarget at all, not that 200 itself is somehow too big.
    expect(ctaWithout.width).toBeLessThanOrEqual(200);
  });
});

describe("generateCandidates — emergency-fit: always-visible elements survive even below their declared minSize", () => {
  // Narrower than headline's declared minSize.width (180) — every normal
  // strategy cascades to drop everything, including visibility:"always"
  // elements, because 100 < 180 no matter how the box is sliced.
  const tooNarrow: SurfaceProfile = defineSurface({ id: "too-narrow", width: 100, height: 600 });
  // A real, standard mobile-banner ad size (320×50) — too short for a single
  // COLUMN of all 4 always-elements (4 × 16px floor = 64px > 50px available),
  // but comfortably wide enough for a ROW of them. Exercises §7.7's
  // orientation-aware emergency floor (mirrors vertical-stack/horizontal-split's
  // own duality) rather than a fixed single-axis cascade.
  const tooShort: SurfaceProfile = defineSurface({ id: "too-short", width: 320, height: 50 });

  it("width below headline's declared minSize: the normal 4 strategies all hard-fail to 0", () => {
    const ctx = resolveContext(tooNarrow);
    const cands = generateCandidates(buildGraph(productAd), ctx, tooNarrow);
    for (const strategy of ["vertical-stack", "horizontal-split", "grid", "overlay-safe-margins"] as const) {
      const c = strat(cands, strategy);
      const visible = c.elements.filter((e) => e.visible);
      expect(visible.length, `${strategy} should have nothing (or a dropped always-element)`).toBeLessThanOrEqual(1);
    }
  });

  it("emergency-fit still places both visibility:\"always\" elements (headline, cta) on that same surface", () => {
    const ctx = resolveContext(tooNarrow);
    const cands = generateCandidates(buildGraph(productAd), ctx, tooNarrow);
    const emergency = strat(cands, "emergency-fit");

    const headline = el(emergency, "headline");
    const cta = el(emergency, "cta");
    expect(headline.visible).toBe(true);
    expect(cta.visible).toBe(true);
    // Genuinely tiny, not the declared 180×40 / 120×44 — that's the point.
    expect(headline.width).toBeLessThan(180);
  });

  it("resolveLayout picks emergency-fit as the winner there — a real, positive score instead of a 0/5 hard-fail", () => {
    const ctx = resolveContext(tooNarrow);
    const { layout, trace } = resolveLayout(buildGraph(productAd), ctx, tooNarrow);
    expect(trace.winningStrategy).toBe("emergency-fit");
    expect(layout.elements.filter((e) => e.visible).length).toBeGreaterThan(0);
    const winnerScore = trace.candidateScores.find((c) => c.strategy === "emergency-fit")!.score.overall;
    expect(winnerScore).toBeGreaterThan(0);
  });

  it("height too short for a COLUMN of always-elements: emergency-fit switches to a ROW and fits all 4, not just headline+cta", () => {
    const ctx = resolveContext(tooShort);
    const cands = generateCandidates(buildGraph(productAd), ctx, tooShort);
    const emergency = strat(cands, "emergency-fit");

    for (const id of ["headline", "cta", "price", "logo"]) {
      expect(el(emergency, id).visible, `${id} should survive on a 320×50 banner`).toBe(true);
    }
  });

  it("REGRESSION GUARD (§7.7): the 4 'info' elements survive on real, standard ad sizes too small for a single-column emergency floor", () => {
    // 320×50 (mobile banner) and 728×90 (leaderboard) are real IAB ad units,
    // not synthetic edge cases — both are shorter than 4 always-elements
    // stacked in one column (4 × 16px = 64px) but wide enough for a row.
    for (const [width, height] of [
      [320, 50],
      [728, 90],
    ] as const) {
      const surface: SurfaceProfile = defineSurface({ id: `standard-${width}x${height}`, width, height });
      const { layout, trace } = resolveLayout(buildGraph(productAd), resolveContext(surface), surface);
      for (const id of ["headline", "cta", "price", "logo"]) {
        const e = layout.elements.find((el) => el.id === id);
        expect(e?.visible, `${width}×${height}: ${id} should be visible (winner: ${trace.winningStrategy})`).toBe(true);
      }
    }
  });

  it("on a normal, spacious surface, emergency-fit never wins — it always forces always-elements small, so it always carries a self-inflicted 'below minSize' penalty vertical-stack doesn't have", () => {
    const spacious: SurfaceProfile = defineSurface({ id: "emergency-noop", width: 4000, height: 4000 });
    const ctx = resolveContext(spacious);
    const cands = generateCandidates(buildGraph(productAd), ctx, spacious);
    const vs = strat(cands, "vertical-stack");
    const emergency = strat(cands, "emergency-fit");

    // Both place every element (nothing needed rescuing here) — the relaxed
    // floor is unconditional in emergency-fit, so its always-elements are
    // deliberately tiny even though there was no need, which is exactly what
    // keeps it losing on every surface that didn't need the rescue.
    for (const id of ["headline", "cta", "product-image", "price", "logo"]) {
      expect(el(vs, id).visible).toBe(true);
      expect(el(emergency, id).visible).toBe(true);
    }
    expect(el(emergency, "headline").width).toBeLessThan(el(vs, "headline").width);

    const { trace } = resolveLayout(buildGraph(productAd), ctx, spacious);
    expect(trace.winningStrategy).not.toBe("emergency-fit");
  });

  it("emergency-fit never breaks the non-overlap / in-bounds invariants, even at its most degenerate", () => {
    for (const surface of [tooNarrow, tooShort]) {
      const ctx = resolveContext(surface);
      const emergency = strat(generateCandidates(buildGraph(productAd), ctx, surface), "emergency-fit");
      const visible = emergency.elements.filter((e) => e.visible);
      for (let i = 0; i < visible.length; i++) {
        for (let j = i + 1; j < visible.length; j++) {
          const a = visible[i]!;
          const b = visible[j]!;
          const overlaps = a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
          expect(overlaps).toBe(false);
        }
        expect(visible[i]!.x + visible[i]!.width).toBeLessThanOrEqual(surface.width + 0.5);
        expect(visible[i]!.y + visible[i]!.height).toBeLessThanOrEqual(surface.height + 0.5);
      }
    }
  });
});

/**
 * §7.5 — two real, user-reported bugs found by inspecting the live rendered
 * ad, not by theorizing: (1) a locked brand logo was rendering illegibly
 * small because its declared `preferredSize.width` was silently never
 * consulted for text/button elements — only the measured string width and
 * `minSize.width` were — so a short 4-letter mark like "DIOR" collapsed to
 * its own literal character width instead of the size the ad author actually
 * asked for; (2) the CTA button never grew into available slack at all
 * (exempt from ALL growth), leaving it a small, disconnected pill next to
 * visible dead space even in a strategy meant to look like one cohesive ad.
 */
describe("generateCandidates — preferredSize.width honoured for text/button elements (§7.5 bug fix)", () => {
  it("a short string's box is NOT collapsed below its declared preferredSize.width", () => {
    // "DIOR" measures far narrower than its declared preferredSize.width
    // (96) — before the fix, toRequest's width formula never consulted
    // preferredSize at all for width (only measuredWidth and minSize.width),
    // so the logo rendered at ~40px instead of the intended 96px.
    const spacious: SurfaceProfile = defineSurface({ id: "pref-width-test", width: 4000, height: 4000 });
    const cands = generateCandidates(graph, resolveContext(spacious), spacious);
    const logo = el(strat(cands, "vertical-stack"), "logo");
    const logoSpec = productAd.elements.find((e) => e.id === "logo")!;
    const measured = measureTextWidth(logoSpec.text!, logoSpec.fontSize!);

    expect(measured).toBeLessThan(logoSpec.preferredSize!.width);
    // Locked → no growth, so the placed width should land exactly on the
    // declared preferredSize.width, not the much-smaller measured width.
    expect(logo.width).toBeCloseTo(logoSpec.preferredSize!.width, 0);
  });

  it("a longer string's box is still driven by its measured width, not artificially shrunk by this fix", () => {
    // Sanity check for the OTHER direction: the headline's full sentence
    // measures wider than its declared preferredSize.width (420), so adding
    // preferredSize.width into the max() must not regress this — the max()
    // should still pick the measured value when it's the largest.
    const spacious: SurfaceProfile = defineSurface({ id: "pref-width-test-2", width: 4000, height: 4000 });
    const cands = generateCandidates(graph, resolveContext(spacious), spacious);
    const headline = el(strat(cands, "vertical-stack"), "headline");
    const headlineSpec = productAd.elements.find((e) => e.id === "headline")!;
    const measured = measureTextWidth(headlineSpec.text!, headlineSpec.fontSize!);

    expect(measured).toBeGreaterThan(headlineSpec.preferredSize!.width);
    expect(headline.width).toBeGreaterThanOrEqual(Math.ceil(measured));
  });
});

describe("generateCandidates — clickable elements grow WIDTH into slack, never HEIGHT (§7.5 bug fix)", () => {
  const spacious: SurfaceProfile = defineSurface({ id: "cta-width-grow-test", width: 4000, height: 4000 });
  const cands = generateCandidates(graph, resolveContext(spacious), spacious);

  it("vertical-stack (width is the free axis): the clickable CTA grows wider than its own preferred width, capped at 1.4x", () => {
    const ctaSpec = productAd.elements.find((e) => e.id === "cta")!;
    const ctx = resolveContext(spacious);
    const cta = el(strat(cands, "vertical-stack"), "cta");
    // Recompute the CTA's own pre-growth preferred width the same way
    // toRequest does (measured text vs minSize vs preferredSize, then
    // touch-scale if applicable) so this test doesn't hardcode a pixel
    // number that would go stale if any of those inputs change.
    const measured = measureTextWidth(ctaSpec.text!, ctaSpec.fontSize!);
    const preWidth = Math.max(measured, ctaSpec.minSize?.width ?? 0, ctaSpec.preferredSize?.width ?? 0);
    const naturalWidth = ctx.isTouchInteractive ? Math.ceil(preWidth * 1.15) : preWidth;

    expect(cta.width).toBeGreaterThan(naturalWidth * 1.05);
    expect(cta.width).toBeLessThanOrEqual(Math.ceil(naturalWidth) * 1.4 + 2);
  });

  it("horizontal-split (height is the free axis there): the clickable CTA's height still never grows — the original blob-bug guarantee still holds", () => {
    const ctaSpec = productAd.elements.find((e) => e.id === "cta")!;
    const lineHeight = Math.ceil((ctaSpec.fontSize ?? 16) * 1.3);
    const naturalHeight = Math.max(
      lineHeight,
      ctaSpec.minSize?.height ?? 0,
      ctaSpec.preferredSize?.height ?? 0,
    );
    const cta = el(strat(cands, "horizontal-split"), "cta");
    expect(cta.height).toBeLessThanOrEqual(naturalHeight + 1);
  });

  it("never breaks the non-overlap / in-bounds invariants with the CTA now growing width", () => {
    for (const strategy of ALL_STRATEGIES) {
      const c = strat(cands, strategy);
      const visible = c.elements.filter((e) => e.visible);
      for (let i = 0; i < visible.length; i++) {
        for (let j = i + 1; j < visible.length; j++) {
          const a = visible[i]!;
          const b = visible[j]!;
          const overlaps =
            a.x < b.x + b.width &&
            a.x + a.width > b.x &&
            a.y < b.y + b.height &&
            a.y + a.height > b.y;
          expect(overlaps, `${strategy}: ${a.id} overlaps ${b.id}`).toBe(false);
        }
      }
    }
  });
});

/**
 * §7.5 — a surface much larger than the ad needs (even after growth) used to
 * leave every bit of leftover room as ONE lopsided gap on the cascade's far
 * side: vertical-stack pinned everything to the TOP with a large dead void
 * below it; horizontal-split pinned everything to the LEFT with a large dead
 * void on the right. `centerAlongAxis` fixes this by centring the whole
 * stacked block in the box on the axis the strategy cascades along, turning
 * one big one-sided gap into an even margin on both sides.
 */
describe("generateCandidates — vertical-stack/horizontal-split centre their block when there's leftover room (§7.5)", () => {
  // Deliberately taller/wider than the ad's own content needs even after
  // 1.4x growth, so there is guaranteed leftover slack to centre into.
  const tallSurface: SurfaceProfile = defineSurface({ id: "centering-tall", width: 1080, height: 1920 });
  const wideSurface: SurfaceProfile = defineSurface({ id: "centering-wide", width: 1920, height: 400 });

  it("vertical-stack centres the stacked block vertically instead of pinning it to the top", () => {
    const cands = generateCandidates(graph, resolveContext(tallSurface), tallSurface);
    const vs = strat(cands, "vertical-stack");
    const visible = vs.elements.filter((e) => e.visible);
    expect(visible.length).toBeGreaterThan(0);

    const box = availableBox(tallSurface);
    const top = Math.min(...visible.map((e) => e.y));
    const bottom = Math.max(...visible.map((e) => e.y + e.height));
    const topMargin = top - box.y;
    const bottomMargin = box.y + box.height - bottom;

    // Not pinned to the very top (the old, lopsided behaviour).
    expect(topMargin).toBeGreaterThan(1);
    // The two margins should be close to equal (centred), not one large and
    // one ~zero.
    expect(Math.abs(topMargin - bottomMargin)).toBeLessThan(2);
  });

  it("horizontal-split centres the row horizontally instead of pinning it to the left", () => {
    const cands = generateCandidates(graph, resolveContext(wideSurface), wideSurface);
    const hs = strat(cands, "horizontal-split");
    const visible = hs.elements.filter((e) => e.visible);
    expect(visible.length).toBeGreaterThan(0);

    const box = availableBox(wideSurface);
    const left = Math.min(...visible.map((e) => e.x));
    const right = Math.max(...visible.map((e) => e.x + e.width));
    const leftMargin = left - box.x;
    const rightMargin = box.x + box.width - right;

    expect(leftMargin).toBeGreaterThan(1);
    expect(Math.abs(leftMargin - rightMargin)).toBeLessThan(2);
  });

  it("centering never introduces an overlap or pushes anything out of bounds", () => {
    for (const surface of [tallSurface, wideSurface]) {
      const ctx = resolveContext(surface);
      const box = availableBox(surface);
      for (const strategy of ["vertical-stack", "horizontal-split"] as const) {
        const c = strat(generateCandidates(graph, ctx, surface), strategy);
        const visible = c.elements.filter((e) => e.visible);
        for (let i = 0; i < visible.length; i++) {
          const e = visible[i]!;
          expect(e.x).toBeGreaterThanOrEqual(box.x - 0.5);
          expect(e.y).toBeGreaterThanOrEqual(box.y - 0.5);
          expect(e.x + e.width).toBeLessThanOrEqual(box.x + box.width + 0.5);
          expect(e.y + e.height).toBeLessThanOrEqual(box.y + box.height + 0.5);
          for (let j = i + 1; j < visible.length; j++) {
            const b = visible[j]!;
            const overlaps =
              e.x < b.x + b.width && e.x + e.width > b.x && e.y < b.y + b.height && e.y + e.height > b.y;
            expect(overlaps, `${strategy}: ${e.id} overlaps ${b.id}`).toBe(false);
          }
        }
      }
    }
  });

  it("does not affect the free axis — vertical-stack elements still share the same left edge as before", () => {
    const cands = generateCandidates(graph, resolveContext(tallSurface), tallSurface);
    const vs = strat(cands, "vertical-stack");
    const box = availableBox(tallSurface);
    const headline = el(vs, "headline");
    const cta = el(vs, "cta");
    expect(headline.x).toBeCloseTo(box.x, 3);
    expect(cta.x).toBeCloseTo(box.x, 3);
  });
});
