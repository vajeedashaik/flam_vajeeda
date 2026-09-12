/**
 * Stress Lab.
 *
 * Randomly generates a large batch of surface profiles across a wide range of
 * dimensions and constraint combinations, runs the REAL pipeline
 * (buildGraph → resolveContext → resolveLayout) against each, and classifies
 * every outcome into one of three tiers:
 *
 *   "failed"   — a hard invariant was broken end-to-end (overlap between two
 *                visible elements, or a visible element clipped off the
 *                surface). Phase 3's scoring hard-fail rule is supposed to make
 *                this structurally impossible; this module verifies that claim
 *                at scale instead of trusting it.
 *   "degraded" — resolved cleanly (no invariant violation) but the winning
 *                candidate's overall score came in below DEGRADED_SCORE_THRESHOLD.
 *   "passed"   — no invariant violation and overall score at or above threshold.
 *
 * Nothing here branches on a specific surface id: generation is parameterised by
 * numeric ranges only, and evaluation goes through the same resolveLayout() call
 * every other surface uses.
 */

import { boxesOverlap } from "./candidates";
import { resolveContext } from "./context";
import { buildGraph } from "./graph";
import { resolveLayout } from "./resolver";
import type { ResolvedElement } from "./resolver";
import type { AdSpec } from "./spec";
import {
  defineSurface,
  type SurfaceConfig,
  type SurfaceProfile,
  type ViewingDistance,
} from "./surfaces";

/**
 * Overall-score cut-off between "passed" and "degraded". Documented and fixed
 * here so the StressLab UI and the tests agree. 70 chosen deliberately: Phase
 * 3's weighted score lands most well-fitting layouts in the 80s–90s, so a
 * result under 70 means the resolver had to shrink or drop enough content that
 * a human reviewer would notice — worth surfacing, without flagging every
 * merely-tight layout.
 */
export const DEGRADED_SCORE_THRESHOLD = 70;

export type StressOutcome = "passed" | "degraded" | "failed";

export interface StressDetail {
  surface: SurfaceProfile;
  outcome: StressOutcome;
  /** Winning candidate's overall score (0-100). */
  overallScore: number;
  /** How many of the spec's elements survived in the winning candidate. */
  visibleCount: number;
  /** Total elements in the spec (visible or dropped). */
  elementCount: number;
  /** Present for degraded/failed entries — why it landed in that tier. */
  reason?: string;
}

/**
 * WHY a degraded/failed entry landed there — computed purely from data
 * `runStressTest` already produces, so it never needs to know this spec's
 * specific element ids/roles (matches every other file's "no hardcoded ids"
 * rule). See `CATEGORY_META` for the plain-language explanation of each.
 */
export type ProblemCategory =
  | "invariant-violation"
  | "nothing-fits"
  | "always-element-dropped"
  | "quality-floor";

export function categorizeStressDetail(
  detail: StressDetail,
): ProblemCategory | null {
  if (detail.outcome === "passed") return null;
  if (detail.outcome === "failed") return "invariant-violation";
  if (detail.visibleCount === 0) return "nothing-fits";
  if (detail.overallScore === 0) return "always-element-dropped";
  return "quality-floor";
}

const CATEGORY_META: Record<
  ProblemCategory,
  { label: string; explanation: string }
> = {
  "invariant-violation": {
    label: "Hard invariant actually broken",
    explanation:
      "An element genuinely overlapped another or was clipped off-surface end-to-end — this is supposed to be structurally impossible (every strategy's shared placement engine re-checks both invariants before accepting a placement). A non-zero count here means that guarantee has a real hole worth investigating immediately, not a tuning issue.",
  },
  "nothing-fits": {
    label: "Nothing fits at all",
    explanation:
      "Not even the single highest-priority element could be placed by any strategy — some axis of the surface is smaller than what the ad's own declared minimum sizes require, so every element cascades to dropped, always-visible ones included. Scoring this 0 is correct: there is no valid layout to prefer over another, so the pipeline should not pretend one exists.",
  },
  "always-element-dropped": {
    label: "A must-keep element had to be dropped",
    explanation:
      'At least one element fit, but the surface was too small to also keep every element the spec marks visibility:"always" — the resolver refuses to call that combination valid, scoring it 0 rather than quietly shipping an ad missing something the spec said must survive.',
  },
  "quality-floor": {
    label: "Valid, but a real quality ceiling",
    explanation:
      "A genuinely valid, non-overlapping, in-bounds layout was produced with every must-keep element intact — it is simply sparse. On a surface this constrained, keeping only a couple of the five elements is the honest best available composition; the low score reflects that accurately instead of overstating it.",
  },
};

export interface ProblemSummary {
  category: ProblemCategory;
  count: number;
  label: string;
  explanation: string;
}

/** Buckets every degraded/failed entry into why it landed there, most-common first. */
export function summarizeProblems(details: StressDetail[]): ProblemSummary[] {
  const counts = new Map<ProblemCategory, number>();
  for (const d of details) {
    const cat = categorizeStressDetail(d);
    if (cat === null) continue;
    counts.set(cat, (counts.get(cat) ?? 0) + 1);
  }
  return (Object.keys(CATEGORY_META) as ProblemCategory[])
    .map((category) => ({
      category,
      count: counts.get(category) ?? 0,
      ...CATEGORY_META[category],
    }))
    .filter((s) => s.count > 0)
    .sort((a, b) => b.count - a.count);
}

export interface StressResult {
  total: number;
  passed: number;
  degraded: number;
  failed: number;
  details: StressDetail[];
}

/** A 0-1 random source. Injectable so tests can run deterministically. */
export type Rng = () => number;

