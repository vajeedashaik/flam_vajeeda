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

import { useEffect, useMemo, useState } from "react";
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
  { key: "sidebyside", label: "Side-by-side" },
  { key: "stress", label: "Stress Lab" },
  { key: "selfheal", label: "Self-Healing" },
  { key: "naive", label: "Naive vs Smart" },
  { key: "unknown", label: "Unknown surface" },
];

const VIEWPORT_MAX = { width: 900, height: 620 };

type ThemeChoice = "system" | "light" | "dark";

function readTheme(): ThemeChoice {
  try {
    const t = localStorage.getItem("ale-theme");
    if (t === "light" || t === "dark") return t;
  } catch {
    /* ignore */
  }
  return "system";
}

export default function App(): JSX.Element {
  const [mode, setMode] = useState<Mode>("single");
  const [selectedKey, setSelectedKey] = useState<string>(BASE_OPTIONS[0]!.key);
  /** Surfaces loaded from the Stress Lab / other views, appended to the picker. */
  const [extraSurfaces, setExtraSurfaces] = useState<SurfaceProfile[]>([]);
  const [theme, setTheme] = useState<ThemeChoice>(readTheme);

  useEffect(() => {
    const root = document.documentElement;
    try {
      if (theme === "system") {
        root.removeAttribute("data-theme");
        localStorage.removeItem("ale-theme");
      } else {
        root.setAttribute("data-theme", theme);
        localStorage.setItem("ale-theme", theme);
      }
    } catch {
      if (theme === "system") root.removeAttribute("data-theme");
      else root.setAttribute("data-theme", theme);
    }
  }, [theme]);

  function cycleTheme(): void {
    setTheme((t) => (t === "system" ? "light" : t === "light" ? "dark" : "system"));
  }

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
  const themeIcon = theme === "system" ? "🌗" : theme === "light" ? "☀️" : "🌙";

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
        <button
          type="button"
          className="ale-icon-btn"
          data-testid="theme-toggle"
          aria-label={`Theme: ${theme}. Click to change.`}
          title={`Theme: ${theme}`}
          onClick={cycleTheme}
        >
          {themeIcon}
        </button>
      </nav>

      {mode === "single" && (
        <div className="ale-view" data-testid="single-view">
          <label className="ale-field" style={{ marginBottom: 10 }}>
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
