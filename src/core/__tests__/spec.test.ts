import { describe, it, expect } from "vitest";
import {
  defineAd,
  AdSpecValidationError,
  type AdConfig,
} from "../spec";

function validConfig(): AdConfig {
  return {
    id: "test-ad",
    name: "Test Ad",
    elements: [
      { id: "headline", type: "text", role: "primary", priority: 1 },
      { id: "cta", type: "button", role: "action", priority: 2 },
      { id: "logo", type: "image", role: "branding", priority: 3 },
    ],
  };
}

describe("defineAd", () => {
  it("returns a correctly-typed AdSpec for a fully valid config", () => {
    const ad = defineAd(validConfig());

    expect(ad.id).toBe("test-ad");
    expect(ad.name).toBe("Test Ad");
    expect(ad.elements).toHaveLength(3);
    expect(ad.elements.map((e) => e.role)).toEqual([
      "primary",
      "action",
      "branding",
    ]);
    // Returned elements are copies, not the caller's objects.
    const config = validConfig();
    const built = defineAd(config);
    expect(built.elements[0]).not.toBe(config.elements[0]);
  });

  it("throws naming the duplicate id", () => {
    const config = validConfig();
    config.elements.push({
      id: "headline",
      type: "text",
      role: "secondary",
      priority: 4,
    });

    expect(() => defineAd(config)).toThrow(AdSpecValidationError);
    expect(() => defineAd(config)).toThrow(/duplicate element id "headline"/);
  });

  it("throws with a clear message for a non-positive priority", () => {
    const config = validConfig();
    config.elements[1] = {
      id: "cta",
      type: "button",
      role: "action",
      priority: 0,
    };

    expect(() => defineAd(config)).toThrow(AdSpecValidationError);
    expect(() => defineAd(config)).toThrow(
      /element "cta": invalid priority 0\. Priority must be a positive number/,
    );
  });

  it("throws with a clear message for a NaN priority — not the misleading 'null' JSON.stringify(NaN) produces", () => {
    const config = validConfig();
    // Simulate a JS caller passing a bad value past the type system.
    (config.elements[2] as { priority: unknown }).priority = Number.NaN;

    expect(() => defineAd(config)).toThrow(
      /element "logo": invalid priority NaN\. Priority must be a positive number/,
    );
  });

  it("throws naming the element with an invalid role (JS caller)", () => {
    const config = validConfig();
    (config.elements[0] as { role: unknown }).role = "primry";

    expect(() => defineAd(config)).toThrow(
      /element "headline": invalid role "primry"\. Valid roles: primary, hero, action, branding, secondary/,
    );
  });

  it("throws when there are no elements", () => {
    expect(() => defineAd({ id: "empty", elements: [] })).toThrow(
      /must contain at least one element/,
    );
  });
});