/** Small seeded PRNG (mulberry32) — used to make stress runs reproducible. */
export function seededRng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randInt(rng: Rng, min: number, max: number): number {
  return Math.floor(rng() * (max - min + 1)) + min;
}

function pick<T>(rng: Rng, options: readonly T[]): T {
  return options[Math.floor(rng() * options.length)]!;
}

/**
 * Dimension presets that push the resolver into corners: extreme aspect
 * ratios, tiny canvases, oversized canvases. Mixed in with fully-random
 * dimensions so both the edges and the middle of the space get exercised.
 */
const EXTREME_DIMENSIONS: ReadonlyArray<readonly [number, number]> = [
  [100, 600],
  [3840, 400],
  [200, 200],
  [3840, 2160],
  [320, 50],
  [120, 2000],
  [2400, 180],
];

/**
 * Generate `count` randomized, VALID surface profiles.
 *
 * Every returned profile has already passed defineSurface(), so cross-field
 * rules (notably: touchOnly requires a minTapTarget) are respected during
 * generation — callers never see a throw.
 */
export function generateRandomSurfaces(
  count: number,
  rng: Rng = Math.random,
): SurfaceProfile[] {
  const surfaces: SurfaceProfile[] = [];

  for (let i = 0; i < count; i++) {
    let width: number;
    let height: number;
    if (rng() < 0.25) {
      [width, height] = pick(rng, EXTREME_DIMENSIONS);
    } else {
      width = randInt(rng, 100, 3840);
      height = randInt(rng, 120, 2400);
    }

    const touchOnly = rng() < 0.5;
    // touchOnly => must carry a minTapTarget (Phase 1 cross-field rule).
    const includeTapTarget = touchOnly || rng() < 0.5;
    const minTapTarget = includeTapTarget ? randInt(rng, 24, 96) : undefined;

    const viewingDistance = pick<ViewingDistance | undefined>(rng, [
      "near",
      "far",
      randInt(rng, 30, 400),
      undefined,
    ]);
    const attentionWindow = rng() < 0.7 ? randInt(rng, 1, 60) : undefined;

    const config: SurfaceConfig = {
      id: `stress-${i}`,
      name: `Stress #${i} — ${width}×${height}`,
      width,
      height,
    };
    if (minTapTarget !== undefined) config.minTapTarget = minTapTarget;
    if (touchOnly) config.touchOnly = true;
    if (viewingDistance !== undefined) config.viewingDistance = viewingDistance;
    if (attentionWindow !== undefined) config.attentionWindow = attentionWindow;

    surfaces.push(defineSurface(config));
  }

  return surfaces;
}

const BOUNDS_EPS = 0.5;

/**
 * End-to-end hard-invariant check on the actual resolved output — deliberately
 * independent of scoring.ts so it is a real cross-check, not the same code
 * asserting about itself. Returns a human-readable reason string on the first
 * violation found, or undefined when the layout is clean.
 */
function findInvariantViolation(
  visible: ResolvedElement[],
  surface: SurfaceProfile,
): string | undefined {
  for (const e of visible) {
    if (
      e.x < -BOUNDS_EPS ||
      e.y < -BOUNDS_EPS ||
      e.x + e.width > surface.width + BOUNDS_EPS ||
      e.y + e.height > surface.height + BOUNDS_EPS
    ) {
      return (
        `${e.id} clipped off-surface: ` +
        `${Math.round(e.x)},${Math.round(e.y)} ${Math.round(e.width)}×${Math.round(
          e.height,
        )} on a ${surface.width}×${surface.height} surface`
      );
    }
  }

  for (let i = 0; i < visible.length; i++) {
    for (let j = i + 1; j < visible.length; j++) {
      if (boxesOverlap(visible[i]!, visible[j]!)) {
        return `${visible[i]!.id} overlaps ${visible[j]!.id}`;
      }
    }
  }

  return undefined;
}

function winningOverall(trace: {
  winningStrategy: string;
  candidateScores: { strategy: string; score: { overall: number } }[];
}): number {
  const winner = trace.candidateScores.find(
    (c) => c.strategy === trace.winningStrategy,
  );
  return winner?.score.overall ?? 0;
}

/**
 * Run the full pipeline against every surface and tier each outcome.
 */
export function runStressTest(
  spec: AdSpec,
  surfaces: SurfaceProfile[],
): StressResult {
  const graph = buildGraph(spec);

  const details: StressDetail[] = surfaces.map((surface) => {
    const context = resolveContext(surface);
    const { layout, trace } = resolveLayout(graph, context, surface);
    const visible = layout.elements.filter((e) => e.visible);
    const visibleCount = visible.length;
    const elementCount = layout.elements.length;

    const violation = findInvariantViolation(visible, surface);
    const overallScore = winningOverall(trace);

    if (violation !== undefined) {
      return {
        surface,
        outcome: "failed",
        overallScore,
        visibleCount,
        elementCount,
        reason: violation,
      };
    }
    if (overallScore < DEGRADED_SCORE_THRESHOLD) {
      return {
        surface,
        outcome: "degraded",
        overallScore,
        visibleCount,
        elementCount,
        reason:
          `overall score ${overallScore} < ${DEGRADED_SCORE_THRESHOLD} ` +
          `(${visible.length}/${layout.elements.length} elements kept, ` +
          `winning strategy "${trace.winningStrategy}")`,
      };
    }
    return { surface, outcome: "passed", overallScore, visibleCount, elementCount };
  });

  return {
    total: details.length,
    passed: details.filter((d) => d.outcome === "passed").length,
    degraded: details.filter((d) => d.outcome === "degraded").length,
    failed: details.filter((d) => d.outcome === "failed").length,
    details,
  };
}
