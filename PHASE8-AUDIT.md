# Phase 8 — Panel Audit: "Is the Product Photo Actually the Highlight?"

**Role:** strict panel judge, brutally honest.
**Method:** live measurement via chrome-devtools MCP — real resolved pixel geometry, real screenshots,
real Stress Lab runs (200 randomized surfaces) — not theorized. Every number below was read out of the
running app, not estimated.
**Scope:** (1) is the product image genuinely the visual highlight, in normal AND extreme conditions; (2) are
the other components' relative sizes/ratios sane; (3) a full pass over every view in the site.

Verdict up front: the panel found **three real bugs**, one of them severe enough that it directly
contradicted the project's own stated goal ("the product image is our highlight"). All three are fixed,
tested, and re-verified live below. One cosmetic issue and one architectural limitation are documented,
not fixed, with the reasoning for that call made explicit.

---

## 1. Is the product image the highlight? — Before/after, measured

Methodology: for each surface, read every element's real rendered `width`/`height` out of the DOM
(`data-element-id` inline styles, unscaled logical pixels) and compute `area / total visible area`.

### 1a. Normal conditions (the 5 real sample surfaces) — no bug found here

| surface | winning strategy | image % of ad area | verdict |
|---|---|---|---|
| Phone — portrait | vertical-stack | **71.5%** | clearly dominant |
| Phone — landscape | grid | 39.8% | largest single element, thin margin (see §3) |
| Broadcast — lower third | horizontal-split | 45.7% | largest single element, thin margin (see §3) |
| Retail kiosk | vertical-stack | **82.4%** | clearly dominant |
| Print — QR panel | vertical-stack | **75.7%** | clearly dominant |

The image was already the single largest element on **5 of 5** real surfaces before this audit. On 3 of
5 it's an unambiguous, comfortable majority. On 2 of 5 (the wide/landscape ones, where `grid` or
`horizontal-split` wins) the margin over the headline was uncomfortably thin — flagged in §3, partially
addressed, residual limitation documented honestly rather than papered over.

### 1b. Extreme conditions — **CRITICAL bug found and fixed**

Measured on a real, standard 320×50 mobile banner (an actual IAB ad unit, not a synthetic edge case)
**before this audit's fix**:

| element | size | % of ad area |
|---|---|---|
| headline | 24×22 | 4.1% |
| cta | 24×16 | 3.0% |
| **product-image ("the highlight")** | **24×22** | **4.1%** |
| price | 198×50 | **76.4%** |
| logo | 50×32 | 12.3% |

**The ad's actual message and highlight were reduced to illegible specks while the fine-print price text
occupied three-quarters of the ad.** This is not a matter of degree — it is a complete inversion of the
declared visual hierarchy, and it reproduced on every real standard ad size that triggers the emergency
floor (320×50, 728×90, 100×600 all showed the same pattern).

**Root cause:** `emergency-fit` (the last-resort strategy for surfaces too small for even the declared
minimum sizes) only relaxed `visibility:"always"` elements down to a tiny floor. Degradable elements
(price, logo) kept cascading through the *same* pass at full, un-relaxed, growable size — and once the
always-elements shrank to a floor, the "slack" left behind was almost the whole surface, which the
degradable elements then grew into.

**Fix (`src/core/candidates.ts`, §7.9):** `emergencyFit` now places **only** always-visible elements.
Any request that isn't always-visible returns a `null` slot unconditionally — dropped, not grown into the
gap. A "last resort, bare-essentials-only" strategy has no business displaying secondary text at full size
while the actual message is a dot; showing less is a *better* layout than showing that.

**Same 320×50 banner, after the fix:**

| element | size | % of ad area |
|---|---|---|
| headline | 24×22 | 16.2% |
| cta | 24×16 | 11.6% |
| **product-image** | **48×50** | **72.3%** |

