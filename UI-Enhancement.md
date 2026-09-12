# Master Prompt: Port 3 Features into My Layout Engine Project

I'm working on a constraint-based adaptive layout engine (an ad-layout resolver that takes a spec + surface profile and produces a `ResolvedLayout` of placed/dropped elements, rendered via a React component). I want you to port three specific features from a reference implementation into **my** project, adapting them to match my existing file structure, naming conventions, and type definitions rather than copy-pasting blindly. Below I describe each feature's exact behavior and give you the reference source code as ground truth for what it should look and act like. Read my current codebase first, then implement each feature so it feels native to it.

The reference project uses these core types — map them to whatever my project's equivalents are called:

```ts
interface ElementRect { x: number; y: number; width: number; height: number; }

interface ResolvedElement {
  id: string;
  visible: true;
  rect: ElementRect;
  fontSize?: number;
  scaleFactor: number;      // 1.0 = natural size, < 1.0 = shrunk
  isShrunk: boolean;
  zone: LayoutZone;         // "top" | "middle" | "bottom" | "left" | "right" | "center" | "top-left" | "top-right" | "bottom-left" | "bottom-right" | "full"
  element: AdElement;
}

interface DroppedElement { id: string; visible: false; reason: string; element: AdElement; }

interface ResolvedLayout {
  surface: SurfaceProfile;      // { width, height, safeArea?: {top,right,bottom,left}, icon, name, ... }
  contentRect: ElementRect;
  flowStrategy: "column" | "row" | "grid" | "broadcast-strip";
  elements: (ResolvedElement | DroppedElement)[];
  placed: ResolvedElement[];
  dropped: DroppedElement[];
  warnings: string[];
  aspectRatio: number;
}
```

If my project's resolver output shape differs, translate the logic below to whatever the equivalent fields are — the important thing is the *behavior*, not the exact property names.

---

## Feature 1 — "Fluid Stress Test" Button

**What it does:** A toggle button that, when activated, continuously and automatically animates the canvas surface's width and height back and forth through a wide range of aspect ratios (portrait ↔ ultrawide ↔ square) using smooth sine/cosine oscillation, in real time, so you can visually watch the layout engine re-resolve and adapt on every single frame without touching the mouse. It's a way to "stress test" the resolver against continuously changing dimensions instead of just discrete presets. It lives inside the interactive resize/canvas component, next to the manual drag-to-resize handles.

**Exact behavior to replicate:**
- A boolean state `isStressTesting` (default `false`).
- When `true`, a `requestAnimationFrame` loop runs, computing new width/height every frame from elapsed time using this formula (numbers are placeholder defaults — tune to whatever base dimensions make sense for my canvas):
  ```ts
  const elapsed = (timestamp - startTime) / 1000;
  const w = Math.round(620 + 380 * Math.sin(elapsed * 0.9));
  const h = Math.round(480 + 320 * Math.cos(elapsed * 0.7));
  onDimensionsChange(w, h);
  ```
  The two different frequencies (0.9 and 0.7) and the phase offset between sin/cos are what make the aspect ratio sweep through wildly different shapes rather than just scaling uniformly — keep that asymmetry.
