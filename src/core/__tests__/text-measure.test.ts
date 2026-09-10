import { describe, it, expect } from "vitest";
import { measureTextBlock, measureTextWidth } from "../text-measure";

describe("measureTextWidth", () => {
  it("returns a larger width for a longer string at the same font size", () => {
    const short = measureTextWidth("Buy now", 24);
    const long = measureTextWidth(
      "Jetzt kaufen und im Sommerschlussverkauf richtig sparen",
      24,
    );
    expect(long).toBeGreaterThan(short);
  });

  it("scales up with font size for the same string", () => {
    expect(measureTextWidth("Summer Sale", 32)).toBeGreaterThan(
      measureTextWidth("Summer Sale", 12),
    );
  });

  it("is non-negative and finite", () => {
    const w = measureTextWidth("anything", 16);
    expect(Number.isFinite(w)).toBe(true);
    expect(w).toBeGreaterThan(0);
  });
});

describe("measureTextBlock", () => {
  it("stays one line when the text fits the max width", () => {
    const block = measureTextBlock("Hi", 16, 1000);
    expect(block.lines).toBe(1);
    expect(block.width).toBeLessThanOrEqual(1000);
  });

  it("wraps to multiple lines and never exceeds max width when the text is long", () => {
    const block = measureTextBlock(
      "This is a deliberately long headline that cannot possibly fit on one line",
      16,
      80,
    );
    expect(block.lines).toBeGreaterThan(1);
    expect(block.width).toBeLessThanOrEqual(80);
    expect(block.height).toBeGreaterThan(16);
  });
});