Price and logo are cleanly dropped (visible in the Layout Debugger: *"price: dropped — priority 4, no
room left..."*), and the image is unambiguously the highlight again.

### 1c. Second-order bug found while fixing 1b: the highlight had no highlight treatment

After the fix above, all three surviving always-elements (headline, cta, product-image) shared the exact
same tiny floor size (`EMERGENCY_MIN_SIZE = 24×16`) — the "highlight" was rendered as an equal-sized,
indistinguishable chip next to plain text labels. Technically correct, still a real design failure: "the
highlight, handled carefully" should still read as the highlight even at the worst-case floor.

**Fix:** added `EMERGENCY_HIGHLIGHT_SIZE = 48×36` (a 4:3, photo-shaped floor, ~3x the area) applied
specifically to the `hero` role. Verified live across every emergency-fit case tested (70×70, 320×50,
728×90, 100×600): the image now consistently renders at **69–72% of the ad's area** even at the absolute
floor, never tied with or smaller than headline/cta.

### 1d. Third-order fix: growth headroom for the hero role

On surfaces where `grid` wins (both axes growable) and the headline has a generous declared
`preferredSize.height` (left for legible two-line wrapping), the standard 1.4x growth cap let the headline
grow close enough to the photo's own area to feel like a genuine contest (29% vs. 39.8%, measured on the
landscape phone surface). Added `HERO_GROWTH_CAP_FACTOR = 1.9` — the hero role gets a larger growth
ceiling than the uniform 1.4x everything else uses, so it stays comfortably ahead whenever a strategy lets
anything grow. Verified: on `retailKiosk` (where the growth factor was the binding constraint, not cell
size), the image's share rose from 77.5% → **82.4%**.

**Where this did NOT help, and why (documented, not hidden):** on `grid`-winning surfaces
(`mobileLandscape`), the ratio is **unchanged at 39.8%** — because `grid`'s cell size, not the growth
factor, is the actual bottleneck there. `grid` partitions the surface into `ceil(√n)` uniform cells with
zero awareness of role; boosting the growth *multiplier* does nothing when the *cell itself* is the
ceiling. Fixing this properly means making `grid` allocate a bigger cell to the hero role specifically — a
real change to a strategy explicitly documented elsewhere as "symmetric, uniform, never role-aware by
design." That is a bigger, riskier architectural change than this finding's severity justifies on its own,
so it is called out here as a known, moderate, *unresolved* limitation rather than quietly declared fixed.

---

## 2. Ratio sanity check — the other components

Measured across all 5 real surfaces, post-fix:

| surface | headline | cta | image | price | logo |
|---|---|---|---|---|---|
| Phone — portrait | 14.3% | 8.0% | 71.5% | 5.1% | 1.2% |
| Phone — landscape | 29.0% | 14.0% | 39.8% | 14.5% | 2.7% |
| Broadcast | 36.4% | 7.2% | 45.7% | 8.7% | 2.0% |
| Retail kiosk | 10.6% | 3.9% | 82.4% | 2.5% | 0.6% |
| Print — QR panel | 15.1% | 4.5% | 75.7% | 3.8% | 0.9% |

Verdict: on 3 of 5 surfaces this reads as a sane, real-ad-like hierarchy (image dominant, headline
secondary, CTA/price/logo progressively smaller supporting content). On the 2 wide surfaces, headline's
share (29–36%) is larger than ideal relative to price/logo/cta combined — a direct consequence of the
`grid`-cell-size limitation in §1d, not a separate bug. Logo (brand mark) is consistently, correctly the
smallest element everywhere (0.6–2.7%) — appropriate for a supporting brand mark, never competing for
attention.

---

## 3. Bug #2 (independent of the highlight investigation): shrink/grow labels could contradict their own percentage

Found by inspecting the **Self-Healing** demo's live output (not theorized): the "After — recovered" panel
showed:

> headline: wanted 1569×120, **grew to** 120×130 (**+-92%**)

This is nonsensical on its face — a "+-92%" is not a real percentage, and an element cannot coherently be
described as having "grown" when its width was cut to roughly a thirteenth of its declared size.

**Root cause:** the code decided "grew" vs. "shrunk" per-axis with an OR condition (`width > preferred.width
|| height > preferred.height`), while the percentage shown was computed from **area**. An element whose
width collapsed but whose height ticked up by even a fraction of a pixel satisfied the "grew" branch while
its area-based percentage was strongly negative — verdict and number disagreed with each other.

