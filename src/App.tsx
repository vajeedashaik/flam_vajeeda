/**
 * Phase 5 demo hub.
 *
 * A top nav switches between views. Every view resolves layouts through the
 * exact same buildGraph → resolveContext → resolveLayout pipeline and renders
 * through <SurfaceStage>. The Phase 4 explainability panels (Debugger,
 * Counterfactuals, Health Check) sit under the single-surface view unchanged.
 *
 *   single   — surface picker + live layout + Phase 4 panels + degradation slider
 *   sidebyside — all 5 sample surfaces resolved at once (5.3)
 *   stress   — Stress Lab (5.1); "inspect" loads a surface back into `single`
 *   selfheal — combined-failure recovery demo (5.2)
 *   naive    — naive vs. smart resolver comparison (5.4)
 *   unknown  — type a brand-new surface and resolve it live (5.5)
 */

import { useMemo, useState } from "react";
import { productAd, surfaceProfiles } from "./core/sample-data";
import { defineSurface, type SurfaceProfile } from "./core/surfaces";
import { buildGraph } from "./core/graph";
import { resolveContext } from "./core/context";
import { resolveLayout } from "./core/resolver";
import { LayoutDebugger } from "./components/LayoutDebugger";
import { LayoutCounterfactuals } from "./components/LayoutCounterfactuals";
import { LayoutHealthCheck } from "./components/LayoutHealthCheck";
import { SurfaceStage } from "./components/SurfaceStage";
import { StressLab } from "./components/StressLab";
import { MultiSurfaceView } from "./components/MultiSurfaceView";
import { NaiveVsSmart } from "./components/NaiveVsSmart";
import { DegradationSlider } from "./components/DegradationSlider";
import { UnknownSurfaceInput } from "./components/UnknownSurfaceInput";
import { SelfHealingDemo } from "./components/SelfHealingDemo";

const shrunkKiosk: SurfaceProfile = defineSurface({
  ...surfaceProfiles.retailKiosk,
  id: "retailKioskShrunk",
  name: "Retail kiosk — shrunk 200×200 (degradation demo)",
  width: 200,
  height: 200,
  safeArea: { top: 0, right: 0, bottom: 0, left: 0 },
});

const BASE_OPTIONS: { key: string; surface: SurfaceProfile }[] = [
  { key: "mobilePortrait", surface: surfaceProfiles.mobilePortrait },
  { key: "mobileLandscape", surface: surfaceProfiles.mobileLandscape },
  { key: "broadcastLowerThird", surface: surfaceProfiles.broadcastLowerThird },
  { key: "retailKiosk", surface: surfaceProfiles.retailKiosk },
  { key: "printQRPanel", surface: surfaceProfiles.printQRPanel },
  { key: "retailKioskShrunk", surface: shrunkKiosk },
];

type Mode = "single" | "sidebyside" | "stress" | "selfheal" | "naive" | "unknown";

const MODES: { key: Mode; label: string }[] = [
  { key: "single", label: "Single surface" },
  { key: "sidebyside", label: "Side-by-side (5.3)" },
  { key: "stress", label: "Stress Lab (5.1)" },
  { key: "selfheal", label: "Self-Healing (5.2)" },
  { key: "naive", label: "Naive vs Smart (5.4)" },
  { key: "unknown", label: "Unknown surface (5.5)" },
];

const VIEWPORT_MAX = { width: 900, height: 620 };

