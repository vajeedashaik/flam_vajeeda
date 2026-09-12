/**
 * Surface profile types + defineSurface() factory.
 *
 * A SurfaceProfile describes the real-world constraints of a target surface:
 * not just pixel dimensions, but tap ergonomics, viewing distance, attention
 * budget, and whether motion/audio are usable. The resolver (later phase) reads
 * these to produce a layout that is actually correct for the surface.
 */

/** Qualitative distance, or an explicit distance in centimetres. */
export type ViewingDistance = "near" | "far" | number;

/** Primary input modality available on the surface. */
export type SurfaceInteractionMode = "none" | "touch" | "remote";

export interface SafeArea {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface SurfaceProfile {
  /** Identifier for the surface profile. */
  id: string;
  name?: string;

  width: number;
  height: number;

  /** Inset (px) that content must stay clear of on each edge. */
  safeArea?: SafeArea;
  /** Minimum interactive target size in px. Required when touchOnly is true. */
  minTapTarget?: number;
  /** Minimum legible text size in px at this surface's viewing distance. */
  minTextSize?: number;
  /** If true, the only way to interact is touch — no pointer, no remote. */
  touchOnly?: boolean;
  viewingDistance?: ViewingDistance;
  interaction?: SurfaceInteractionMode;
  /** Seconds of attention a viewer is expected to give. */
  attentionWindow?: number;
  /** Whether animation/motion is available and appropriate. */
  motion?: boolean;
  /** Whether audio output is available and appropriate. */
  audio?: boolean;
}

/**
 * Input shape for {@link defineSurface}. Identical to {@link SurfaceProfile}
 * today, kept separate so the two can diverge later.
 */
export type SurfaceConfig = SurfaceProfile;

/** Thrown by {@link defineSurface} when a config fails validation. */
export class SurfaceValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SurfaceValidationError";
  }
}

function isPositiveNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function isNonNegativeNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

/**
 * Formats a value for an error message. `JSON.stringify(NaN)` returns the
 * STRING `"null"` (JSON has no NaN) — actively misleading in a validation
 * message when the caller got here via `Number(someBadInput)` (e.g. a live
 * form field left empty or given non-numeric text): "invalid width null"
 * reads as "you gave me literal null", not "that wasn't a number at all".
 */
function describeInvalid(value: unknown): string {
  if (typeof value === "number" && Number.isNaN(value)) return "NaN";
  return JSON.stringify(value);
}

/**
 * Construct a validated {@link SurfaceProfile}.
 *
 * Validates at construction time:
 *  - width and height are positive numbers
 *  - optional numeric fields (minTapTarget, minTextSize, attentionWindow,
 *    numeric viewingDistance) are positive when present
 *  - safeArea insets are non-negative when present
 *  - cross-field: touchOnly === true requires a positive minTapTarget
 *
 * Throws {@link SurfaceValidationError} naming the surface and the field.
 */
export function defineSurface(config: SurfaceConfig): SurfaceProfile {
  const surfaceId = config.id;

  if (typeof surfaceId !== "string" || surfaceId.trim() === "") {
    throw new SurfaceValidationError(
      `Surface profile is missing a valid "id" (got ${JSON.stringify(surfaceId)}).`,
    );
  }

  if (!isPositiveNumber(config.width)) {
    throw new SurfaceValidationError(
      `Surface "${surfaceId}": invalid width ${describeInvalid(
        config.width,
      )}. Width must be a positive number.`,
    );
  }

  if (!isPositiveNumber(config.height)) {
    throw new SurfaceValidationError(
      `Surface "${surfaceId}": invalid height ${describeInvalid(
        config.height,
      )}. Height must be a positive number.`,
    );
  }

  if (config.minTapTarget !== undefined && !isPositiveNumber(config.minTapTarget)) {
    throw new SurfaceValidationError(
      `Surface "${surfaceId}": invalid minTapTarget ${describeInvalid(
        config.minTapTarget,
      )}. minTapTarget must be a positive number (px).`,
    );
  }

  if (config.minTextSize !== undefined && !isPositiveNumber(config.minTextSize)) {
    throw new SurfaceValidationError(
      `Surface "${surfaceId}": invalid minTextSize ${describeInvalid(
        config.minTextSize,
      )}. minTextSize must be a positive number (px).`,
    );
  }

  if (
    config.attentionWindow !== undefined &&
    !isPositiveNumber(config.attentionWindow)
  ) {
    throw new SurfaceValidationError(
      `Surface "${surfaceId}": invalid attentionWindow ${describeInvalid(
        config.attentionWindow,
      )}. attentionWindow must be a positive number (seconds).`,
    );
  }

  if (
    typeof config.viewingDistance === "number" &&
    !isPositiveNumber(config.viewingDistance)
  ) {
    throw new SurfaceValidationError(
      `Surface "${surfaceId}": invalid viewingDistance ${describeInvalid(
        config.viewingDistance,
      )}. A numeric viewingDistance must be a positive number (cm).`,
    );
  }

  if (config.safeArea !== undefined) {
    for (const edge of ["top", "right", "bottom", "left"] as const) {
      if (!isNonNegativeNumber(config.safeArea[edge])) {
        throw new SurfaceValidationError(
          `Surface "${surfaceId}": invalid safeArea.${edge} ${describeInvalid(
            config.safeArea[edge],
          )}. safeArea insets must be non-negative numbers.`,
        );
      }
    }
  }

  // Cross-field constraint: a touch-only surface is meaningless without a
  // defined minimum tap target — the resolver needs it to size controls.
  if (config.touchOnly === true && config.minTapTarget === undefined) {
    throw new SurfaceValidationError(
      `Surface "${surfaceId}" is touchOnly but defines no minTapTarget. ` +
        `A touch-only surface must specify minTapTarget (px).`,
    );
  }

  return { ...config };
}
