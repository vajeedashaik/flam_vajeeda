import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineSurface } from "../surfaces";
import { mobilePortrait, productAd, surfaceProfiles } from "../sample-data";
import { buildGraph } from "../graph";
import { resolveContext } from "../context";
import { resolveLayout, type ResolvedElement, type ResolvedLayout } from "../resolver";

/** Axis-aligned bounding-box overlap (touching edges do NOT count). */
function boxesOverlap(a: ResolvedElement, b: ResolvedElement): boolean {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}

function visibleElements(layout: ResolvedLayout): ResolvedElement[] {
  return layout.elements.filter((element) => element.visible);
}

function assertNoOverlaps(layout: ResolvedLayout): void {
  const visible = visibleElements(layout);
  for (let i = 0; i < visible.length; i++) {
    for (let j = i + 1; j < visible.length; j++) {
      const a = visible[i]!;
      const b = visible[j]!;
      expect(
        boxesOverlap(a, b),
        `${a.id} overlaps ${b.id}: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`,
      ).toBe(false);
    }
  }
}

const graph = buildGraph(productAd);

describe("resolveLayout — mobilePortrait, sample spec", () => {
  const context = resolveContext(mobilePortrait);
  const { layout, trace } = resolveLayout(graph, context, mobilePortrait);

  it("produces zero overlapping visible elements (Phase 2 invariant)", () => {
    expect(visibleElements(layout).length).toBeGreaterThan(1);
    assertNoOverlaps(layout);
  });

  it("keeps every visible element inside the surface safeArea", () => {
    const safe = mobilePortrait.safeArea!;
    const minX = safe.left;
    const minY = safe.top;
    const maxX = mobilePortrait.width - safe.right;
    const maxY = mobilePortrait.height - safe.bottom;

    for (const element of visibleElements(layout)) {
      expect(element.x).toBeGreaterThanOrEqual(minX);
      expect(element.y).toBeGreaterThanOrEqual(minY);
      expect(element.x + element.width).toBeLessThanOrEqual(maxX);
      expect(element.y + element.height).toBeLessThanOrEqual(maxY);
    }
  });

  it("degrades priority-monotonically: nothing visible while a higher-priority element is dropped", () => {
    const priorityById = new Map(graph.nodes.map((n) => [n.id, n.priority]));
    const droppedPriorities = layout.elements
      .filter((e) => !e.visible)
      .map((e) => priorityById.get(e.id)!);
    const minDropped =
      droppedPriorities.length > 0 ? Math.min(...droppedPriorities) : Number.POSITIVE_INFINITY;

    for (const e of visibleElements(layout)) {
      expect(priorityById.get(e.id)!).toBeLessThan(minDropped);
    }
  });

  it("attaches a DecisionTrace with a score per candidate and a real winner", () => {
    expect(trace.candidateScores.length).toBeGreaterThanOrEqual(3);
    expect(trace.candidateScores.map((c) => c.strategy)).toContain(trace.winningStrategy);
    expect(trace.winningRationale).toContain(trace.winningStrategy);

    for (const cs of trace.candidateScores) {
      expect(cs.score.overall).toBeGreaterThanOrEqual(0);
      expect(cs.score.overall).toBeLessThanOrEqual(100);
    }

    const maxOverall = Math.max(...trace.candidateScores.map((c) => c.score.overall));
    const winnerOverall = trace.candidateScores.find(
      (c) => c.strategy === trace.winningStrategy,
    )!.score.overall;
    expect(winnerOverall).toBe(maxOverall);
  });
});

describe("resolveLayout — the SAME code path across all five sample surfaces", () => {
  const keys = [
    "mobilePortrait",
    "mobileLandscape",
    "broadcastLowerThird",
    "retailKiosk",
    "printQRPanel",
  ] as const;

  for (const key of keys) {
    const surface = surfaceProfiles[key];
    const { layout } = resolveLayout(graph, resolveContext(surface), surface);

    it(`${key}: zero overlaps and zero out-of-bounds elements`, () => {
      expect(visibleElements(layout).length).toBeGreaterThan(0);
      assertNoOverlaps(layout);
      for (const e of visibleElements(layout)) {
        expect(e.x).toBeGreaterThanOrEqual(-0.5);
        expect(e.y).toBeGreaterThanOrEqual(-0.5);
        expect(e.x + e.width).toBeLessThanOrEqual(surface.width + 0.5);
        expect(e.y + e.height).toBeLessThanOrEqual(surface.height + 0.5);
      }
    });
  }
});

/**
 * §7.8 — direct follow-up feedback reversed §7.7's priority order: "the
 * product image is our highlight... it should be visible in most cases even
 * if others have to be dropped." product-image is now `visibility: "always"`
 * (priority 3, right after headline/cta) and price/logo are the two
 * `"degradable"`/`"decorative-only"` elements allowed to give way under real
 * space pressure. This surface (70×70) is small enough to force BOTH price
 * and logo to drop while headline, cta, AND the product photo all still
 * survive (at emergency-fit's floor) — the clearest demonstration that the
 * highlight is protected even when other content isn't.
 */
