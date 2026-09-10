import { describe, it, expect } from "vitest";
import { buildGraph } from "../graph";
import { resolveContext } from "../context";
import { resolveLayout, type ResolvedElement } from "../resolver";
import {
  buildSelfHealingSpec,
  selfHealingSurface,
  type ScenarioLocale,
} from "../self-healing-scenario";

function boxesOverlap(a: ResolvedElement, b: ResolvedElement): boolean {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}

const LOCALES: ScenarioLocale[] = ["en", "de"];

describe("self-healing scenario — combined failure recovery", () => {
  for (const locale of LOCALES) {
    const graph = buildGraph(buildSelfHealingSpec(locale));
    const { layout } = resolveLayout(
      graph,
      resolveContext(selfHealingSurface),
      selfHealingSurface,
    );
    const visible = layout.elements.filter((e) => e.visible);

    it(`${locale}: zero overlaps among visible elements`, () => {
      for (let i = 0; i < visible.length; i++) {
        for (let j = i + 1; j < visible.length; j++) {
          expect(
            boxesOverlap(visible[i]!, visible[j]!),
            `${visible[i]!.id} overlaps ${visible[j]!.id}`,
          ).toBe(false);
        }
      }
    });

    it(`${locale}: zero out-of-bounds elements`, () => {
      for (const e of visible) {
        expect(e.x).toBeGreaterThanOrEqual(-0.5);
        expect(e.y).toBeGreaterThanOrEqual(-0.5);
        expect(e.x + e.width).toBeLessThanOrEqual(selfHealingSurface.width + 0.5);
        expect(e.y + e.height).toBeLessThanOrEqual(
          selfHealingSurface.height + 0.5,
        );
      }
    });

    it(`${locale}: the CTA stays visible despite everything else going wrong`, () => {
      const cta = layout.elements.find((e) => e.id === "cta");
      expect(cta?.visible).toBe(true);
      expect(cta!.width).toBeGreaterThan(0);
      expect(cta!.height).toBeGreaterThan(0);
    });

    it(`${locale}: the headline (visibility "always") is never dropped`, () => {
      const headline = layout.elements.find((e) => e.id === "headline");
      expect(headline?.visible).toBe(true);
    });
  }

  it("the German CTA string is measurably longer than the English one", () => {
    const en = buildSelfHealingSpec("en").elements.find((e) => e.id === "cta")!;
    const de = buildSelfHealingSpec("de").elements.find((e) => e.id === "cta")!;
    expect(de.text!.length).toBeGreaterThan(en.text!.length);
  });
});
