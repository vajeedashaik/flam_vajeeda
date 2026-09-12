/**
 * One realistic ad spec + five genuinely different surface profiles.
 * Every object here goes through its factory, so this file also acts as a
 * smoke test that the validators accept realistic input.
 */

import { defineAd, type AdSpec } from "./spec";
import { defineSurface, type SurfaceProfile } from "./surfaces";

/**
 * A product ad: headline, product shot, price, CTA, logo.
 * priority: lower = more critical. The CTA outranks the product image because
 * a click is the goal; the logo is last because brand presence survives even
 * as a tiny mark.
 *
 * Real content (a Nykaa-style PDP ad for an actual Dior product), not
 * placeholder text — headline/CTA/price/logo all carry a literal `text`, so
 * they're sized from a real measureText() pass (candidates.ts) and rendered as
 * real copy (SurfaceStage), not "role (id) WxH" debug boxes. The product photo
 * is a real asset (public/products/…), not a colored rectangle.
 */
export const productAd: AdSpec = defineAd({
  id: "dior-backstage-rosy-glow",
  name: "DIOR Backstage Rosy Glow Stick — 012 Rosewood",
  elements: [
    {
      id: "headline",
      type: "text",
      role: "primary",
      priority: 1,
      importance: "critical",
      interaction: "static",
      visibility: "always",
      text: "Buildable Rosy Glow For Cheeks & Lips",
      fontSize: 24,
      minSize: { width: 180, height: 40 },
      preferredSize: { width: 420, height: 96 },
    },
    {
      id: "cta",
      type: "button",
      role: "action",
      priority: 2,
      importance: "critical",
      interaction: "clickable",
      visibility: "always",
      text: "ADD TO BAG",
      fontSize: 15,
      minSize: { width: 120, height: 44 },
      preferredSize: { width: 200, height: 56 },
    },
    {
      id: "product-image",
      type: "image",
      role: "hero",
      priority: 3,
      importance: "should-survive",
      interaction: "static",
      visibility: "degradable",
      src: "/products/dior-backstage-rosy-glow.png",
      minSize: { width: 96, height: 96 },
      preferredSize: { width: 480, height: 480 },
    },
    {
      id: "price",
      type: "text",
      role: "secondary",
      priority: 4,
      importance: "should-survive",
      interaction: "static",
      visibility: "degradable",
      text: "₹2,900 · Shade 012 Rosewood",
      fontSize: 15,
      minSize: { width: 64, height: 24 },
      preferredSize: { width: 140, height: 48 },
    },
    {
      id: "logo",
      type: "text",
      role: "branding",
      priority: 5,
      importance: "nice-to-have",
      interaction: "static",
      visibility: "decorative-only",
      text: "DIOR",
      fontSize: 18,
      minSize: { width: 24, height: 24 },
      preferredSize: { width: 96, height: 32 },
      brandRules: { locked: true, minSize: { width: 24, height: 24 } },
    },
  ],
});

/** Phone held in portrait, arm's length, thumb reach, quick glance. */
export const mobilePortrait: SurfaceProfile = defineSurface({
  id: "mobilePortrait",
  name: "Phone — portrait",
  width: 390,
  height: 844,
  safeArea: { top: 59, right: 0, bottom: 34, left: 0 },
  minTapTarget: 44,
  minTextSize: 12,
  touchOnly: true,
  viewingDistance: "near",
  interaction: "touch",
  attentionWindow: 3,
  motion: true,
  audio: false,
});

/** Same phone rotated: wide and short, notch now on the side. */
export const mobileLandscape: SurfaceProfile = defineSurface({
  id: "mobileLandscape",
  name: "Phone — landscape",
  width: 844,
  height: 390,
  safeArea: { top: 0, right: 59, bottom: 21, left: 59 },
  minTapTarget: 44,
  minTextSize: 12,
  touchOnly: true,
  viewingDistance: "near",
  interaction: "touch",
  attentionWindow: 2,
  motion: true,
  audio: false,
});

/** Broadcast lower-third strip: overlaid on live video, seen from a sofa. */
export const broadcastLowerThird: SurfaceProfile = defineSurface({
  id: "broadcastLowerThird",
  name: "Broadcast — lower third",
  width: 1920,
  height: 320,
  safeArea: { top: 16, right: 96, bottom: 54, left: 96 },
  minTextSize: 32,
  touchOnly: false,
  viewingDistance: "far",
  interaction: "none",
  attentionWindow: 6,
  motion: true,
  audio: true,
});

/** Free-standing retail kiosk: portrait panel, gloved/dwell touch, long dwell. */
export const retailKiosk: SurfaceProfile = defineSurface({
  id: "retailKiosk",
  name: "Retail kiosk — portrait panel",
  width: 1080,
  height: 1920,
  safeArea: { top: 48, right: 48, bottom: 120, left: 48 },
  minTapTarget: 60,
  minTextSize: 20,
  touchOnly: true,
  viewingDistance: 80,
  interaction: "touch",
  attentionWindow: 25,
  motion: true,
  audio: false,
});

/** Printed panel with a QR code: static ink, no interaction, no motion/audio. */
export const printQRPanel: SurfaceProfile = defineSurface({
  id: "printQRPanel",
  name: "Print — QR call-out panel",
  width: 620,
  height: 874,
  safeArea: { top: 36, right: 36, bottom: 36, left: 36 },
  minTextSize: 24,
  touchOnly: false,
  viewingDistance: "near",
  interaction: "none",
  attentionWindow: 40,
  motion: false,
  audio: false,
});

export const surfaceProfiles = {
  mobilePortrait,
  mobileLandscape,
  broadcastLowerThird,
  retailKiosk,
  printQRPanel,
} as const;
