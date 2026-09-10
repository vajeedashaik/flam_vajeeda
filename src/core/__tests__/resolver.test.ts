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

describe("resolveLayout — priority-based degradation on a shrunk retail kiosk (200×200)", () => {
  const tiny = defineSurface({
    ...surfaceProfiles.retailKiosk,
    id: "retailKioskShrunk",
    name: "kiosk shrunk 200x200",
    width: 200,
    height: 200,
    safeArea: { top: 0, right: 0, bottom: 0, left: 0 },
  });
  const { layout, trace } = resolveLayout(graph, resolveContext(tiny), tiny);

  it("drops the lowest-priority branding element (logo, priority 5)", () => {
    const logo = layout.elements.find((e) => e.id === "logo");
    expect(logo?.visible).toBe(false);
  });

  it("keeps the action element (cta) visible and intact", () => {
    const cta = layout.elements.find((e) => e.id === "cta");
    expect(cta?.visible).toBe(true);
    expect(cta!.width).toBeGreaterThan(0);
    expect(cta!.height).toBeGreaterThan(0);
  });

  it("records the drop in the trace's perElementNotes", () => {
    expect(
      trace.perElementNotes.some((n) => n.toLowerCase().includes("logo")),
    ).toBe(true);
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