describe("resolveLayout — the product photo survives even when price and logo don't (70×70)", () => {
  const tiny = defineSurface({
    ...surfaceProfiles.retailKiosk,
    id: "retailKioskShrunk",
    name: "kiosk shrunk 70x70",
    width: 70,
    height: 70,
    safeArea: { top: 0, right: 0, bottom: 0, left: 0 },
  });
  const { layout, trace } = resolveLayout(graph, resolveContext(tiny), tiny);

  it("drops price and logo — the two degradable elements — instead of the product photo", () => {
    for (const id of ["price", "logo"]) {
      const e = layout.elements.find((el) => el.id === id);
      expect(e?.visible, `${id} should be dropped`).toBe(false);
    }
  });

  it("keeps headline, cta, AND product-image (the highlight) all visible", () => {
    for (const id of ["headline", "cta", "product-image"]) {
      const e = layout.elements.find((el) => el.id === id);
      expect(e?.visible, `${id} should stay visible`).toBe(true);
      expect(e!.width).toBeGreaterThan(0);
      expect(e!.height).toBeGreaterThan(0);
    }
  });

  it("records the drops in the trace's perElementNotes", () => {
    for (const id of ["price", "logo"]) {
      expect(
        trace.perElementNotes.some((n) => n.toLowerCase().includes(id)),
        `expected a note mentioning ${id}`,
      ).toBe(true);
    }
  });

  it("still produces zero overlaps / out-of-bounds among whatever stays visible", () => {
    assertNoOverlaps(layout);
    for (const e of visibleElements(layout)) {
      expect(e.x).toBeGreaterThanOrEqual(-0.5);
      expect(e.y).toBeGreaterThanOrEqual(-0.5);
      expect(e.x + e.width).toBeLessThanOrEqual(tiny.width + 0.5);
      expect(e.y + e.height).toBeLessThanOrEqual(tiny.height + 0.5);
    }
  });
});

/**
 * §7.3 — proves the pipeline fails GRACEFULLY (never crashes, never produces
 * an invalid layout) on a surface that is mathematically impossible to
 * satisfy, closing the one gap flagged against sibling implementations of
 * this brief.
 *
 * Constructed inline (not added to sample-data.ts, which is reserved for
 * realistic profiles): a valid `SurfaceProfile` shape — it passes
 * `defineSurface()`'s Phase 1 validation cleanly — that is simply too small
 * to lay out at all.
 *
 * The phase brief's own illustrative example (a touch surface with
 * `minTapTarget` larger than the whole surface) does NOT, on inspection,
 * actually make a surface unplaceable in this engine: a clickable element's
 * declared `minSize` (not the touch-inflated `preferred`) is what
 * `placeElementsInOrder` checks before dropping it, and `minTapTarget`
 * non-compliance is only ever a `constraintViolations` / `tapTargetCompliance`
 * SCORE penalty (see scoring.ts), never a placement blocker — so a
 * `minTapTarget` alone, however large, cannot by itself force a hard-fail.
 * This surface therefore combines that illustrative constraint with the one
 * that actually IS a hard geometric blocker: both dimensions (10×8) are
 * smaller than even `emergency-fit`'s last-resort floor
 * (`EMERGENCY_MIN_SIZE = 24×16` in candidates.ts) — so not even the
 * always-visible headline can be placed at its most relaxed possible size, by
 * ANY of the five strategies, and the pipeline must fall through to a
 * universal hard-fail rather than silently shipping something invalid.
 */
describe("resolveLayout — a mathematically unsatisfiable surface (§7.3)", () => {
  const impossible = defineSurface({
    id: "impossible-10x8",
    name: "unsatisfiable — smaller than even the emergency-fit floor",
    width: 10,
    height: 8,
    touchOnly: true,
    minTapTarget: 120, // larger than the entire surface, per the phase brief's own example
  });

  it("is a valid SurfaceProfile — Phase 1 validation accepts it (it is merely impossible to lay out, not malformed)", () => {
    expect(impossible.width).toBe(10);
    expect(impossible.height).toBe(8);
    expect(impossible.minTapTarget).toBe(120);
  });

  it("does not throw or crash when run through the full pipeline", () => {
    expect(() => {
      const context = resolveContext(impossible);
      resolveLayout(graph, context, impossible);
    }).not.toThrow();
  });

  it("every candidate hard-fails to overall 0, and the returned layout has zero visible elements — never an overlapping/out-of-bounds one", () => {
    const context = resolveContext(impossible);
    const { layout, trace } = resolveLayout(graph, context, impossible);

    expect(trace.candidateScores.every((c) => c.score.overall === 0)).toBe(true);
    expect(layout.elements.every((e) => !e.visible)).toBe(true);

    // Belt-and-braces: even though nothing is visible here, whatever the
    // pipeline DID return must still respect both hard invariants — this
    // assertion would catch a regression on a less-extreme "impossible"
    // surface where a strategy manages to keep something (incorrectly) visible.
    assertNoOverlaps(layout);
    for (const e of visibleElements(layout)) {
      expect(e.x).toBeGreaterThanOrEqual(-0.5);
      expect(e.y).toBeGreaterThanOrEqual(-0.5);
      expect(e.x + e.width).toBeLessThanOrEqual(impossible.width + 0.5);
      expect(e.y + e.height).toBeLessThanOrEqual(impossible.height + 0.5);
    }
  });
});

describe("resolver / candidates / scoring are surface-agnostic (source-level check)", () => {
  const SAMPLE_SURFACE_IDS =
    /mobilePortrait|mobileLandscape|broadcastLowerThird|retailKiosk|printQRPanel/;

  for (const file of ["../candidates.ts", "../scoring.ts", "../resolver.ts"]) {
    it(`${file} contains no hard-coded sample surface id`, () => {
      const src = readFileSync(
        fileURLToPath(new URL(file, import.meta.url)),
        "utf8",
      );
      expect(SAMPLE_SURFACE_IDS.test(src)).toBe(false);
    });
  }
});
