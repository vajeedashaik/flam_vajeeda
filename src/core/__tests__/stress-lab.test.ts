import { describe, it, expect } from "vitest";
import { productAd } from "../sample-data";
import { defineSurface, type SurfaceProfile } from "../surfaces";
import {
  categorizeStressDetail,
  DEGRADED_SCORE_THRESHOLD,
  generateRandomSurfaces,
  runStressTest,
  seededRng,
  summarizeProblems,
  type StressDetail,
} from "../stress-lab";

describe("generateRandomSurfaces", () => {
  it("produces exactly `count` surfaces", () => {
    expect(generateRandomSurfaces(50, seededRng(1)).length).toBe(50);
  });

  it("every generated surface survives defineSurface() validation without throwing", () => {
    const surfaces = generateRandomSurfaces(50, seededRng(42));
    for (const s of surfaces) {
      // Re-run the Phase 1 factory on the generated config: must not throw.
      expect(() =>
        defineSurface({
          id: s.id,
          ...(s.name === undefined ? {} : { name: s.name }),
          width: s.width,
          height: s.height,
          ...(s.minTapTarget === undefined
            ? {}
            : { minTapTarget: s.minTapTarget }),
          ...(s.touchOnly === undefined ? {} : { touchOnly: s.touchOnly }),
          ...(s.viewingDistance === undefined
            ? {}
            : { viewingDistance: s.viewingDistance }),
          ...(s.attentionWindow === undefined
            ? {}
            : { attentionWindow: s.attentionWindow }),
        }),
      ).not.toThrow();
    }
  });

  it("touch-only generated surfaces always carry a minTapTarget", () => {
    for (const s of generateRandomSurfaces(100, seededRng(7))) {
      if (s.touchOnly === true) {
        expect(typeof s.minTapTarget).toBe("number");
        expect(s.minTapTarget!).toBeGreaterThan(0);
      }
    }
  });

  it("spans a wide dimension range including extremes", () => {
    const surfaces = generateRandomSurfaces(200, seededRng(99));
    const widths = surfaces.map((s) => s.width);
    const heights = surfaces.map((s) => s.height);
    expect(Math.min(...widths)).toBeLessThanOrEqual(320);
    expect(Math.max(...widths)).toBeGreaterThanOrEqual(2000);
    expect(Math.min(...heights)).toBeLessThanOrEqual(200);
  });
});

describe("runStressTest — 200 generated surfaces", () => {
  const result = runStressTest(productAd, generateRandomSurfaces(200, seededRng(2026)));

  it("tests all 200 and the tiers sum to the total", () => {
    expect(result.total).toBe(200);
    expect(result.passed + result.degraded + result.failed).toBe(200);
  });

  it("produces ZERO 'failed' entries — Phase 3's hard-invariant claim, proven at scale", () => {
    const failures = result.details.filter((d) => d.outcome === "failed");
    // If this ever trips: STOP. Do not loosen the assertion — a real overlap or
    // out-of-bounds element escaped the scoring hard-fail and must be fixed.
    expect(
      failures,
      `expected 0 failed, got ${failures.length}: ` +
        failures.map((f) => `${f.surface.id} (${f.reason})`).join("; "),
    ).toEqual([]);
  });

  it("classifies degraded strictly below the threshold and passed strictly at/above it", () => {
    for (const d of result.details) {
      if (d.outcome === "passed") {
        expect(d.overallScore).toBeGreaterThanOrEqual(DEGRADED_SCORE_THRESHOLD);
      }
      if (d.outcome === "degraded") {
        expect(d.overallScore).toBeLessThan(DEGRADED_SCORE_THRESHOLD);
      }
    }
  });

  it("is deterministic for a fixed seed", () => {
    const again = runStressTest(
      productAd,
      generateRandomSurfaces(200, seededRng(2026)),
    );
    expect({
      total: again.total,
      passed: again.passed,
      degraded: again.degraded,
      failed: again.failed,
    }).toEqual({
      total: result.total,
      passed: result.passed,
      degraded: result.degraded,
      failed: result.failed,
    });
  });
});

describe("categorizeStressDetail / summarizeProblems — root-cause analysis of degraded entries", () => {
  const surface: SurfaceProfile = defineSurface({ id: "cat-test", width: 100, height: 100 });

  function detail(partial: Partial<StressDetail>): StressDetail {
    return {
      surface,
      outcome: "degraded",
      overallScore: 0,
      visibleCount: 0,
      elementCount: 5,
      ...partial,
    };
  }

  it("a passed entry categorizes as null (excluded from the conclusion)", () => {
    expect(categorizeStressDetail(detail({ outcome: "passed", overallScore: 90, visibleCount: 5 }))).toBeNull();
  });

  it("a failed (hard-invariant-broken) entry categorizes as invariant-violation regardless of score", () => {
    expect(categorizeStressDetail(detail({ outcome: "failed", overallScore: 80, visibleCount: 5 }))).toBe(
      "invariant-violation",
    );
  });

  it("zero visible elements categorizes as nothing-fits, even if score were somehow non-zero", () => {
    expect(categorizeStressDetail(detail({ visibleCount: 0, overallScore: 0 }))).toBe("nothing-fits");
  });

  it("some elements visible but overall score 0 categorizes as always-element-dropped", () => {
    expect(categorizeStressDetail(detail({ visibleCount: 2, overallScore: 0 }))).toBe(
      "always-element-dropped",
    );
  });

  it("a valid layout below the degraded threshold categorizes as quality-floor", () => {
    expect(categorizeStressDetail(detail({ visibleCount: 3, overallScore: 62 }))).toBe("quality-floor");
  });

  it("summarizeProblems buckets and counts correctly, most-common first, skipping passed entries", () => {
    const details: StressDetail[] = [
      detail({ visibleCount: 0, overallScore: 0 }), // nothing-fits
      detail({ visibleCount: 0, overallScore: 0 }), // nothing-fits
      detail({ visibleCount: 2, overallScore: 0 }), // always-element-dropped
      detail({ visibleCount: 3, overallScore: 65 }), // quality-floor
      detail({ outcome: "passed", overallScore: 95, visibleCount: 5 }), // excluded
    ];

    const summary = summarizeProblems(details);

    expect(summary.map((s) => s.category)).toEqual([
      "nothing-fits",
      "always-element-dropped",
      "quality-floor",
    ]);
    expect(summary[0]!.count).toBe(2);
    expect(summary[1]!.count).toBe(1);
    expect(summary[2]!.count).toBe(1);
    // Every summary row carries a real, non-empty explanation, not a placeholder.
    for (const s of summary) {
      expect(s.label.length).toBeGreaterThan(0);
      expect(s.explanation.length).toBeGreaterThan(20);
    }
  });

  it("real 200-surface run: every degraded entry falls into nothing-fits, always-element-dropped, or quality-floor — never invariant-violation", () => {
    const result = runStressTest(productAd, generateRandomSurfaces(200, seededRng(2026)));
    const summary = summarizeProblems(result.details);

    expect(summary.some((s) => s.category === "invariant-violation")).toBe(false);
    const totalCategorized = summary.reduce((sum, s) => sum + s.count, 0);
    expect(totalCategorized).toBe(result.degraded + result.failed);
  });
});
