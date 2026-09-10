/**
 * Context Engine.
 *
 * Collapses a rich {@link SurfaceProfile} into a small, normalized {@link Context}
 * of qualitative flags. Later phases bias layout decisions off this object
 * instead of re-deriving the same classifications everywhere. Pure and
 * deterministic — every threshold is a named constant below.
 */

import type { SurfaceProfile } from "./surfaces";

export interface Context {
  /** Shape bucket derived from width / height. */
  aspectRatioClass: "tall" | "wide" | "square";
  /** True when the viewer can touch the surface (touch-only or touch input). */
  isTouchInteractive: boolean;
  /** True when the surface is viewed from across a room rather than in hand. */
  isFarViewing: boolean;
  /** How long a viewer is expected to engage. */
  attentionBudget: "short" | "medium" | "long";
  /** Audio output available and appropriate. */
  hasAudio: boolean;
  /** Animation/motion available and appropriate. */
  allowsMotion: boolean;
}

// ---- Thresholds (all inclusive at the stated bound) --------------------------

/** width/height at or below this is "tall" (portrait-ish). */
const ASPECT_TALL_MAX_RATIO = 0.8;
/** width/height at or above this is "wide" (landscape-ish). Between the two: "square". */
const ASPECT_WIDE_MIN_RATIO = 1.25;

/** A numeric viewingDistance (cm) at or above this counts as far viewing. */
const FAR_VIEWING_MIN_CM = 100;

/** attentionWindow (s) at or below this is a "short" budget. */
const ATTENTION_SHORT_MAX_S = 3;
/** attentionWindow (s) at or above this is a "long" budget. Between: "medium". */
const ATTENTION_LONG_MIN_S = 15;
/** Used when the surface declares no attentionWindow. */
const ATTENTION_DEFAULT: Context["attentionBudget"] = "medium";

function classifyAspectRatio(
  width: number,
  height: number,
): Context["aspectRatioClass"] {
  const ratio = width / height;
  if (ratio <= ASPECT_TALL_MAX_RATIO) return "tall";
  if (ratio >= ASPECT_WIDE_MIN_RATIO) return "wide";
  return "square";
}

function classifyFarViewing(surface: SurfaceProfile): boolean {
  const distance = surface.viewingDistance;
  if (distance === undefined) return false;
  if (typeof distance === "number") return distance >= FAR_VIEWING_MIN_CM;
  return distance === "far";
}

function classifyAttentionBudget(
  surface: SurfaceProfile,
): Context["attentionBudget"] {
  const window = surface.attentionWindow;
  if (window === undefined) return ATTENTION_DEFAULT;
  if (window <= ATTENTION_SHORT_MAX_S) return "short";
  if (window >= ATTENTION_LONG_MIN_S) return "long";
  return "medium";
}

export function resolveContext(surface: SurfaceProfile): Context {
  return {
    aspectRatioClass: classifyAspectRatio(surface.width, surface.height),
    // Either an explicit touch-only surface or one whose primary input is touch.
    isTouchInteractive:
      surface.touchOnly === true || surface.interaction === "touch",
    isFarViewing: classifyFarViewing(surface),
    attentionBudget: classifyAttentionBudget(surface),
    // Both default to false: never assume audio/motion are usable unless the
    // surface explicitly says so.
    hasAudio: surface.audio === true,
    allowsMotion: surface.motion === true,
  };
}
