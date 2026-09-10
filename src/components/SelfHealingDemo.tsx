/**
 * Self-healing (combined failure) demo.
 *
 * Loads the deliberately broken scenario (absurdly long headline, invalid hero
 * image src, missing logo src, tiny surface, optional longer German CTA), shows
 * a brief "Layout invalid — re-optimizing" beat, then the recovered layout.
 *
 * "Before" is the naive resolver's attempt on the same input (overlap / tiny),
 * "after" is the real pipeline's recovery. The LayoutDebugger panel is reused
 * verbatim, fed a trace whose per-element notes are augmented with the
 * placeholder decisions the renderer made for the broken images.
 */

import { useEffect, useMemo, useState } from "react";
import { buildGraph } from "../core/graph";
import { resolveContext } from "../core/context";
import { resolveLayout } from "../core/resolver";
import { naiveResolveLayout } from "../core/naive-resolver";
import type { DecisionTrace } from "../core/trace";
import {
  buildSelfHealingSpec,
  INVALID_IMAGE_SRC,
  selfHealingSurface,
  type ScenarioLocale,
} from "../core/self-healing-scenario";
import { SurfaceStage } from "./SurfaceStage";
import { LayoutDebugger } from "./LayoutDebugger";

type Phase = "idle" | "optimizing" | "done";

export function SelfHealingDemo(): JSX.Element {
  const [phase, setPhase] = useState<Phase>("idle");
  const [locale, setLocale] = useState<ScenarioLocale>("en");

  const spec = useMemo(() => buildSelfHealingSpec(locale), [locale]);
  const specById = useMemo(
    () => new Map(spec.elements.map((e) => [e.id, e])),
    [spec],
  );
  const graph = useMemo(() => buildGraph(spec), [spec]);

  const { naive, layout, trace } = useMemo(() => {
    const n = naiveResolveLayout(graph, selfHealingSurface);
    const resolved = resolveLayout(
      graph,
      resolveContext(selfHealingSurface),
      selfHealingSurface,
    );
    return { naive: n, layout: resolved.layout, trace: resolved.trace };
  }, [graph]);

  const augmentedTrace: DecisionTrace = useMemo(() => {
    const extra: string[] = [];
    for (const el of layout.elements) {
      if (!el.visible) continue;
      const s = specById.get(el.id);
      if (s?.type === "image" && (s.src === "" || s.src === INVALID_IMAGE_SRC)) {
        extra.push(
          `${el.id}: image src ${
            s.src === "" ? "missing" : "failed to load"
          } → kept its layout slot, rendered as a placeholder box`,
        );
      }
    }
    return { ...trace, perElementNotes: [...trace.perElementNotes, ...extra] };
  }, [trace, layout, specById]);

  useEffect(() => {
    if (phase !== "optimizing") return;
    const t = setTimeout(() => setPhase("done"), 900);
    return () => clearTimeout(t);
  }, [phase]);

  useEffect(() => {
    if (phase === "done") setPhase("optimizing");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locale]);

  const visible = layout.elements.filter((e) => e.visible);

  return (
    <section className="ale-panel" data-testid="self-healing-demo">
      <h2 className="ale-h2">Self-healing — combined failure recovery</h2>
      <p className="ale-note" style={{ maxWidth: 680 }}>
        Long headline + invalid hero image + missing logo image + a longer
        translated CTA, all on a 240×260 touch panel. The pipeline recovers to a
        valid, overlap-free layout with the CTA still visible.
      </p>

      <div className="ale-toolbar">
        <button
          type="button"
          className="ale-btn"
          data-testid="run-self-healing"
          onClick={() => setPhase("optimizing")}
        >
          Load broken scenario
        </button>
        <label className="ale-field">
          CTA locale
          <select
            className="ale-select"
            data-testid="self-healing-locale"
            name="self-healing-locale"
            value={locale}
            onChange={(e) => setLocale(e.target.value as ScenarioLocale)}
          >
            <option value="en">English</option>
            <option value="de">German (longer)</option>
          </select>
        </label>
      </div>

      {phase === "optimizing" && (
        <p className="ale-status" data-testid="self-healing-status">
          Layout invalid — re-optimizing…
        </p>
      )}

      {phase === "done" && (
        <>
          <div className="ale-split-grid" style={{ margin: "4px 0 16px" }}>
            <div className="ale-card" data-testid="self-healing-before">
              <h3 className="ale-h3" style={{ color: "var(--bad)" }}>
                Before — naive attempt (overlapping / clipped)
              </h3>
              <SurfaceStage
                surface={selfHealingSurface}
                elements={naive.elements}
                specById={specById}
                maxWidth={360}
                maxHeight={380}
              />
            </div>
            <div className="ale-card" data-testid="self-healing-after">
              <h3 className="ale-h3" style={{ color: "var(--ok)" }}>
                After — recovered ({trace.winningStrategy}, {visible.length}/
                {layout.elements.length} visible)
              </h3>
              <SurfaceStage
                surface={selfHealingSurface}
                elements={layout.elements}
                specById={specById}
                maxWidth={360}
                maxHeight={380}
              />
            </div>
          </div>

          <div style={{ maxWidth: 520 }}>
            <LayoutDebugger trace={augmentedTrace} />
          </div>
        </>
      )}
    </section>
  );
}
