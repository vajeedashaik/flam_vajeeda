/**
 * SurfaceStage — the one place a ResolvedLayout becomes pixels.
 *
 * Every view (single, side-by-side, naive-vs-smart, degradation slider,
 * self-healing, unknown-surface) renders through this component so they all
 * scale, frame, and place elements identically. It takes an already-resolved
 * element list — it never calls the resolver itself.
 *
 * Scaling: the box is laid out at real pixel size and shrunk with
 * `transform: scale(s)`, s = min(1, maxW/width, maxH/height), so the aspect
 * ratio is exact and content is never upscaled. An outer wrapper is sized to
 * the scaled dimensions so surrounding layout reserves the right space.
 *
 * Missing/broken images: an <img> whose src fails to load swaps to a visible
 * dashed placeholder box (via onError) instead of showing a broken-image glyph.
 * The element keeps its resolved slot either way.
 *
 * Visual styling (frames, role tints, placeholder) lives in theme.css; the
 * data-* hooks (data-testid, data-surface-id, data-element-id, data-role,
 * data-placeholder) are unchanged.
 *
 * Optional debug overlay (`showDebug`): rendered as the LAST child inside the
 * same `.ale-surface` div that the real elements are children of, so it rides
 * the same `transform: scale(s)` and needs no scale math of its own — boxes
 * stay pixel-aligned with the real elements at every scale factor.
 */

import { useEffect, useState } from "react";
import type { AdElement } from "../core/spec";
import type { ResolvedElement } from "../core/resolver";
import type { SurfaceProfile } from "../core/surfaces";
import type { DecisionTrace } from "../core/trace";
import { measureTextBlock } from "../core/text-measure";
import { DebugOverlay } from "./DebugOverlay";

export type StageFrame = "phone" | "wide" | "square" | "none";

/** Matches candidates.ts's own default when a text/button element declares no fontSize. */
const DEFAULT_FONT_SIZE = 16;
/** Never render text smaller than this, no matter how hard a box was shrunk. */
const MIN_LEGIBLE_FONT = 8;

/**
 * The resolver sizes a text/button element from its NATURAL (unwrapped, full
 * font size) footprint, then the placement cascade can still shrink the box
 * below that when space runs out (§5's shrink-then-drop cascade). Rendering
 * real copy at a fixed font size would let a heavily-shrunk box's text simply
 * overflow past `overflow: hidden` and read as gibberish. This picks the
 * largest font size (down to `MIN_LEGIBLE_FONT`) whose wrapped block still
 * fits the box actually resolved — pure presentation, reuses the exact same
 * `measureTextBlock` the resolver already uses to size things for real.
 */
function fitFontSize(
  text: string,
  declaredFontSize: number,
  boxWidth: number,
  boxHeight: number,
): number {
  const block = measureTextBlock(text, declaredFontSize, boxWidth);
  if (block.height <= boxHeight) return declaredFontSize;
  const scale = boxHeight / block.height;
  return Math.max(MIN_LEGIBLE_FONT, Math.floor(declaredFontSize * scale));
}

interface StageElementProps {
  el: ResolvedElement;
  spec?: AdElement | undefined;
}

function StageElement({ el, spec }: StageElementProps): JSX.Element {
  const [imgBroken, setImgBroken] = useState(false);
  const isImage = spec?.type === "image";
  const src = spec?.src;
  // Reset the broken flag if the src changes (e.g. scenario reloaded).
  useEffect(() => setImgBroken(false), [src]);

  const pos: React.CSSProperties = {
    left: el.x,
    top: el.y,
    width: el.width,
    height: el.height,
  };

  // A placeholder means the src was explicitly present-but-broken: an empty
  // string ("no usable image") or a real src that failed to load. An image
  // element with no `src` field at all is just drawn as a role box.
  if (isImage && (src === "" || imgBroken)) {
    return (
      <div
        className="ale-el ale-el--placeholder"
        data-element-id={el.id}
        data-role={el.role}
        data-placeholder="true"
        style={pos}
      >
        image unavailable — {el.id}
      </div>
    );
  }

  if (isImage && src !== undefined) {
    return (
      <div className="ale-el" data-element-id={el.id} data-role={el.role} style={pos}>
        <img src={src} alt={el.id} onError={() => setImgBroken(true)} />
      </div>
    );
  }

  // Real copy when the spec carries it (the same string candidates.ts already
  // measured to size this element) — falls back to the id/role/size debug
  // label only for specs that never set `text` at all.
  const label =
    spec?.text ??
    `${el.role} (${el.id}) ${Math.round(el.width)}×${Math.round(el.height)}`;
  const textStyle: React.CSSProperties | undefined =
    spec?.text !== undefined
      ? {
          fontSize: fitFontSize(
            spec.text,
            spec.fontSize ?? DEFAULT_FONT_SIZE,
            el.width,
            el.height,
          ),
        }
      : undefined;

  return (
    <div
      className="ale-el"
      data-element-id={el.id}
      data-role={el.role}
      style={{ ...pos, ...textStyle }}
    >
      {label}
    </div>
  );
}

export interface SurfaceStageProps {
  surface: SurfaceProfile;
  elements: ResolvedElement[];
  specById?: Map<string, AdElement> | undefined;
  /** Winning candidate's trace — used only to label shrunk elements in the debug overlay. */
  trace?: DecisionTrace | undefined;
  /** Overlay safe-area outline + per-element zone/shrink bounding boxes (§4.7 "DevTools for Ads"). */
  showDebug?: boolean;
  maxWidth?: number;
  maxHeight?: number;
  frame?: StageFrame;
  /** Optional caption rendered under the framed surface. */
  caption?: string;
}

export function SurfaceStage({
  surface,
  elements,
  specById,
  trace,
  showDebug = false,
  maxWidth = 900,
  maxHeight = 620,
  frame = "none",
  caption,
}: SurfaceStageProps): JSX.Element {
  const visible = elements.filter((e) => e.visible);
  const scale = Math.min(1, maxWidth / surface.width, maxHeight / surface.height);

  return (
    <figure className="ale-stage">
      <div className="ale-scroll-x">
        <div className="ale-stage-frame" data-frame={frame}>
          <div
            style={{ width: surface.width * scale, height: surface.height * scale }}
          >
            <div
              className="ale-surface"
              data-testid="surface"
              data-surface-id={surface.id}
              style={{
                position: "relative",
                width: surface.width,
                height: surface.height,
                transform: `scale(${scale})`,
                transformOrigin: "top left",
              }}
            >
              {visible.map((el) => (
                <StageElement key={el.id} el={el} spec={specById?.get(el.id)} />
              ))}
              <span className="ale-platform-badge" aria-hidden="true">
                nykaa
              </span>
              {showDebug && (
                <DebugOverlay surface={surface} elements={elements} trace={trace} />
              )}
            </div>
          </div>
        </div>
      </div>
      {caption !== undefined && (
        <figcaption className="ale-stage-caption">{caption}</figcaption>
      )}
    </figure>
  );
}