- Toggling the button flips `isStressTesting`; turning it off cancels the animation frame (`cancelAnimationFrame`) and cleans up on unmount / dependency change.
- Starting a **manual drag** on any resize handle automatically stops the stress test (they're mutually exclusive) — same for clicking any quick-ratio preset button.
- The button's label and icon swap based on state: `▶ Fluid Stress Test` when idle → `⏹ Stop Stress Test` when running.
- While running, the button gets a distinct "active/alarm" visual treatment (color shift + a soft pulsing glow animation) so it's unmistakable that an automated process is running.

**Reference implementation (`InteractiveResizer.tsx`, relevant slice):**
```tsx
const [isStressTesting, setIsStressTesting] = useState(false);
const animFrameRef = useRef<number | null>(null);
const startTimeRef = useRef<number>(0);

useEffect(() => {
  if (!isStressTesting) {
    if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    return;
  }
  startTimeRef.current = performance.now();
  const loop = (timestamp: number) => {
    const elapsed = (timestamp - startTimeRef.current) / 1000;
    const w = Math.round(620 + 380 * Math.sin(elapsed * 0.9));
    const h = Math.round(480 + 320 * Math.cos(elapsed * 0.7));
    onChange(w, h);
    animFrameRef.current = requestAnimationFrame(loop);
  };
  animFrameRef.current = requestAnimationFrame(loop);
  return () => { if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current); };
}, [isStressTesting, onChange]);

const toggleStressTest = () => setIsStressTesting(prev => !prev);

// In handleMouseDown for any drag handle, and in applyPreset:
if (isStressTesting) setIsStressTesting(false);
```

```tsx
<button
  className={`stress-test-btn ${isStressTesting ? "stress-active" : ""}`}
  onClick={toggleStressTest}
  title="Auto-animate surface dimensions to continuously test layout adaptation"
>
  <span className="stress-icon">{isStressTesting ? "⏹" : "▶"}</span>
  <span>{isStressTesting ? "Stop Stress Test" : "Fluid Stress Test"}</span>
</button>
```

**Reference CSS:**
```css
.stress-test-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  background: rgba(245, 158, 11, 0.12);
  border: 1px solid rgba(245, 158, 11, 0.4);
  color: #fbbf24;
  font-size: 0.74rem;
  font-weight: 700;
  padding: 5px 11px;
  border-radius: 5px;
  cursor: pointer;
  transition: all 0.22s cubic-bezier(0.16, 1, 0.3, 1);
}
.stress-test-btn:hover { background: rgba(245, 158, 11, 0.22); }

.stress-active {
  background: rgba(244, 63, 94, 0.2);
  border-color: rgba(244, 63, 94, 0.6);
  color: #fda4af;
  animation: pulseStress 1.2s infinite;
}
@keyframes pulseStress {
  0%, 100% { box-shadow: 0 0 0 0 rgba(244, 63, 94, 0.4); }
  50% { box-shadow: 0 0 16px 2px rgba(244, 63, 94, 0.5); }
}
```

**Implementation notes for my project:**
- Wire `onChange`/`onDimensionsChange` to whatever function already updates my active surface's width/height (the same one my manual drag handles or dimension inputs call).
- Optional nice-to-have from the reference (skip if I don't have a sound system): it plays a short "switch" click sound on toggle via a `sound.playSwitch()` call — only add this if my project already has an audio-feedback utility.
- Place the button in the same toolbar/HUD as my resolution readout (width×height, aspect ratio, current flow-strategy badge) if I have one — it reads naturally next to those stats.

---

## Feature 2 — Device Outer Frame Components (`device-phone-outer`, `device-tv-outer`, `device-clean-outer`)

**What it does:** Instead of just rendering the resolved ad as a bare rectangle, it wraps the rendered layout in a realistic device "chassis" — a phone bezel, a broadcast TV frame, or a clean minimal studio frame — so the preview reads as "this is what it actually looks like on a real screen" rather than a raw div. Which chassis is used can be picked manually via a dropdown, or resolved automatically from the surface's aspect ratio when set to "Auto."

**Component contract:**
```tsx
export type DeviceType = "auto" | "clean" | "phone" | "tv" | "kiosk"; // include "kiosk" only if useful to me — otherwise phone/tv/clean is enough

interface DeviceFrameProps {
  layout: ResolvedLayout;   // whatever my resolved-layout type is called
  showDebug: boolean;       // passed through to the inner renderer for the bounding-box overlay (Feature 3)
  deviceType: DeviceType;
  scale?: number;           // 1 = 100%; scales the inner rendered surface before adding chassis chrome
}
```

**Auto-detection logic (aspect-ratio-driven, never a lookup by surface name/id):**
```ts
const ar = surfaceWidth / surfaceHeight;
const effectiveDevice =
  deviceType === "auto"
    ? ar < 0.8 ? "phone" : ar > 2.5 ? "tv" : "clean"   // add kiosk in the 0.85–1.15 square band if I want it
    : deviceType;
```

### `device-phone-outer`
A dark bezel chassis around the screen, styled like a modern smartphone:
- Rounded chassis (`border-radius: 46px`), dark gradient background (`linear-gradient(135deg, #27272a, #09090b)`), heavy outer drop shadow plus a thin light inner ring so it reads as a physical object, not a flat rectangle.
- A **Dynamic Island**-style pill near the top center: small black rounded pill containing a tiny camera dot and a sensor dot, absolutely positioned, sits *above* the rendered ad content (z-index above it).
- The actual ad renders inside a `phone-screen` div with its own rounded corners (slightly smaller radius than the outer chassis) and `overflow: hidden`.
- A **home indicator** bar: a thin rounded white/translucent bar near the bottom, absolutely positioned, again above the content.
- Outer wrapper is sized to the scaled content plus fixed bezel padding (reference uses `scaledWidth + 28`, `scaledHeight + 34`).

### `device-tv-outer`
A broadcast-monitor chassis:
- Outer flex column: a bordered dark frame (`tv-frame`) containing a **top bar** (small dark strip) with a "● LIVE BROADCAST" pill (red blinking dot + bold red label, dot uses a simple opacity-pulse keyframe) on the left and a channel/resolution tag (e.g. "4K ULTRA HD · CH 07") on the right.
- Below that, the actual ad renders inside a `tv-screen` div.
- Below the screen, a **bottom bezel** strip showing a small brand wordmark on the left and a tiny glowing "power LED" dot (green, with a soft glow via box-shadow) on the right.
- Below the whole frame, a simple **TV stand**: a short gradient bar with rounded bottom corners, centered, narrower than the frame, giving the illusion the screen is resting on a stand.

### `device-clean-outer`
A neutral "studio/browser-window" presentation frame — the fallback/default look, meant to look like a clean app window rather than a specific physical device:
- A bordered rounded panel (`device-clean-outer`) containing a **chrome/title bar** (`clean-chrome`) at the top:
  - Left: three small colored dots (red, yellow, green — like macOS traffic-light window controls), purely decorative.
  - Center/left-of-center: the surface's icon + name + its pixel dimensions (e.g. "🖥️ Square Kiosk · 1080 × 1080px").
  - Right: a small pill badge showing the resolved flow-strategy name in uppercase (e.g. "GRID"), styled as a mono-font tag with an indigo tint.
- Below the chrome bar, the ad renders inside a `clean-screen` div.

**Reference implementation (`DeviceFrame.tsx`), adapt names/props to mine:**
```tsx
export function DeviceFrame({ layout, showDebug, deviceType, scale = 1 }: DeviceFrameProps) {
  const sw = layout.surface.width;
  const sh = layout.surface.height;
  const ar = sw / sh;

  const effectiveDevice: DeviceType = deviceType === "auto"
    ? ar < 0.8 ? "phone" : ar > 2.5 ? "tv" : ar >= 0.85 && ar <= 1.15 ? "kiosk" : "clean"
    : deviceType;

  const adElement = (
    <div style={{ width: sw, height: sh, transform: `scale(${scale})`, transformOrigin: "top left" }}>
      <AdRenderer layout={layout} showDebug={showDebug} />
    </div>
  );

  const scaledW = sw * scale;
  const scaledH = sh * scale;

  if (effectiveDevice === "phone") {
    return (
      <div className="device-phone-outer" style={{ width: scaledW + 28, height: scaledH + 34 }}>
        <div className="phone-chassis">
          <div className="phone-dynamic-island">
            <span className="di-camera" />
            <span className="di-sensor" />
          </div>
          <div className="phone-screen" style={{ width: scaledW, height: scaledH }}>{adElement}</div>
          <div className="phone-home-indicator" />
        </div>
      </div>
    );
  }

  if (effectiveDevice === "tv") {
    return (
      <div className="device-tv-outer" style={{ width: scaledW + 24 }}>
        <div className="tv-frame">
          <div className="tv-top-bar">
            <div className="tv-live-pill"><span className="live-dot" /> LIVE BROADCAST</div>
            <div className="tv-channel-tag">4K ULTRA HD · CH 07</div>
          </div>
          <div className="tv-screen" style={{ width: scaledW, height: scaledH }}>{adElement}</div>
          <div className="tv-bottom-bezel">
            <span className="tv-brand-logo">YOUR BRAND</span>
            <span className="tv-power-led" />
          </div>
        </div>
        <div className="tv-stand" />
      </div>
    );
  }

  // Clean studio frame (default / fallback)
  return (
    <div className="device-clean-outer">
      <div className="clean-chrome">
        <div className="clean-dots">
          <span className="dot-red" /><span className="dot-yellow" /><span className="dot-green" />
        </div>
        <div className="clean-title">
          <span className="clean-icon">{layout.surface.icon}</span>
          <span>{layout.surface.name}</span>
          <span className="clean-dims">{sw} × {sh}px</span>
        </div>
        <div className="clean-strategy-badge">{layout.flowStrategy.toUpperCase()}</div>
      </div>
      <div className="clean-screen" style={{ width: scaledW, height: scaledH }}>{adElement}</div>
    </div>
  );
}
```

**Reference CSS:**
```css
/* Phone */
.device-phone-outer {
  background: linear-gradient(135deg, #27272a, #09090b);
  border-radius: 46px;
  padding: 14px;
  box-shadow: 0 30px 80px rgba(0,0,0,0.9), 0 0 0 2px rgba(255,255,255,0.12), inset 0 0 0 2px rgba(0,0,0,0.8);
  position: relative;
}
.phone-chassis { display: flex; flex-direction: column; align-items: center; position: relative; }
.phone-dynamic-island {
  width: 90px; height: 24px; background: #000; border-radius: 20px;
  position: absolute; top: 6px; z-index: 100;
  display: flex; align-items: center; justify-content: flex-end; padding-right: 14px; gap: 6px;
}
.di-camera { width: 9px; height: 9px; background: #111827; border-radius: 50%; border: 1px solid #1f2937; }
.di-sensor { width: 5px; height: 5px; background: #0c4a6e; border-radius: 50%; }
.phone-screen { border-radius: 34px; overflow: hidden; box-shadow: inset 0 0 0 1px rgba(255,255,255,0.1); position: relative; }
.phone-home-indicator { width: 100px; height: 4px; background: rgba(255,255,255,0.4); border-radius: 3px; position: absolute; bottom: 8px; z-index: 100; }

/* TV */
.device-tv-outer { display: flex; flex-direction: column; align-items: center; }
.tv-frame {
  background: #0a0a0f; border: 4px solid #18181b; border-radius: 10px;
  box-shadow: 0 24px 60px rgba(0,0,0,0.8), 0 0 0 1px rgba(255,255,255,0.08); overflow: hidden;
}
.tv-top-bar { display: flex; align-items: center; justify-content: space-between; padding: 4px 10px; background: #111116; font-size: 0.65rem; font-family: monospace; }
.tv-live-pill { display: flex; align-items: center; gap: 5px; font-weight: 800; color: #f87171; }
.live-dot { width: 6px; height: 6px; border-radius: 50%; background: #ef4444; animation: liveBlink 1s infinite; }
@keyframes liveBlink { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }
.tv-channel-tag { color: #64748b; }
.tv-bottom-bezel { display: flex; align-items: center; justify-content: space-between; padding: 4px 12px; background: #0f0f14; font-size: 0.6rem; font-weight: 700; letter-spacing: 0.1em; color: #64748b; }
.tv-power-led { width: 4px; height: 4px; border-radius: 50%; background: #10b981; box-shadow: 0 0 6px #10b981; }
.tv-stand { width: 140px; height: 10px; background: linear-gradient(180deg, #27272a, #09090b); border-radius: 0 0 8px 8px; }

/* Clean */
.device-clean-outer { background: #090c1a; border: 1px solid rgba(255,255,255,0.08); border-radius: 12px; box-shadow: 0 24px 60px -12px rgba(0,0,0,0.8); overflow: hidden; }
.clean-chrome { display: flex; align-items: center; justify-content: space-between; padding: 8px 12px; background: rgba(255,255,255,0.03); border-bottom: 1px solid rgba(255,255,255,0.08); font-size: 0.72rem; }
.clean-dots { display: flex; gap: 5px; }
.dot-red, .dot-yellow, .dot-green { width: 8px; height: 8px; border-radius: 50%; }
.dot-red { background: #f87171; } .dot-yellow { background: #fbbf24; } .dot-green { background: #4ade80; }
.clean-title { display: flex; align-items: center; gap: 6px; font-weight: 600; color: #fff; }
.clean-dims { font-family: monospace; color: #64748b; font-size: 0.68rem; }
.clean-strategy-badge { font-family: monospace; font-size: 0.65rem; font-weight: 800; padding: 2px 6px; border-radius: 4px; background: rgba(99,102,241,0.18); color: #a5b4fc; }
```

**Implementation notes for my project:**
- If I already have a single "preview surface" component that renders the resolved layout, `DeviceFrame` should wrap it (pass it through as `adElement`), not replace it — it's purely presentational chrome around the existing renderer.
- Keep the outer wrapper's extra padding/margin (the `+28`, `+34`, `+24` px in the reference) so the chassis chrome doesn't get clipped or overlap the scaled content — adjust the exact numbers to match my own bezel thickness.
- If my project doesn't have a device-type selector yet, add a simple `<select>` with options for Auto / Phone / TV / Clean (and Kiosk if I build it) next to wherever the surface picker lives.

---

## Feature 3 — Bounding Box Debug Overlay

**What it does:** A toggleable overlay drawn on top of the rendered ad that visualizes the layout engine's internal geometry for debugging: a dashed outline around the safe-area/content rectangle, and a colored, labeled bounding box around every *placed* element showing exactly where the resolver put it. Boxes are tinted by which layout zone the element was assigned to (so you can visually see the grid quadrants / column bands / row split at a glance), and any element the resolver had to shrink to fit gets a distinctly colored border plus a percentage badge, so shrunk-vs-natural-size elements are visually obvious without reading numbers.

**Exact behavior to replicate:**
- Renders as an absolutely-positioned overlay sitting on top of the actual ad content (not replacing it) — only mounted when a `showDebug` boolean prop is `true`.
- One dashed-border box for the content/safe-area rectangle (the usable area after safe-area insets are subtracted from the full surface).
- One box per **placed** element (skip dropped elements — they aren't on screen to outline), positioned/sized exactly at that element's resolved `rect`.
- Each box's fill/tint color is looked up from its `zone` (a small color map keyed by zone name — different pastel-alpha colors per zone so quadrants/bands are visually distinguishable).
- Box border color: a different color for elements that were shrunk (`isShrunk === true`) vs. elements at natural size — shrunk = warning color (amber/yellow), natural = success color (green). This is the fastest way to eyeball "which elements did the resolver have to compromise on."
- A small monospace label chip pinned to the top-left corner of each box, dark semi-transparent background, showing: the element's id, and if shrunk, `⚠ {round(scaleFactor*100)}%`, and if it has a resolved font size, `{round(fontSize)}px`. Example label text: `headline ⚠72% 18px`.
- All debug elements have `pointer-events: none` so they never block interaction with the real ad underneath, and sit at a high `z-index` above the actual content.

**Reference implementation (`render-dom.tsx`), adapt to my renderer:**
```tsx
const ZONE_COLORS: Record<string, string> = {
  "top-left":     "rgba(248,113,113,0.12)",
  "top-right":    "rgba(96,165,250,0.12)",
  "bottom-left":  "rgba(74,222,128,0.12)",
  "bottom-right": "rgba(251,191,36,0.12)",
  top:            "rgba(248,113,113,0.08)",
  middle:         "rgba(167,139,250,0.08)",
  bottom:         "rgba(74,222,128,0.08)",
  left:           "rgba(251,146,60,0.12)",
  right:          "rgba(96,165,250,0.12)",
  center:         "rgba(251,191,36,0.08)",
  full:           "rgba(255,255,255,0.04)",
};

function DebugOverlay({ layout }: { layout: ResolvedLayout }) {
  return (
    <>
      {/* Safe area / content rect */}
      <div
        style={{
          position: "absolute",
          left: layout.surface.safeArea?.left ?? 0,
          top: layout.surface.safeArea?.top ?? 0,
          width: layout.contentRect.width,
          height: layout.contentRect.height,
          border: "1px dashed rgba(96,165,250,0.5)",
          pointerEvents: "none",
          zIndex: 100,
          boxSizing: "border-box",
        }}
      />
      {layout.placed.map((p) => (
        <div
          key={`dbg-${p.id}`}
          style={{
            position: "absolute",
            left: p.rect.x,
            top: p.rect.y,
            width: p.rect.width,
            height: p.rect.height,
            background: ZONE_COLORS[p.zone] ?? "rgba(255,255,255,0.04)",
            border: `1px solid ${p.isShrunk ? "rgba(251,191,36,0.7)" : "rgba(74,222,128,0.5)"}`,
            boxSizing: "border-box",
            pointerEvents: "none",
            zIndex: 101,
          }}
        >
          <span
            style={{
              position: "absolute", top: 2, left: 3,
              fontSize: 8, fontFamily: "monospace",
              color: "rgba(255,255,255,0.9)",
              background: "rgba(0,0,0,0.7)",
              padding: "1px 3px", borderRadius: 2,
              lineHeight: 1.4, whiteSpace: "nowrap", userSelect: "none",
            }}
          >
            {p.id}
            {p.isShrunk ? ` ⚠${Math.round(p.scaleFactor * 100)}%` : ""}
            {p.fontSize ? ` ${Math.round(p.fontSize)}px` : ""}
          </span>
        </div>
      ))}
    </>
  );
}

// Mounted at the end of the main render tree, conditionally:
{showDebug && <DebugOverlay layout={layout} />}
```

**Implementation notes for my project:**
- Wire this into whatever component currently renders the resolved layout to a `<div>` tree — it should be the very last child so it paints on top of everything, and should share the exact same coordinate space (same parent with `position: relative`, same width/height as the surface) as the real rendered elements, otherwise the boxes will misalign.
- If my layout type doesn't have a `zone` field per element, either add one when a strategy places elements, or simplify the overlay to a single uniform box color and skip the zone-tinting — the id/shrink/font-size label and the safe-area outline are the more important parts of the feature.
- Expose the toggle as a single boolean (e.g. a "Debug" button in my toolbar) that's already probably needed elsewhere (many layout tools have this) — reuse an existing debug flag if my project has one rather than adding a second one.
- This pairs naturally with Feature 2 (`DeviceFrame`) — the debug overlay should render *inside* whichever device chassis is active, at the same scale, so bounding boxes line up with the phone/TV/clean screen viewport exactly like they do with the bare renderer.

---

## Shared visual language (for consistency, optional)

If it's helpful for matching the reference's look while integrating these, its dark theme tokens were:
```css
--bg: #060813; --panel: rgba(14,18,36,0.7); --border: rgba(255,255,255,0.08);
--text-1: #f8fafc; --text-2: #94a3b8; --text-3: #64748b;
--indigo: #6366f1; --emerald: #10b981; --amber: #f59e0b; --rose: #f43f5e;
--font: 'Plus Jakarta Sans', system-ui, sans-serif; --mono: 'JetBrains Mono', monospace;
--radius-lg: 18px; --radius-md: 12px; --radius-sm: 8px; --radius-xs: 5px;
--shadow-luxe: 0 24px 60px -12px rgba(0,0,0,0.8), 0 0 1px 1px rgba(255,255,255,0.06);
```
Use my own design tokens if my project already has a theme system — don't force this palette in if it clashes.

---

## What I want from you

1. Look at my current project structure first (component boundaries, how the resolved layout is typed, how the current preview/canvas is rendered, whether I already have a debug toggle or device-frame concept).
2. Implement Feature 1 (Fluid Stress Test), Feature 2 (Phone/TV/Clean device frames with Auto-detection), and Feature 3 (bounding-box debug overlay), adapting names, types, and CSS to fit my codebase's existing conventions rather than dropping the reference code in verbatim.
3. Keep the three features independent and composable — the debug overlay should work whether or not a device frame is active, and the stress test should work regardless of which device frame is selected.
4. After implementing, do a quick pass to confirm: toggling stress test on/off doesn't leave a dangling animation frame running after unmount; switching device type mid-stress-test doesn't break anything; and the debug overlay boxes are pixel-aligned with the real rendered elements at every scale factor, not just 100%.