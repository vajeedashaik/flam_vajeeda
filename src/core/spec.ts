/**
 * Ad spec types + defineAd() factory.
 *
 * An AdSpec describes WHAT an ad contains and the intent behind each element.
 * It is fully independent of any surface — no width/height, no placement.
 * Layout resolution happens in a later phase.
 */

/** Closed union. A typo like "primry" is a compile error, not a silent string. */
export type ElementRole =
  | "primary"
  | "hero"
  | "action"
  | "branding"
  | "secondary";

/** Closed union of renderable element kinds. */
export type ElementType = "text" | "image" | "button";

/** How badly this element needs to survive aggressive adaptation. */
export type ElementImportance = "critical" | "should-survive" | "nice-to-have";

/** Whether the element does something when touched/clicked. */
export type ElementInteraction = "clickable" | "static";

/** How the element may be treated when space is tight. */
export type ElementVisibility = "always" | "degradable" | "decorative-only";

export interface SizeConstraint {
  width: number;
  height: number;
}

export interface BrandRules {
  /** If true, the element's size/position must not be altered by the resolver. */
  locked?: boolean;
  /** Brand-mandated minimum render size, independent of layout minSize. */
  minSize?: SizeConstraint;
}

export interface AdElement {
  /** Unique within the spec. */
  id: string;
  type: ElementType;
  role: ElementRole;
  /** Lower = more critical. Must be a positive number. */
  priority: number;

  // ---- Fields below are defined now, unused until later phases. ----
  importance?: ElementImportance;
  interaction?: ElementInteraction;
  visibility?: ElementVisibility;
  minSize?: SizeConstraint;
  preferredSize?: SizeConstraint;
  brandRules?: BrandRules;

  // ---- Phase 5: real content, so text can be measured and images rendered. ----
  /**
   * Literal rendered string for `type: "text"` / `"button"` elements. When
   * present, Phase 5's resolver measures it with an offscreen canvas instead of
   * guessing a size from preferredSize — this is what lets long or translated
   * headlines size correctly.
   */
  text?: string;
  /** Font size (px) used when measuring {@link text}. Defaults to 16. */
  fontSize?: number;
  /**
   * Image source for `type: "image"` elements. A missing or unloadable src is
   * rendered as a visible placeholder box (the element keeps its layout slot).
   */
  src?: string;
}

export interface AdSpec {
  /** Identifier for the ad spec itself. */
  id: string;
  name?: string;
  elements: AdElement[];
}

/**
 * Input shape for {@link defineAd}. Identical to {@link AdSpec} today, kept
 * separate so the public spec type and the constructor input can diverge later.
 */
export type AdConfig = AdSpec;

const VALID_ROLES: readonly ElementRole[] = [
  "primary",
  "hero",
  "action",
  "branding",
  "secondary",
];

/** Thrown by {@link defineAd} when a config fails construction-time validation. */
export class AdSpecValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AdSpecValidationError";
  }
}

/**
 * Construct a validated {@link AdSpec}.
 *
 * Validates at construction time:
 *  - every element has a role from the closed {@link ElementRole} union
 *  - no duplicate element ids
 *  - every priority is a positive, finite number
 *
 * Throws {@link AdSpecValidationError} naming the offending element and field.
 * With a literal config object, an invalid role is also a TypeScript compile
 * error — see `spec.invalid-example.ts.txt`.
 */
export function defineAd(config: AdConfig): AdSpec {
  const adId = config.id;

  if (typeof adId !== "string" || adId.trim() === "") {
    throw new AdSpecValidationError(
      `Ad spec is missing a valid "id" (got ${JSON.stringify(adId)}).`,
    );
  }

  if (!Array.isArray(config.elements) || config.elements.length === 0) {
    throw new AdSpecValidationError(
      `Ad spec "${adId}" must contain at least one element.`,
    );
  }

  const seenIds = new Set<string>();

  for (const element of config.elements) {
    const elementId = element.id;

    if (typeof elementId !== "string" || elementId.trim() === "") {
      throw new AdSpecValidationError(
        `Ad spec "${adId}" has an element with a missing or empty "id".`,
      );
    }

    if (seenIds.has(elementId)) {
      throw new AdSpecValidationError(
        `Ad spec "${adId}": duplicate element id "${elementId}". Element ids must be unique.`,
      );
    }
    seenIds.add(elementId);

    if (!VALID_ROLES.includes(element.role)) {
      throw new AdSpecValidationError(
        `Ad spec "${adId}", element "${elementId}": invalid role ${JSON.stringify(
          element.role,
        )}. Valid roles: ${VALID_ROLES.join(", ")}.`,
      );
    }

    if (
      typeof element.priority !== "number" ||
      !Number.isFinite(element.priority) ||
      element.priority <= 0
    ) {
      throw new AdSpecValidationError(
        `Ad spec "${adId}", element "${elementId}": invalid priority ${JSON.stringify(
          element.priority,
        )}. Priority must be a positive number (lower = more critical).`,
      );
    }
  }

  return {
    id: adId,
    ...(config.name === undefined ? {} : { name: config.name }),
    elements: config.elements.map((element) => ({ ...element })),
  };
}
