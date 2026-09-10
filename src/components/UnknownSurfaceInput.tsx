/**
 * 5.5 — live "unknown surface" input.
 *
 * Type a brand-new surface's constraints, hit Resolve, and the exact same
 * pipeline every other surface uses runs on it: defineSurface() (so Phase 1
 * validation fires for real) → buildGraph (shared) → resolveContext →
 * resolveLayout → SurfaceStage. No new resolver code path.
 *
 * If defineSurface() throws on an invalid combination, its real error message
 * is shown verbatim — not swallowed.
 */

import { useState } from "react";
import { resolveContext } from "../core/context";
import { resolveLayout } from "../core/resolver";
import {
  defineSurface,
  type SurfaceConfig,
  type SurfaceProfile,
  type ViewingDistance,
} from "../core/surfaces";
import type { ExperienceGraph } from "../core/graph";
import type { AdElement } from "../core/spec";
import type { ResolvedLayout } from "../core/resolver";
import { SurfaceStage } from "./SurfaceStage";

interface Resolved {
  surface: SurfaceProfile;
  layout: ResolvedLayout;
  winningStrategy: string;
}

function parseViewingDistance(raw: string): ViewingDistance | undefined {
  const v = raw.trim().toLowerCase();
  if (v === "") return undefined;
  if (v === "near" || v === "far") return v;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

export function UnknownSurfaceInput({
  graph,
  specById,
}: {
  graph: ExperienceGraph;
  specById: Map<string, AdElement>;
}): JSX.Element {
  const [width, setWidth] = useState("500");
  const [height, setHeight] = useState("500");
  const [minTapTarget, setMinTapTarget] = useState("");
  const [touchOnly, setTouchOnly] = useState(false);
  const [viewingDistance, setViewingDistance] = useState("");
  const [attentionWindow, setAttentionWindow] = useState("");

  const [result, setResult] = useState<Resolved | null>(null);
  const [error, setError] = useState<string | null>(null);

  function submit(e: React.FormEvent): void {
    e.preventDefault();
    setError(null);

    const config: SurfaceConfig = {
      id: `unknown-${Date.now()}`,
      name: "Unknown surface (entered live)",
      width: Number(width),
      height: Number(height),
    };
    const tap = minTapTarget.trim();
    if (tap !== "") config.minTapTarget = Number(tap);
    if (touchOnly) config.touchOnly = true;
    const vd = parseViewingDistance(viewingDistance);
    if (vd !== undefined) config.viewingDistance = vd;
    const aw = attentionWindow.trim();
    if (aw !== "") config.attentionWindow = Number(aw);

    try {
      const surface = defineSurface(config);
      const resolved = resolveLayout(graph, resolveContext(surface), surface);
      setResult({
        surface,
        layout: resolved.layout,
        winningStrategy: resolved.trace.winningStrategy,
      });
    } catch (err) {
      setResult(null);
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  const field: React.CSSProperties = {
    display: "flex",
    flexDirection: "column",
    gap: 2,
    fontSize: 12,
  };

  return (
    <section data-testid="unknown-surface-input">
      <h2 style={{ fontSize: 16, margin: "0 0 6px" }}>
        Unknown surface — resolve a brand-new one live
      </h2>
      <p style={{ fontSize: 12, color: "#555", margin: "0 0 12px" }}>
        Runs the exact same defineSurface → resolveLayout path as every built-in
        surface. No code changes.
      </p>

      <form
        onSubmit={submit}
        style={{
          display: "flex",
          gap: 14,
          flexWrap: "wrap",
          alignItems: "flex-end",
          marginBottom: 14,
        }}
      >
        <label style={field}>
          width
          <input
            data-testid="us-width"
            value={width}
            onChange={(e) => setWidth(e.target.value)}
            style={{ width: 90 }}
          />
        </label>
        <label style={field}>
          height
          <input
            data-testid="us-height"
            value={height}
            onChange={(e) => setHeight(e.target.value)}
            style={{ width: 90 }}
          />
        </label>
        <label style={field}>
          minTapTarget
          <input
            data-testid="us-min-tap"
            value={minTapTarget}
            onChange={(e) => setMinTapTarget(e.target.value)}
            placeholder="(none)"
            style={{ width: 90 }}
          />
        </label>
        <label style={{ ...field, flexDirection: "row", alignItems: "center", gap: 6 }}>
          <input
            data-testid="us-touch-only"
            type="checkbox"
            checked={touchOnly}
            onChange={(e) => setTouchOnly(e.target.checked)}
          />
          touchOnly
        </label>
        <label style={field}>
          viewingDistance
          <input
            data-testid="us-viewing-distance"
            value={viewingDistance}
            onChange={(e) => setViewingDistance(e.target.value)}
            placeholder="near / far / cm"
            style={{ width: 110 }}
          />
        </label>
        <label style={field}>
          attentionWindow (s)
          <input
            data-testid="us-attention"
            value={attentionWindow}
            onChange={(e) => setAttentionWindow(e.target.value)}
            placeholder="(none)"
            style={{ width: 90 }}
          />
        </label>
        <button
          type="submit"
          data-testid="us-submit"
          style={{
            fontSize: 13,
            padding: "6px 16px",
            border: "1px solid #0066cc",
            background: "#e8f1fb",
            borderRadius: 4,
            cursor: "pointer",
          }}
        >
          Resolve
        </button>
      </form>

      {error !== null && (
        <p
          data-testid="us-error"
          style={{
            fontSize: 13,
            color: "#c33",
            background: "#fdecec",
            border: "1px solid #f3b8b8",
            padding: "8px 10px",
            borderRadius: 4,
            maxWidth: 640,
          }}
        >
          {error}
        </p>
      )}

      {result !== null && (
        <div data-testid="us-result">
          <p style={{ fontSize: 12, color: "#555", margin: "0 0 8px" }}>
            {result.surface.width}×{result.surface.height} · winning strategy{" "}
            <b>{result.winningStrategy}</b> ·{" "}
            {result.layout.elements.filter((e) => e.visible).length}/
            {result.layout.elements.length} elements visible
          </p>
          <SurfaceStage
            surface={result.surface}
            elements={result.layout.elements}
            specById={specById}
            maxWidth={640}
            maxHeight={520}
          />
        </div>
      )}
    </section>
  );
}
