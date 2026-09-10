import { describe, it, expect } from "vitest";
import {
  mobilePortrait,
  broadcastLowerThird,
  retailKiosk,
} from "../sample-data";
import { resolveContext, type Context } from "../context";

describe("resolveContext", () => {
  it("classifies mobilePortrait (390x844, near, touch, 3s, no audio)", () => {
    const expected: Context = {
      aspectRatioClass: "tall",
      isTouchInteractive: true,
      isFarViewing: false,
      attentionBudget: "short",
      hasAudio: false,
      allowsMotion: true,
    };
    expect(resolveContext(mobilePortrait)).toEqual(expected);
  });

  it("classifies broadcastLowerThird (1920x320, far, no touch, 6s, audio)", () => {
    const expected: Context = {
      aspectRatioClass: "wide",
      isTouchInteractive: false,
      isFarViewing: true,
      attentionBudget: "medium",
      hasAudio: true,
      allowsMotion: true,
    };
    expect(resolveContext(broadcastLowerThird)).toEqual(expected);
  });

  it("classifies retailKiosk (1080x1920, 80cm, touch, 25s, no audio)", () => {
    const expected: Context = {
      aspectRatioClass: "tall",
      isTouchInteractive: true,
      // 80cm is below the 100cm far-viewing threshold.
      isFarViewing: false,
      attentionBudget: "long",
      hasAudio: false,
      allowsMotion: true,
    };
    expect(resolveContext(retailKiosk)).toEqual(expected);
  });
});
