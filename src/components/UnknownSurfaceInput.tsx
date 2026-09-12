/**
 * Live "unknown surface" input.
 *
 * Type a brand-new surface's constraints, hit Resolve, and the exact same
 * pipeline every other surface uses runs on it: defineSurface() (so validation
 * fires for real) → buildGraph (shared) → resolveContext → resolveLayout →
 * SurfaceStage. No new resolver code path.
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
import type { DecisionTrace } from "../core/trace";
import { SurfaceStage } from "./SurfaceStage";
import { LayoutDebugger } from "./LayoutDebugger";

interface Resolved {
  surface: SurfaceProfile;
  layout: ResolvedLayout;
  trace: DecisionTrace;
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
        trace: resolved.trace,
      });
    } catch (err) {
      setResult(null);
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <section className="ale-panel" data-testid="unknown-surface-input">
      <h2 className="ale-h2">Unknown surface — resolve a brand-new one live</h2>
      <p className="ale-note">
        Runs the exact same defineSurface → resolveLayout path as every built-in
        surface. No code changes.
      </p>

      <form className="ale-toolbar" onSubmit={submit}>
        <label className="ale-field">
          width
          <input
            className="ale-input"
            data-testid="us-width"
            name="us-width"
            value={width}
            onChange={(e) => setWidth(e.target.value)}
            style={{ width: 90 }}
          />
        </label>
        <label className="ale-field">
          height
          <input
            className="ale-input"
            data-testid="us-height"
            name="us-height"
            value={height}
            onChange={(e) => setHeight(e.target.value)}
            style={{ width: 90 }}
          />
        </label>
        <label className="ale-field">
          minTapTarget
          <input
            className="ale-input"
            data-testid="us-min-tap"
            name="us-min-tap"
            value={minTapTarget}
            onChange={(e) => setMinTapTarget(e.target.value)}
            placeholder="(none)"
            style={{ width: 90 }}
          />
        </label>
        <label className="ale-field" style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <input
            data-testid="us-touch-only"
            name="us-touch-only"
            type="checkbox"
            checked={touchOnly}
            onChange={(e) => setTouchOnly(e.target.checked)}
          />
          touchOnly
        </label>
        <label className="ale-field">
          viewingDistance
          <input
            className="ale-input"
            data-testid="us-viewing-distance"
            name="us-viewing-distance"
            value={viewingDistance}
            onChange={(e) => setViewingDistance(e.target.value)}
            placeholder="near / far / cm"
            style={{ width: 120 }}
          />
        </label>
        <label className="ale-field">
          attentionWindow (s)
          <input
            className="ale-input"
            data-testid="us-attention"
            name="us-attention"
            value={attentionWindow}
            onChange={(e) => setAttentionWindow(e.target.value)}
            placeholder="(none)"
            style={{ width: 90 }}
          />
        </label>
        <button type="submit" className="ale-btn" data-testid="us-submit">
          Resolve
        </button>
      </form>

      {error !== null && (
        <p className="ale-error" data-testid="us-error">
          {error}
        </p>
      )}

      {result !== null && (
        <div data-testid="us-result">
          <p className="ale-meta">
            {result.surface.width}×{result.surface.height} · winning strategy{" "}
            <span className="ale-chip">{result.trace.winningStrategy}</span> ·{" "}
            <span className="ale-num" data-testid="us-visible-count">
              {result.layout.elements.filter((e) => e.visible).length}/
              {result.layout.elements.length}
            </span>{" "}
            elements visible
          </p>

          {result.layout.elements.every((e) => !e.visible) && (
            <p className="ale-error" data-testid="us-nothing-fits">
              Nothing fits on this surface — not even the single highest-priority
              element. {result.surface.width}×{result.surface.height} is too
              small for this ad's declared minimum sizes; every strategy scored
              0 and the pipeline fell back to <b>{result.trace.winningStrategy}</b>{" "}
              arbitrarily (a tie among equally-empty candidates). See the
              debugger below for the per-element reason.
            </p>
          )}

          <div className="ale-stage-wrap">
            <SurfaceStage
              surface={result.surface}
              elements={result.layout.elements}
              specById={specById}
              maxWidth={640}
              maxHeight={520}
            />
          </div>

          <div style={{ maxWidth: 560, marginTop: 14 }}>
            <LayoutDebugger trace={result.trace} />
          </div>
        </div>
      )}
    </section>
  );
}
