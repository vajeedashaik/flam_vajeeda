/**
 * Device frame — wraps SurfaceStage in a realistic device chassis (phone
 * bezel, broadcast-monitor frame, or a clean studio/browser-window frame) so
 * the preview reads as "what this looks like on a real screen" instead of a
 * bare rectangle.
 *
 * Purely presentational: it does not touch resolution logic, does not
 * re-implement scaling (SurfaceStage still owns that), and does not replace
 * SurfaceStage — it wraps it, exactly like the lightweight `frame` prop on
 * SurfaceStage already does for the side-by-side view, just with real chassis
 * chrome instead of a plain gradient border.
 */

import type { AdElement } from "../core/spec";
import type { ResolvedElement } from "../core/resolver";
import type { SurfaceProfile } from "../core/surfaces";
import type { DecisionTrace } from "../core/trace";
import { SurfaceStage } from "./SurfaceStage";

export type DeviceType = "auto" | "clean" | "phone" | "tv";

export interface DeviceFrameProps {
  surface: SurfaceProfile;
  elements: ResolvedElement[];
  specById?: Map<string, AdElement> | undefined;
  trace?: DecisionTrace | undefined;
  showDebug?: boolean;
  deviceType: DeviceType;
  maxWidth?: number;
  maxHeight?: number;
}

/** width/height below this ratio reads as a phone; above this reads as a wide broadcast/TV strip. */
const PHONE_MAX_RATIO = 0.8;
const TV_MIN_RATIO = 2.5;

/**
 * A real TV is physically wider than it is tall — this is the floor on that
 * shape for the chassis itself, independent of the surface's own aspect
 * ratio. Without it, forcing "TV" onto a portrait surface (or "Auto" ever
 * mis-classifying one) shrink-wraps the whole chassis to the content's own
 * narrow width, producing a tall black column that reads as broken, not as a
 * television. Real content narrower than this gets pillarboxed — centred on a
 * dark screen background with letterbox bars on either side — exactly how a
 * real TV shows a non-native-aspect source, rather than distorting the
 * chassis into a shape no TV has ever had.
 *
 * Deliberately modest (not a strict 16:9) — the goal is "unmistakably
 * landscape," not "exactly broadcast spec." A stricter ratio forces more
 * pillarboxing for the exact same portrait content, which looks worse, not
 * more accurate, for a demo whose job is showing the AD, not simulating a
 * real television's letterbox behaviour.
 */
const MIN_TV_ASPECT = 1.35;

/** Height reserved for the top/bottom chrome bars, so the WHOLE device
 *  (bars included) fits the caller's maxHeight budget, not just the screen. */
const TV_CHROME_HEIGHT = 46;

/** Auto-detection is aspect-ratio-driven only — never a lookup by surface id/name. */
function effectiveDeviceFor(
  deviceType: DeviceType,
  surface: SurfaceProfile,
): Exclude<DeviceType, "auto"> {
  if (deviceType !== "auto") return deviceType;
  const ratio = surface.width / surface.height;
  if (ratio < PHONE_MAX_RATIO) return "phone";
  if (ratio > TV_MIN_RATIO) return "tv";
  return "clean";
}

export function DeviceFrame({
  surface,
  elements,
  specById,
  trace,
  showDebug = false,
  deviceType,
  maxWidth = 420,
  maxHeight = 620,
}: DeviceFrameProps): JSX.Element {
  const effective = effectiveDeviceFor(deviceType, surface);

  const stage = (
    <SurfaceStage
      surface={surface}
      elements={elements}
      specById={specById}
      trace={trace}
      showDebug={showDebug}
      maxWidth={maxWidth}
      maxHeight={maxHeight}
    />
  );

  if (effective === "phone") {
    return (
      <div className="ale-device ale-device--phone" data-testid="device-frame" data-device="phone">
        <div className="ale-phone-chassis">
          <div className="ale-phone-island">
            <span className="ale-phone-cam" />
            <span className="ale-phone-sensor" />
          </div>
          <div className="ale-phone-screen">{stage}</div>
          <div className="ale-phone-home" />
        </div>
      </div>
    );
  }

  if (effective === "tv") {
    // The whole chassis — not just the screen — must fit the caller's
    // maxWidth × maxHeight budget. Deriving chassis width from the surface's
    // OWN scaled height (the previous approach) let a tall portrait surface
    // balloon the chassis width far past that budget while still showing
    // almost nothing but pillarbox: a 390×844 phone at maxHeight 620 scales to
    // ~620px tall, and 620 × 16:9 alone is already 1100px wide — well beyond
    // any reasonable layout. Instead: first fit a landscape BOX (at least
    // MIN_TV_ASPECT, wider if the surface itself is already wider) inside the
    // ORIGINAL budget — reserving room for the chrome bars — then fit the
    // real surface inside THAT box. The chassis never exceeds what was asked
    // for; only the screen-vs-pillarbox split inside it varies with content.
    const screenBudgetH = Math.max(60, maxHeight - TV_CHROME_HEIGHT);
    const targetAspect = Math.max(MIN_TV_ASPECT, surface.width / surface.height);

    let chassisW = maxWidth;
    let screenH = chassisW / targetAspect;
    if (screenH > screenBudgetH) {
      screenH = screenBudgetH;
      chassisW = screenH * targetAspect;
    }

    const contentScale = Math.min(1, chassisW / surface.width, screenH / surface.height);
    const isPillarboxed = contentScale * surface.width < chassisW - 0.5;

    return (
      <div className="ale-device ale-device--tv" data-testid="device-frame" data-device="tv">
        <div className="ale-tv-frame" style={{ width: chassisW }}>
          <div className="ale-tv-topbar">
            <span className="ale-tv-live">
              <span className="ale-tv-dot" /> LIVE BROADCAST
            </span>
            <span className="ale-tv-tag">
              {isPillarboxed
                ? `${surface.width}×${surface.height} pillarboxed — portrait content on a landscape TV`
                : `${surface.width}×${surface.height} · CH 07`}
            </span>
          </div>
          <div
            className="ale-tv-screen"
            data-testid="tv-screen"
            data-pillarboxed={isPillarboxed}
            style={{ width: chassisW, height: screenH, justifyContent: "center", alignItems: "center" }}
          >
            <SurfaceStage
              surface={surface}
              elements={elements}
              specById={specById}
              trace={trace}
              showDebug={showDebug}
              maxWidth={chassisW}
              maxHeight={screenH}
            />
          </div>
          <div className="ale-tv-bottombar">
            <span className="ale-tv-brand">ADAPTIVE LAYOUT ENGINE</span>
            <span className="ale-tv-led" />
          </div>
        </div>
        <div className="ale-tv-stand" />
      </div>
    );
  }

  return (
    <div className="ale-device ale-device--clean" data-testid="device-frame" data-device="clean">
      <div className="ale-clean-chrome">
        <div className="ale-clean-dots">
          <span className="ale-dot ale-dot--red" />
          <span className="ale-dot ale-dot--yellow" />
          <span className="ale-dot ale-dot--green" />
        </div>
        <div className="ale-clean-title">
          <span>{surface.name ?? surface.id}</span>
          <span className="ale-clean-dims">
            {surface.width} × {surface.height}px
          </span>
        </div>
        {trace && (
          <span className="ale-clean-strategy">{trace.winningStrategy.toUpperCase()}</span>
        )}
      </div>
      <div className="ale-clean-screen">{stage}</div>
    </div>
  );
}
