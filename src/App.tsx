/**
 * Demo hub.
 *
 * A top nav switches between views. Every view resolves layouts through the
 * exact same buildGraph → resolveContext → resolveLayout pipeline and renders
 * through <SurfaceStage>. The explainability panels (Debugger, Counterfactuals,
 * Health Check) sit under the single-surface view.
 *
 *   single     — surface picker + live layout + panels + degradation slider
 *   sidebyside — all 5 sample surfaces resolved at once
 *   stress     — Stress Lab; "inspect" loads a surface back into `single`
 *   selfheal   — combined-failure recovery demo
 *   naive      — naive vs. smart resolver comparison
 *   unknown    — type a brand-new surface and resolve it live
 *
 * Visual styling is in src/styles/theme.css. All data-testid hooks are
 * unchanged.
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
import { DeviceFrame, type DeviceType } from "./components/DeviceFrame";
import { StressLab } from "./components/StressLab";
import { MultiSurfaceView } from "./components/MultiSurfaceView";
import { NaiveVsSmart } from "./components/NaiveVsSmart";
import { DegradationSlider } from "./components/DegradationSlider";
import { UnknownSurfaceInput } from "./components/UnknownSurfaceInput";
import { SelfHealingDemo } from "./components/SelfHealingDemo";

// §7.7: since price/logo were promoted to visibility:"always" (only
// product-image is degradable now), 200×200 no longer drops anything — every
// one of the "4 infos" survives via emergency-fit, and so does the photo.
// 150×150 is the smallest size that still fits all four always-elements at
// their emergency floor while genuinely no longer fitting the photo's own
// declared minSize (96×96) alongside them, so the demo still shows a real
// drop — just the intended one now: the photo goes, the four info pieces stay.
const shrunkKiosk: SurfaceProfile = defineSurface({
  ...surfaceProfiles.retailKiosk,
  id: "retailKioskShrunk",
  name: "Retail kiosk — shrunk 150×150 (degradation demo)",
  width: 150,
  height: 150,
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
  { key: "sidebyside", label: "Side-by-side" },
  { key: "stress", label: "Stress Lab" },
  { key: "selfheal", label: "Self-Healing" },
  { key: "naive", label: "Naive vs Smart" },
  { key: "unknown", label: "Unknown surface" },
];

const VIEWPORT_MAX = { width: 900, height: 620 };

const DEVICE_OPTIONS: { key: DeviceType; label: string }[] = [
  { key: "auto", label: "Auto" },
  { key: "clean", label: "Clean" },
  { key: "phone", label: "Phone" },
  { key: "tv", label: "TV" },
];

export default function App(): JSX.Element {
  const [mode, setMode] = useState<Mode>("single");
  const [selectedKey, setSelectedKey] = useState<string>(BASE_OPTIONS[0]!.key);
  /** Surfaces loaded from the Stress Lab / other views, appended to the picker. */
  const [extraSurfaces, setExtraSurfaces] = useState<SurfaceProfile[]>([]);
  const [deviceType, setDeviceType] = useState<DeviceType>("auto");
  const [showDebug, setShowDebug] = useState(false);

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
    <div className="ale-shell">
      <h1 className="ale-title">
        <span className="spark">Adaptive Layout Engine</span>
      </h1>
      <p className="ale-subtitle">
        One declarative ad spec → a correct, genuinely different layout per
        surface. Experience graph, context engine, candidate generation and
        deterministic scoring — every decision traced in plain language.
      </p>

      <nav className="ale-nav">
        <div className="ale-nav-tabs">
          {MODES.map((m) => (
            <button
              key={m.key}
              type="button"
              className="ale-tab"
              data-testid={`mode-${m.key}`}
              aria-pressed={mode === m.key}
              onClick={() => setMode(m.key)}
            >
              {m.label}
            </button>
          ))}
        </div>
      </nav>

      {mode === "single" && (
        <div className="ale-view" data-testid="single-view">
          <div className="ale-toolbar" style={{ marginBottom: 10 }}>
            <label className="ale-field">
              Surface
              <select
                className="ale-select"
                data-testid="surface-picker"
                name="surface-picker"
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

            <label className="ale-field">
              Device frame
              <select
                className="ale-select"
                data-testid="device-picker"
                name="device-picker"
                value={deviceType}
                onChange={(e) => setDeviceType(e.target.value as DeviceType)}
              >
                {DEVICE_OPTIONS.map((d) => (
                  <option key={d.key} value={d.key}>
                    {d.label}
                  </option>
                ))}
              </select>
            </label>

            <button
              type="button"
              className={`ale-btn${showDebug ? "" : " ale-btn--ghost"}`}
              data-testid="debug-toggle"
              aria-pressed={showDebug}
              title="Overlay safe-area + per-element zone/shrink bounding boxes"
              onClick={() => setShowDebug((prev) => !prev)}
            >
              {showDebug ? "Debug: on" : "Debug: off"}
            </button>
          </div>

          <p className="ale-meta">
            winning strategy{" "}
            <span className="ale-chip ale-chip--accent" data-testid="winning-strategy">
              {trace.winningStrategy}
            </span>{" "}
            <span className="ale-num">
              {visible.length}/{layout.elements.length}
            </span>{" "}
            visible · aspect <b>{context.aspectRatioClass}</b> · attention{" "}
            <b>{context.attentionBudget}</b> · touch{" "}
            <b>{String(context.isTouchInteractive)}</b> · far{" "}
            <b>{String(context.isFarViewing)}</b>
          </p>

          <div className="ale-stage-wrap" style={{ marginBottom: 16 }}>
            <DeviceFrame
              surface={surface}
              elements={layout.elements}
              specById={specById}
              trace={trace}
              showDebug={showDebug}
              deviceType={deviceType}
              maxWidth={VIEWPORT_MAX.width}
              maxHeight={VIEWPORT_MAX.height}
            />
          </div>

          <DegradationSlider
            baseSurface={surface}
            graph={graph}
            specById={specById}
            showDebug={showDebug}
          />

          <div className="ale-panels-grid" data-testid="phase4-panels">
            <LayoutDebugger trace={trace} />
            <LayoutCounterfactuals key={surface.id} trace={trace} />
            <LayoutHealthCheck trace={trace} />
          </div>
        </div>
      )}

      {mode === "sidebyside" && (
        <div className="ale-view">
          <MultiSurfaceView graph={graph} specById={specById} />
        </div>
      )}

      {mode === "stress" && (
        <div className="ale-view">
          <StressLab onInspect={inspectSurface} />
        </div>
      )}

      {mode === "selfheal" && (
        <div className="ale-view">
          <SelfHealingDemo />
        </div>
      )}

      {mode === "naive" && (
        <div className="ale-view">
          <NaiveVsSmart
            surfaces={options.map((o) => o.surface)}
            graph={graph}
            specById={specById}
          />
        </div>
      )}

      {mode === "unknown" && (
        <div className="ale-view">
          <UnknownSurfaceInput graph={graph} specById={specById} />
        </div>
      )}
    </div>
  );
}
