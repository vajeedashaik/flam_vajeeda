/**
 * 5.2 — a deliberately adversarial scenario.
 *
 * Everything that can go wrong at once:
 *   - the headline string is absurdly long for the surface
 *   - the hero image has an invalid src that will never load
 *   - the logo image has no src at all
 *   - the whole thing is placed on a tiny 240×260 touch surface
 *   - a second locale swaps the CTA for a much longer German string
 *
 * The pipeline must still return a layout with zero overlaps / out-of-bounds
 * elements, and the CTA (visibility: "always") must stay visible through all of
 * it. Broken images keep their layout slot and render as placeholders.
 */

import { defineAd, type AdSpec } from "./spec";
import { defineSurface, type SurfaceProfile } from "./surfaces";

export type ScenarioLocale = "en" | "de";

const HEADLINE_TEXT =
  "Our biggest summer clearance event ever is finally here with unbeatable savings across every single category in the entire store";

const CTA_TEXT: Record<ScenarioLocale, string> = {
  en: "Shop the entire summer collection right now",
  de: "Jetzt die komplette Sommerkollektion im Sommerschlussverkauf kaufen",
};

/** An invalid absolute URL — resolves as a broken image in the browser. */
export const INVALID_IMAGE_SRC = "https://invalid.invalid/missing-hero-image.png";

export function buildSelfHealingSpec(locale: ScenarioLocale = "en"): AdSpec {
  return defineAd({
    id: `self-healing-${locale}`,
    name: `Self-healing scenario (${locale.toUpperCase()})`,
    elements: [
      {
        id: "headline",
        type: "text",
        role: "primary",
        priority: 1,
        importance: "critical",
        interaction: "static",
        visibility: "always",
        text: HEADLINE_TEXT,
        fontSize: 28,
        minSize: { width: 120, height: 30 },
        preferredSize: { width: 520, height: 120 },
      },
      {
        id: "cta",
        type: "button",
        role: "action",
        priority: 2,
        importance: "critical",
        interaction: "clickable",
        visibility: "always",
        text: CTA_TEXT[locale],
        fontSize: 18,
        minSize: { width: 80, height: 40 },
        preferredSize: { width: 300, height: 56 },
      },
      {
        id: "hero",
        type: "image",
        role: "hero",
        priority: 3,
        importance: "should-survive",
        interaction: "static",
        visibility: "degradable",
        src: INVALID_IMAGE_SRC,
        minSize: { width: 80, height: 80 },
        preferredSize: { width: 220, height: 220 },
      },
      {
        id: "logo",
        type: "image",
        role: "branding",
        priority: 4,
        importance: "nice-to-have",
        interaction: "static",
        visibility: "decorative-only",
        // Explicitly no usable image — renders as a placeholder, keeps its slot.
        src: "",
        minSize: { width: 24, height: 24 },
        preferredSize: { width: 88, height: 30 },
      },
    ],
  });
}

/** Tiny touch surface — barely enough room for the headline alone. */
export const selfHealingSurface: SurfaceProfile = defineSurface({
  id: "selfHealingTiny",
  name: "Self-healing — cramped touch panel 240×260",
  width: 240,
  height: 260,
  minTapTarget: 44,
  minTextSize: 12,
  touchOnly: true,
  viewingDistance: "near",
  interaction: "touch",
  attentionWindow: 3,
  motion: false,
  audio: false,
});
