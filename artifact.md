Adaptive Layout Engine for Multi-Surface Ads — Project Plan
1. Vision
Most submissions will build a system that works for the 4 required surfaces and quietly falls apart the moment something unexpected shows up. Our goal is different: build a resolution engine that is structurally general, fully explainable, and provably robust — then prove all three claims visually, live, in the demo itself.

The core architectural bet: model an ad not as a bag of independent boxes, but as a semantic graph of relationships, resolved by a deterministic, scored decision process — not hardcoded per-surface logic, and not an opaque AI/ML model either. Every decision the engine makes should be traceable to a rule or a score, in plain language.

One semantic content model → unlimited surface-specific experiences. Not "one ad, five responsive versions" — one ad spec, infinite valid renderings.

Positioning note
Flam's real platform already handles rich content creation — prompt-powered generation, layers, text/image/audio/3D/motion, distribution across web, social, CTV, OOH, retail, and a "context-responsive" player. We are not competing with that. Our project deliberately targets one specific, narrower, and currently-unsolved problem sitting underneath their whole platform:

How do you take a rich interactive experience and intelligently adapt it to wildly different contexts — without manually redesigning every version?

That's a sharper, more defensible framing than "we built a layout engine" — it positions the project as solving something Flam's own platform needs, not as a toy demo alongside it.

2. Architecture Pillars
Pillar A — The Pipeline (a compiler for ads)
Think of the resolver the way you'd think of a compiler, not a single function:

Raw Ad Content
     ↓
Semantic Parser        (assigns/validates roles, relationships — see note below)
     ↓
Experience Graph        [Intermediate Representation]
     ↓
