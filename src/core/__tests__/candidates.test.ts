import { describe, it, expect } from "vitest";
import { generateCandidates, type Candidate, type CandidateStrategy } from "../candidates";
import { buildGraph } from "../graph";
import { resolveContext, type Context } from "../context";
import { defineSurface, type SurfaceProfile } from "../surfaces";
import { productAd, surfaceProfiles } from "../sample-data";
import { measureTextWidth } from "../text-measure";

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
    return measureTextWidth(spec.text!, spec.fontSize!);
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
  // surface — touch-scale (1.15x) and vertical-stack's width-growth cap
  // (1.4x) on a ~120-138px natural CTA top out well under 200, and headline's
  // own declared preferredSize.height is 96 — so 300 can only be reached by
  // this fix actually targeting minTapTarget, never by coincidence.
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
    expect(ctaWithout.width).toBeLessThan(200);
  });
});
