/**
 * SurfaceStage — the one place a ResolvedLayout becomes pixels.
 *
 * Every Phase 5 view (single, side-by-side, naive-vs-smart, degradation slider,
 * self-healing, unknown-surface) renders through this component so they all
 * scale, frame, and place elements identically. It takes an already-resolved
 * element list — it never calls the resolver itself.
 *
 * Scaling matches the Phase 3/4 App: the box is laid out at real pixel size and
 * shrunk with `transform: scale(s)`, s = min(1, maxW/width, maxH/height), so the
 * aspect ratio is exact and content is never upscaled. An outer wrapper is sized
 * to the scaled dimensions so surrounding layout reserves the right space.
 *
 * Missing/broken images: an <img> whose src fails to load swaps to a visible
 * dashed placeholder box (via onError) instead of showing a broken-image glyph.
 * The element keeps its resolved slot either way.
 */

import { useEffect, useState } from "react";
import type { AdElement } from "../core/spec";
import type { ResolvedElement } from "../core/resolver";
import type { SurfaceProfile } from "../core/surfaces";

export type StageFrame = "phone" | "wide" | "square" | "none";

const ROLE_TINT: Record<string, string> = {
  primary: "rgba(0, 102, 204, 0.16)",
  action: "rgba(214, 90, 0, 0.18)",
  hero: "rgba(120, 0, 160, 0.14)",
  secondary: "rgba(0, 140, 90, 0.16)",
  branding: "rgba(90, 90, 90, 0.16)",
};

const ROLE_BORDER: Record<string, string> = {
  primary: "#0066cc",
  action: "#d65a00",
  hero: "#7a00a0",
  secondary: "#008c5a",
  branding: "#5a5a5a",
};

function frameStyle(frame: StageFrame): React.CSSProperties {
  switch (frame) {
    case "phone":
      return { padding: 10, borderRadius: 22, background: "#111", border: "1px solid #000" };
    case "wide":
      return { padding: 8, borderRadius: 6, background: "#111", border: "1px solid #000" };
    case "square":
      return { padding: 10, borderRadius: 4, background: "#111", border: "1px solid #000" };
    default:
      return {};
  }
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

  const base: React.CSSProperties = {
    position: "absolute",
    left: el.x,
    top: el.y,
    width: el.width,
    height: el.height,
    boxSizing: "border-box",
    fontSize: 11,
    padding: 2,
    overflow: "hidden",
  };

  // A placeholder means the src was explicitly present-but-broken: an empty
  // string (spec says "no usable image") or a real src that failed to load.
  // An image element with no `src` field at all is just drawn as a role box —
  // that is the normal demo spec, not a failure.
  if (isImage && (src === "" || imgBroken)) {
    return (
      <div
        data-element-id={el.id}
        data-role={el.role}
        data-placeholder="true"
        style={{
          ...base,
          border: "2px dashed #c33",
          background:
            "repeating-linear-gradient(45deg, #fdeaea, #fdeaea 6px, #f8d5d5 6px, #f8d5d5 12px)",
          color: "#a11",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          textAlign: "center",
        }}
      >
        image unavailable — {el.id}
      </div>
    );
  }

  if (isImage && src !== undefined) {
    return (
      <div data-element-id={el.id} data-role={el.role} style={base}>
        <img
          src={src}
          alt={el.id}
          onError={() => setImgBroken(true)}
          style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
        />
      </div>
    );
  }

  return (
    <div
      data-element-id={el.id}
      data-role={el.role}
      style={{
        ...base,
        border: `1px solid ${ROLE_BORDER[el.role] ?? "#0066cc"}`,
        background: ROLE_TINT[el.role] ?? "rgba(0,102,204,0.15)",
      }}
    >
      {el.role} ({el.id}) {Math.round(el.width)}×{Math.round(el.height)}
    </div>
  );
}

export interface SurfaceStageProps {
  surface: SurfaceProfile;
  elements: ResolvedElement[];
  specById?: Map<string, AdElement>;
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
  maxWidth = 900,
  maxHeight = 620,
  frame = "none",
  caption,
}: SurfaceStageProps): JSX.Element {
  const visible = elements.filter((e) => e.visible);
  const scale = Math.min(1, maxWidth / surface.width, maxHeight / surface.height);

  return (
    <figure style={{ margin: 0 }}>
      <div style={{ display: "inline-block", ...frameStyle(frame) }}>
        <div
          style={{
            width: surface.width * scale,
            height: surface.height * scale,
          }}
        >
          <div
            data-testid="surface"
            data-surface-id={surface.id}
            style={{
              position: "relative",
              width: surface.width,
              height: surface.height,
              transform: `scale(${scale})`,
              transformOrigin: "top left",
              outline: "2px solid #222",
              background: "#fafafa",
            }}
          >
            {visible.map((el) => (
              <StageElement key={el.id} el={el} spec={specById?.get(el.id)} />
            ))}
          </div>
        </div>
      </div>
      {caption !== undefined && (
        <figcaption style={{ fontSize: 11, color: "#555", marginTop: 4 }}>
          {caption}
        </figcaption>
      )}
    </figure>
  );
}