**Fix (`src/core/candidates.ts`, §7.10):** both the verdict and the percentage are now driven by the same
area comparison. Re-verified live: the same scenario now reads:

> headline: wanted 1569×120, **placed at** 120×130 → **shrunk 92%**

— coherent, and matching what actually happened. A new property-based test asserts this can never
regress: for every strategy on every sample surface, no "grew" note's before/after area can ever be
smaller, and no "shrunk" note's can ever be larger.

---

## 4. Full site pass — what else was checked

- **Side-by-side:** all 5 surfaces render in the correct realistic device chassis (phone bezel / clean
  browser frame / TV monitor), auto-selected by aspect ratio, matching Single Surface's own behavior.
  Centered, no stray dead space. No issues found.
- **Naive vs. Smart:** clean, effective contrast — the naive panel visibly overlaps/clusters in a corner;
  the smart panel is an organized, non-overlapping composition. No issues found.
- **Self-Healing:** functionally correct (CTA stays visible through every simultaneous failure injected);
  the note-labeling bug above was found here. Also surfaced a **minor, unfixed cosmetic issue**: the
  decorative "nykaa" corner badge is fixed at the surface's top-right corner regardless of what real content
  ends up there, and in this scenario the CTA's resolved position visually collides with it (readable, not
  broken, but reads awkwardly — "Shop the [badge] summer collection..."). Not fixed: the badge is a
  presentation-only decoration and the codebase has a firm, tested rule that presentation must never
  influence resolver geometry (adding a permanent reserved corner to the resolver's available box would
  violate that separation for the sake of one decorative element). Documented here rather than worked
  around with a hack.
- **Stress Lab (200 randomized surfaces, re-run after every fix):** **`failed` stayed at 0 throughout.**
  Final state: 163 passed / 37 degraded / 0 failed, 81.5% robustness. Every degraded entry is still
  categorized "sparse but valid" — the robustness number is lower than the immediately-preceding phase's
  (84.5%) because `emergency-fit` now intentionally shows fewer elements (3, not 5) in true emergencies;
  that is the correct, deliberate trade-off this audit's fix makes (a coherent 3-element ad beats an
  incoherent 5-element one where 2 of them are oversized fine print), not a regression.
- **Unknown Surface:** used throughout this audit to drive arbitrary widths/heights directly; no issues
  found beyond what's already covered above.

---

## 5. Verification

- `tsc --noEmit`: clean.
- `npm run build`: succeeds.
- `npm run test`: **144/144 passing** (was 142 before this audit; +2 new regression tests for the
  grow/shrink label fix, plus the emergency-fit and hero-growth tests added while fixing §1).
- Stress Lab: 0 failed, re-run live after every code change in this audit, not just once at the end.
- Every fix above was verified against the *actual rendered pixels* via chrome-devtools MCP, not inferred
  from code reading alone.

## 6. Summary table

| # | Finding | Severity | Status |
|---|---|---|---|
| 1 | Emergency-fit let degradable elements (price/logo) render at full size while critical content was shrunk to a floor — up to 76% of the ad — completely inverting visual hierarchy on real ad sizes (320×50, 728×90, 100×600) | **Critical** | **Fixed** + tested |
| 2 | The "highlight" (product image) shared the exact same tiny floor size as plain text chips in emergency mode, with no visual distinction | Major | **Fixed** + tested |
| 3 | Grow/shrink debugger notes could report a nonsensical "grew to X (+-92%)" when one axis grew and the other collapsed | Moderate (correctness of the explainability layer) | **Fixed** + tested |
| 4 | On `grid`-winning wide surfaces, the image's size margin over the headline is thin (39.8% vs 29%) because `grid` has no role-awareness in its cell sizing | Moderate | **Documented, not fixed** — real fix requires changing `grid`'s core allocation model, judged out of proportion to this audit |
| 5 | The decorative "nykaa" corner badge can visually collide with real content that happens to resolve into that corner | Minor (cosmetic only) | **Documented, not fixed** — fixing it properly would require breaking the presentation/resolver separation for one decorative element |