Context Engine          (interprets the target surface's real-world context)
     ↓
Layout Optimizer         (candidate generation + fitness scoring — Pillar B)
     ↓
Renderer                (DOM / Canvas)
Just like Code → AST → Optimization → Machine Code, our pipeline is: Ad Content → Experience Graph (IR) → Optimization → Surface-Specific Layout

The Experience Graph is the source of truth, not a visualization layer bolted on afterward. Everything downstream (context resolution, candidate generation, scoring, rendering) operates on the graph — never on raw ad content directly.

Experience Graph — node structure. Elements are graph nodes, not independent boxes, and each node carries more than position/size:

importance (critical / should-survive / nice-to-have)
role (hero, primary, secondary, branding, action)
constraints (min size, min tap target, aspect ratio lock)
relationships (edges to other nodes)
interaction (clickable, static, draggable)
visibility (always-visible, degradable, decorative-only)
brand rules (locked color, minimum logo size)
preferred size / minimum size
Edges encode relationships between nodes:

Proximity (price should stay near CTA)
Alignment (logo and headline share a baseline/edge)
Exclusion (elements that must never overlap, beyond simple bounding-box checks)
When one element is resized or dropped under constraint pressure, the change propagates along the graph — e.g. if price shrinks, CTA re-centers; if branding drops, logo's exclusion zone collapses. This is what makes degraded layouts look composed, not randomly rearranged.

Optional, narrowly-scoped AI at the Semantic Parser stage only. The required spec format already lets the author assign roles/priority manually — that alone satisfies the assignment. As an optional enhancement, the Semantic Parser stage could use AI purely for classification/tagging of freeform input ("this is the hero product," "this copy is secondary," "these two elements visually belong together") — never for generating layout, CSS, or positions. This keeps AI strictly at the ingestion boundary, fully outside the decision-making path that needs to stay explainable. Treat this as a nice-to-have, not something the core system depends on.

Context Engine. Surfaces aren't just width × height — they carry real-world context that changes what the right composition even is:

CONTEXT
surface: billboard
width: 3840, height: 1080
viewingDistance: 30m
interaction: none
attentionWindow: 3s
motion: allowed
audio: unavailable
CONTEXT
surface: mobile
width: 390, height: 844
viewingDistance: 40cm
interaction: touch
attentionWindow: 15s
audio: available
Same ad, same graph — genuinely different optimal experience, because the context, not just the pixels, differs. This context object feeds directly into candidate generation and scoring (Pillar B) — e.g. a short attentionWindow biases toward fewer, larger elements; interaction: touch biases toward larger tap targets.

Pillar B — Candidate Generation + Deterministic Scoring ("RL-inspired, zero training")
Instead of one greedy pass or one AI call:

Generate a small set of candidate arrangements per surface (vertical stack, horizontal split, overlay-with-safe-margins, grid — parameterized by the surface's own constraints).
Score every candidate with a transparent, weighted, deterministic fitness function — no model, no black box, just arithmetic:
Constraint violations (heavy penalty)
Priority/survival order preserved
Whitespace / visual balance
Tap-target / min-text-size compliance
Estimated rendering cost (see Pillar C)
Pick the highest-scoring candidate. Log every candidate's score breakdown.
This replaces the earlier "AI Layout Critic" idea with a purely algorithmic version — same "generate → evaluate → select" spirit, zero opacity, zero training data problem, fully defensible line-by-line in an interview.

Pillar C — Extensible Constraint Layer
Constraints are declared, not hardcoded into the resolver:

Hard surface constraints (minTapTarget, minTextSize, safeArea)
Brand-safety constraints (logo.minSize, brandColor.locked, cta.alwaysVisible)
Performance constraints (estimated asset/paint cost — see §4.9)
New constraint types plug in without touching the core resolution algorithm — this is explicitly one of the things the evaluation criteria call out ("could a new surface / renderer be added without touching the resolution algorithm?").

3. Core Required Features (from assignment brief)
These are non-negotiable — everything else sits on top of this foundation.

 Typed defineAd() spec: elements with id, type, role, priority
 Typed surface profiles with real constraints (not just width/height): safeArea, minTapTarget, viewingDistance, minTextSize, touchOnly
 Constraint resolver that: respects priority order, respects hard constraints, never overlaps/clips, produces meaningfully different (not uniformly scaled) layouts per surface
 DOM/CSS rendering for at least 3 distinct surface profiles from the same spec
 Compile-time or clearly-reported runtime type errors for invalid specs/surfaces/roles
 Demo app: one realistic ad spec (headline, image, price, CTA, branding), a surface picker across ≥4 profiles (mobile portrait, mobile landscape, broadcast lower-third, square kiosk), and at least one surface that forces priority-based degradation (not overlap/clip)
 README.md: setup, how to run/switch surfaces, known limitations, time spent
 ARCHITECTURE.md: resolution flow, priority/degradation logic, type design
4. Differentiator Features
Organized by what underlying problem each one solves — not just "cool add-ons."

A. Smarter Resolution Engine
4.1 — Semantic Layout Graph Model elements as nodes with typed relational edges (proximity, alignment, exclusion) instead of independent boxes. Solves: naive priority-dropping treats elements as unrelated, producing layouts that are technically valid but visually disjointed.

4.2 — Importance / Survival Tiers Layer human-readable tiers (must-survive / should-survive / nice-to-have) on top of numeric priority. Same mechanism as required priority field, but far easier to reason about and explain live.

4.3 — Candidate Generation + Deterministic Fitness Scoring As described in Pillar B. Generate multiple candidate layouts, score them transparently, select the winner, log the full breakdown. This is the direct, non-black-box replacement for "AI critic."

4.4 — Lightweight Declarative Constraint Rules A small rule layer for things like "headline needs ≥2 lines of space," "CTA can't be smaller than X," "logo must remain visible." Kept intentionally lightweight — not a general-purpose constraint solver (the brief explicitly warns against over-engineering this).

4.5 — Graceful Degradation Engine The required core behavior, executed explicitly and legibly: for a given surface, define exactly what gets sacrificed and in what order (e.g. shadows → description → secondary image → decorative elements, while brand/product/CTA are protected).

4.6 — Brand-Safe Adaptation Advertiser-defined hard rules: logo.minSize, brandColor.locked, product.mustStayDominant, cta.alwaysVisible, headline.canWrapNotTruncate. Demonstrates the constraint layer is genuinely extensible without touching resolver internals — solves a real advertiser fear (automated adaptation quietly wrecking brand guidelines).

4.9 — Performance-Aware Composition When two candidate layouts score near-equally on visual criteria, prefer the one with lower estimated rendering cost (fewer/larger image assets, fewer DOM nodes, lower estimated paint cost). Implemented as one more scored term inside the same deterministic fitness function from §4.3 — not a separate profiling system. Ties frontend design decisions directly to rendering performance, which is directly relevant to a frontend R&D role.

B. Trust & Robustness
4.7 — Layout Debugger ("DevTools for Ads") A live decision-trace panel next to the canvas, showing per-element reasoning in plain language:

❌ CTA violated minimum tap target size
⚠️ Headline wrapped to 2 lines (safe)
⚠️ Product overlaps safe area — auto-corrected
✓ Brand visibility preserved
Directly answers the exact question the brief says will be asked live: "walk through why a specific element ended up at a specific position/size."

4.7b — Layout Counterfactuals ("why not candidate B?") Since §4.3 already generates and scores multiple candidates, surface that work instead of throwing it away after picking the winner:

ORIGINAL
   ↓
12 candidates generated
   ↓
Candidate A: 71    Candidate B: 83    Candidate C: 94 ← chosen
Let the viewer click any non-winning candidate and get a plain-language reason it lost, pulled straight from the score breakdown — e.g. "CTA became too small at the target viewing distance" or "Product and headline lost visual association." This turns the demo from "here's the answer" into "here's the reasoning," which is a materially stronger interview moment, and costs very little extra since the scoring data already exists.

4.7c — Layout Health Check (friendlier framing of the fitness score) A simpler, pass/fail-style summary view of the same scoring data from §4.3, for anyone who doesn't want the raw numbers:

LAYOUT HEALTH
✓ Brand visibility
✓ CTA accessibility
✓ Safe area
✓ Text readability
⚠ Headline density
✕ Product too small for viewing distance
Answers a real production question — "how does anyone know an automated adaptation is actually good?" — in a format non-engineers (recruiters, designers) grasp instantly. Same underlying data as §4.3/§4.6, just a second, more legible view of it.

4.10 — Automated Stress Testing ("Stress Lab") Generate 100+ randomized surface/context profiles (extreme aspect ratios like 320×568, 3440×1440, 1080×300; randomized constraint combinations) and run automated invariant checks against every one. Rather than a flat pass/fail, report three tiers:

STRESS TEST — 247 contexts

✓ 239 passed
⚠ 6 degraded (survived, but below ideal fitness score)
✕ 2 failed (invariant violation)

Robustness: 96.8%
Clicking a failed or degraded entry jumps straight to that layout for inspection. Directly derisks the scariest official live-interview moment: an unseen 5th surface. The tiered breakdown (vs. a simple binary count) also gives you an honest, specific answer if asked "what would you improve next," instead of a vague one.

4.13 — Self-Healing / Fault-Tolerant Layout Handle failure cases gracefully instead of breaking. The strongest version of this demo stacks multiple stressors at once — e.g. an unusually long headline + a missing image + a small screen + a translated (longer) CTA, all simultaneously. Instead of:

❌ overflow
❌ clipped CTA
❌ broken layout
the engine detects the combined violations, reports "Layout invalid. Re-optimizing.", and reconstructs a valid layout automatically. Demonstrating recovery from several simultaneous failures (not just one) is a much more convincing proof that the whole pipeline — graph, context engine, optimizer — is actually working together, not just handling one narrow edge case. Maps directly to the official bonus: "text-measurement-aware layout."

C. Context Intelligence
4.3-context — Context-Aware Adaptation Use all surface metadata meaningfully, not just width/height — viewingDistance, touchOnly, minTapTarget should change the composition strategy itself, not just element sizes.

4.14 — Interactive vs. Passive Layout Strategy Surface interaction model changes composition, not just sizing:

Billboard (passive, far viewing) → prioritize instant visual comprehension, fewer larger elements
Phone (touch) → larger CTA, interactive affordances
TV/broadcast (remote-driven) → fewer, larger actionable elements
4.17 — Language-Aware Adaptation (stretch) Demonstrate rebalancing when translated text is significantly longer (e.g. "Shop Now" vs. "Jetzt einkaufen") — the engine detects the expansion and re-resolves rather than overflowing. Natural extension of the self-healing/text-measurement work in §4.13.

D. Demo & Presentation
4.16 — Side-by-Side Multi-Surface View Show all required surfaces rendering simultaneously (in realistic device frames — phone bezel, broadcast frame, kiosk frame) rather than a one-at-a-time switcher. Same ad spec, visibly different, correct layouts, at a glance.

4.18 — Live Degradation Slider Drag a slider to shrink the active surface in real time and watch priority-based degradation happen live — elements shrink, then drop, in the documented order. Turns an abstract claim into something you can watch happen.

4.19 — Naive vs. Smart Comparison View Show the engine's real output next to a "naive" uniform-scaling version, side by side. Visually proves the system is doing more than what the brief explicitly says not to do ("uniform scaling passed off as adaptation").

4.20 — Live "Unknown Surface" Input A simple form to type in a brand-new surface's dimensions/constraints on the spot and see it resolve instantly, no code changes. Directly rehearses the official live-interview bonus scenario.

4.21 — Canvas Renderer (second backend) A Canvas rendering backend in addition to DOM, consuming the exact same resolver output. Proves the "renderer swap without touching resolution logic" architectural claim isn't just asserted — it's structurally true. Matches an official bonus point.

E. Framing Principle (no extra code — documentation/pitch only)
"Layout DNA" — instead of storing a layout per surface, the spec + relationships + priorities + constraints constitute the ad's semantic "DNA," from which any number of surface-specific renderings can be generated. Use this framing explicitly in the README/ARCHITECTURE doc and in how you narrate the project — it reframes the whole submission as infrastructure, not a one-off layout demo.

5. Feature Priority Tiers (importance, not a schedule)
Tier 0 — Foundation (assignment requires this to function at all): §3 core requirements, §4.1 (graph model), §4.5 (degradation engine), §4.4 (constraint rules), §4.3-context (context-aware use of metadata)

Tier 1 — High-leverage differentiators: §4.3 (candidate generation + scoring), §4.6 (brand-safe adaptation), §4.7 (layout debugger), §4.10 (stress lab), §4.16 (side-by-side view)

Tier 2 — Strong bonus, build once Tier 0/1 are solid: §4.2 (survival tiers naming), §4.7b (layout counterfactuals — cheap given §4.3 already exists), §4.7c (layout health check — cheap given §4.3/§4.6 already exist), §4.9 (performance-aware scoring term), §4.13 (self-healing, combined-stressor demo), §4.18 (degradation slider), §4.19 (naive vs. smart comparison), §4.20 (live unknown-surface input), §4.21 (canvas renderer)

Tier 3 — Stretch, only if time genuinely remains: §4.14 (interactive vs. passive framing polish), §4.17 (language-aware demo), optional AI-assisted Semantic Parser (Pillar A note — purely a bonus, core system must work fully without it)

6. Documentation Plan
README.md
Setup instructions
How to run the demo, switch/compare surfaces
Which bonus features are implemented and why
Known limitations
Time spent
AI tool disclosure (if any used for scaffolding/boilerplate — per FAQ, allowed and must be disclosed)
ARCHITECTURE.md
Resolution flow diagram: Ad Spec + Surface Profile → Graph Builder → Candidate Generator → Fitness Scorer → Resolved Layout → Renderer
How the semantic graph and relational edges work
How priority/survival degradation is decided, step by step
How the deterministic fitness function is weighted, and why
How brand-safe / performance-aware constraints plug in without touching the resolver core
Stress test methodology and results summary
Limitations and explicit "what I'd improve next"
7. Mapping to Flam's Stated Evaluation Criteria
Their Criterion (weight)	Addressed by
Constraint resolution algorithm (35%)	Pillar A pipeline (Experience Graph + Context Engine), §4.3 candidate+scoring engine, §4.4 constraint rules, §4.5 degradation engine
Layout correctness across surfaces (25%)	§3 core rendering, §4.10 stress lab (tiered results), §4.16 side-by-side proof
TypeScript & architecture (20%)	§3 typed spec/surfaces/output, §4.6/§4.21 extensibility proof (new constraint type, new renderer without touching resolver), Pillar A's clean pipeline staging
Example application (10%)	§4.16, §4.18, §4.19, §4.20 demo polish
Code quality (10%)	§4.7/§4.7b/§4.7c decision-trace, counterfactual, and health-check panels double as living documentation of your own logic
8. Scope Guardrails (what to explicitly avoid)
No literal ML/RL model in the resolution path. The brief explicitly prefers explainable, well-reasoned algorithms over black-box generality. Every "AI-inspired" idea here (§4.3, §4.9) is implemented as deterministic, loggable arithmetic — never a trained model or opaque API call.
If the optional Semantic Parser AI is built at all, it stays strictly at the ingestion boundary — classifying/tagging raw content only, never generating positions, sizes, or CSS. The core system must work fully with manually-authored specs alone; AI tagging is additive, not load-bearing.
Keep the constraint layer lightweight (§4.4). A handful of clear rules, not a general-purpose solver — the brief explicitly warns against over-engineering this.
Explicitly out of scope, regardless of how tempting: generic chatbot/assistant UI, AR features (just because Flam does AR), 3D visuals for their own sake, voice interaction, authentication, campaign-management tooling, or any analytics system beyond what §4.7/§4.7c already provide. None of these make multi-surface adaptation more intelligent, robust, or scalable — they only dilute review time.
Every differentiator must still visibly serve the graded criteria (§7) — nothing here is decoration for its own sake; each feature is justified by which underlying problem it fixes.