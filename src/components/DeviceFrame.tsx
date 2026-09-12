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
    return (
      <div className="ale-device ale-device--tv" data-testid="device-frame" data-device="tv">
        <div className="ale-tv-frame">
          <div className="ale-tv-topbar">
            <span className="ale-tv-live">
              <span className="ale-tv-dot" /> LIVE BROADCAST
            </span>
            <span className="ale-tv-tag">
              {surface.width}×{surface.height} · CH 07
            </span>
          </div>
          <div className="ale-tv-screen">{stage}</div>
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
