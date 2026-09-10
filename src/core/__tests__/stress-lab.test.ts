import { describe, it, expect } from "vitest";
import { productAd } from "../sample-data";
import { defineSurface } from "../surfaces";
import {
  DEGRADED_SCORE_THRESHOLD,
  generateRandomSurfaces,
  runStressTest,
  seededRng,
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
