/**
 * Real text measurement.
 *
 * candidates.ts previously sized text elements from a fixed preferredSize guess.
 * This module measures the ACTUAL rendered width of a string at a given font
 * size using an offscreen <canvas> 2D context's measureText(). That lets long
 * or translated headlines (e.g. a German CTA that is 40% longer than the
 * English) be laid out from their true width instead of an estimate.
 *
 * Environments without a DOM (the Vitest "node" runner) have no canvas, so a
 * deterministic linear fallback is used there: width ≈ length × fontSize ×
 * AVG_GLYPH_ASPECT. The fallback preserves the only property callers and tests
 * rely on — a longer string measures wider at the same font size.
 */

const AVG_GLYPH_ASPECT = 0.52;
const DEFAULT_FONT_FAMILY = "system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
const LINE_HEIGHT_FACTOR = 1.3;

let cachedCtx: CanvasRenderingContext2D | null | undefined;

function getContext(): CanvasRenderingContext2D | null {
  if (cachedCtx !== undefined) return cachedCtx;
  try {
    if (typeof document === "undefined") {
      cachedCtx = null;
    } else {
      const canvas = document.createElement("canvas");
      cachedCtx = canvas.getContext("2d");
    }
  } catch {
    cachedCtx = null;
  }
  return cachedCtx ?? null;
}

/** Rendered width (px) of `text` on a single line at `fontSizePx`. */
export function measureTextWidth(
  text: string,
  fontSizePx: number,
  fontFamily: string = DEFAULT_FONT_FAMILY,
): number {
  const ctx = getContext();
  if (ctx) {
    ctx.font = `${fontSizePx}px ${fontFamily}`;
    return ctx.measureText(text).width;
  }
  return text.length * fontSizePx * AVG_GLYPH_ASPECT;
}

export interface MeasuredBlock {
  /** Width of the widest line, capped at maxWidth. */
  width: number;
  /** Total height for all wrapped lines. */
  height: number;
  lines: number;
}

/**
 * Measure `text` wrapped greedily to `maxWidth`. Returns the block's real
 * width/height and line count — used to decide whether a headline fits, needs
 * to wrap, or must shrink.
 */
export function measureTextBlock(
  text: string,
  fontSizePx: number,
  maxWidth: number,
  fontFamily: string = DEFAULT_FONT_FAMILY,
): MeasuredBlock {
  const lineHeight = Math.ceil(fontSizePx * LINE_HEIGHT_FACTOR);
  const single = measureTextWidth(text, fontSizePx, fontFamily);

  if (maxWidth <= 0 || single <= maxWidth) {
    return { width: Math.ceil(single), height: lineHeight, lines: 1 };
  }

  const words = text.split(/\s+/).filter(Boolean);
  let lines = 1;
  let widest = 0;
  let current = "";

  for (const word of words) {
    const candidate = current === "" ? word : `${current} ${word}`;
    const w = measureTextWidth(candidate, fontSizePx, fontFamily);
    if (w <= maxWidth || current === "") {
      current = candidate;
      widest = Math.max(widest, Math.min(w, maxWidth));
    } else {
      lines++;
      current = word;
      widest = Math.max(widest, Math.min(measureTextWidth(word, fontSizePx, fontFamily), maxWidth));
    }
  }

  return {
    width: Math.ceil(Math.min(widest, maxWidth)),
    height: lines * lineHeight,
    lines,
  };
}
