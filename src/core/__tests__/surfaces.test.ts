import { describe, it, expect } from "vitest";
import {
  defineSurface,
  SurfaceValidationError,
  type SurfaceConfig,
} from "../surfaces";

function validConfig(): SurfaceConfig {
  return {
    id: "testSurface",
    name: "Test Surface",
    width: 800,
    height: 600,
    safeArea: { top: 10, right: 10, bottom: 10, left: 10 },
    minTapTarget: 44,
    minTextSize: 14,
    touchOnly: true,
    viewingDistance: "near",
    interaction: "touch",
    attentionWindow: 5,
    motion: true,
    audio: false,
  };
}

describe("defineSurface", () => {
  it("returns a correctly-typed SurfaceProfile for a valid config", () => {
    const surface = defineSurface(validConfig());

    expect(surface.id).toBe("testSurface");
    expect(surface.width).toBe(800);
    expect(surface.height).toBe(600);
    expect(surface.touchOnly).toBe(true);
    expect(surface.minTapTarget).toBe(44);
    expect(surface.viewingDistance).toBe("near");
  });

  it("accepts a numeric viewingDistance in cm", () => {
    const surface = defineSurface({ ...validConfig(), viewingDistance: 80 });
    expect(surface.viewingDistance).toBe(80);
  });

  it("throws naming the surface when touchOnly is true with no minTapTarget", () => {
    const config = validConfig();
    delete config.minTapTarget;

    expect(() => defineSurface(config)).toThrow(SurfaceValidationError);
    expect(() => defineSurface(config)).toThrow(
      /Surface "testSurface" is touchOnly but defines no minTapTarget/,
    );
  });

  it("throws for a negative width", () => {
    expect(() => defineSurface({ ...validConfig(), width: -10 })).toThrow(
      /Surface "testSurface": invalid width -10\. Width must be a positive number/,
    );
  });

  it("throws for a negative height", () => {
    expect(() => defineSurface({ ...validConfig(), height: -1 })).toThrow(
      /Surface "testSurface": invalid height -1\. Height must be a positive number/,
    );
  });

  it("throws for a zero width", () => {
    expect(() => defineSurface({ ...validConfig(), width: 0 })).toThrow(
      /invalid width 0/,
    );
  });

  it("throws for a negative safeArea inset", () => {
    const config = validConfig();
    config.safeArea = { top: -5, right: 0, bottom: 0, left: 0 };
    expect(() => defineSurface(config)).toThrow(/invalid safeArea\.top -5/);
  });

  it("throws for a non-positive numeric viewingDistance", () => {
    expect(() =>
      defineSurface({ ...validConfig(), viewingDistance: 0 }),
    ).toThrow(/invalid viewingDistance 0/);
  });
});