export default function App(): JSX.Element {
  const [mode, setMode] = useState<Mode>("single");
  const [selectedKey, setSelectedKey] = useState<string>(BASE_OPTIONS[0]!.key);
  /** Surfaces loaded from the Stress Lab / other views, appended to the picker. */
  const [extraSurfaces, setExtraSurfaces] = useState<SurfaceProfile[]>([]);

  const graph = useMemo(() => buildGraph(productAd), []);
  const specById = useMemo(
    () => new Map(productAd.elements.map((e) => [e.id, e])),
    [],
  );

  const options = useMemo(
    () => [
      ...BASE_OPTIONS,
      ...extraSurfaces.map((s) => ({ key: s.id, surface: s })),
    ],
    [extraSurfaces],
  );

  const option = options.find((o) => o.key === selectedKey) ?? options[0]!;
  const surface = option.surface;

  const { context, layout, trace } = useMemo(() => {
    const ctx = resolveContext(surface);
    const resolved = resolveLayout(graph, ctx, surface);
    return { context: ctx, layout: resolved.layout, trace: resolved.trace };
  }, [graph, surface]);

  function inspectSurface(s: SurfaceProfile): void {
    setExtraSurfaces((prev) =>
      prev.some((p) => p.id === s.id) ? prev : [...prev, s],
    );
    setSelectedKey(s.id);
    setMode("single");
    requestAnimationFrame(() =>
      document
        .querySelector('[data-testid="single-view"]')
        ?.scrollIntoView({ behavior: "smooth", block: "start" }),
    );
  }

  const visible = layout.elements.filter((e) => e.visible);

  return (
    <div style={{ fontFamily: "system-ui, sans-serif", padding: 20 }}>
      <h1 style={{ fontSize: 18, margin: "0 0 12px" }}>
        Adaptive Layout Engine — Phase 5
      </h1>

      <nav
        style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 16 }}
      >
        {MODES.map((m) => (
          <button
            key={m.key}
            type="button"
            data-testid={`mode-${m.key}`}
            aria-pressed={mode === m.key}
            onClick={() => setMode(m.key)}
            style={{
              fontSize: 12,
              padding: "6px 12px",
              borderRadius: 4,
              border: "1px solid #0066cc",
              background: mode === m.key ? "#0066cc" : "#fff",
              color: mode === m.key ? "#fff" : "#0066cc",
              cursor: "pointer",
            }}
          >
            {m.label}
          </button>
        ))}
      </nav>

      {mode === "single" && (
        <div data-testid="single-view">
          <label style={{ fontSize: 13, display: "block", marginBottom: 8 }}>
            Surface:{" "}
            <select
              data-testid="surface-picker"
              value={selectedKey}
              onChange={(e) => setSelectedKey(e.target.value)}
            >
              {options.map((o) => (
                <option key={o.key} value={o.key}>
                  {o.surface.name ?? o.key} ({o.surface.width}×{o.surface.height})
                </option>
              ))}
            </select>
          </label>

          <p style={{ fontSize: 12, color: "#555", margin: "0 0 12px" }}>
            winning strategy:{" "}
            <b data-testid="winning-strategy">{trace.winningStrategy}</b> ·{" "}
            {visible.length}/{layout.elements.length} elements visible · aspect{" "}
            {context.aspectRatioClass} · attention {context.attentionBudget} ·
            touch {String(context.isTouchInteractive)} · far{" "}
            {String(context.isFarViewing)}
          </p>

          <div style={{ marginBottom: 16 }}>
            <SurfaceStage
              surface={surface}
              elements={layout.elements}
              specById={specById}
              maxWidth={VIEWPORT_MAX.width}
              maxHeight={VIEWPORT_MAX.height}
            />
          </div>

          <DegradationSlider
            baseSurface={surface}
            graph={graph}
            specById={specById}
          />

          <div
            data-testid="phase4-panels"
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
              gap: 24,
              alignItems: "start",
              borderTop: "1px solid #ddd",
              paddingTop: 16,
              marginTop: 16,
            }}
          >
            <LayoutDebugger trace={trace} />
            <LayoutCounterfactuals key={surface.id} trace={trace} />
            <LayoutHealthCheck trace={trace} />
          </div>
        </div>
      )}

      {mode === "sidebyside" && (
        <MultiSurfaceView graph={graph} specById={specById} />
      )}

      {mode === "stress" && <StressLab onInspect={inspectSurface} />}

      {mode === "selfheal" && <SelfHealingDemo />}

      {mode === "naive" && (
        <NaiveVsSmart
          surfaces={options.map((o) => o.surface)}
          graph={graph}
          specById={specById}
        />
      )}

      {mode === "unknown" && (
        <UnknownSurfaceInput graph={graph} specById={specById} />
      )}
    </div>
  );
}
