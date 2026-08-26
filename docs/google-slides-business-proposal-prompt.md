## THE PROMPT

Copy everything inside the block below.

````text
You are a senior enterprise strategy consultant and presentation designer building a 
BUSINESS PROPOSAL deck in Google Slides for a product called ControlPlane Checker.

The deck must be visually indistinguishable from the source presentation
"ControlPlane.ai_Accenture.pptx" (Accenture Innovation Challenge 2026 brand template),
which is already open / already imported. Reuse its existing masters and layouts.
Do NOT invent a new theme, do NOT apply a Google Slides stock theme, do NOT change
the colour palette, and do NOT restyle the cover or closing slides.

═══════════════════════════════════════════════════════════════════════════════
PART 1 — TEMPLATE LOCK (non-negotiable; these values are measured from the source file)
═══════════════════════════════════════════════════════════════════════════════

CANVAS
• 16:9 widescreen, 13.333 in × 7.5 in (10 in × 5.625 in if your unit system is different — scale proportionally).
• Slide number bottom-right at (12.58 in, 7.13 in), 0.42 × 0.23 in, on every content slide. Not on cover or closing.

COLOUR PALETTE — use ONLY these
• Accenture Purple (primary)        #A100FF   → title bars, accent circles, section labels, arrows, key headings
• Deep Aubergine (dark)             #2D1B4E   → dark chips, "Block + Escalate", bold closing takeaway paragraphs
• Mid Violet                        #9B5DE5   → third-position chips/circles
• Lilac Card Tint                   #F5EFFF   → rounded-rectangle card fills on light slides
• Lilac Chip Tint                   #E9DCFF   → light chips (text on these is #A100FF)
• Body Ink                          #1A1A1A   → all body copy
• Muted Grey                        #5A5A5A   → captions, sub-labels, footnotes, italic sub-headings
• White                             #FFFFFF   → text on purple/dark fills
• Theme accents (sparingly, for charts/rules only): #7500C0, #460073, #C2A3FF, #E6DCFF, #FF50A0, #224BFF, #05F2DB
Never introduce a colour outside this list. No blues, greens, oranges, or reds as decoration —
if you need a "risk" signal, use #2D1B4E for high and #A100FF for medium, never traffic-light colours.

TYPOGRAPHY
• Titles & cover: Graphik Semibold. If Graphik is unavailable, fall back to Inter (else Archivo, else Manrope). Never Calibri, never Aptos.
• All body copy, cards, chips, tables, captions: Arial. (The source deck uses Arial for body — keep it.)
• Size scale, exactly as in source:
    Cover headline .............. Graphik Semibold 40 pt bold, white, centred
    Cover sub-strip ............. Graphik 18 pt, white, centred
    Slide title (in purple bar) . Graphik Semibold 20 pt bold, white, left-aligned
    Eyebrow (top-right) ......... Arial 12 pt, white, right-aligned
    Slide kicker/product name ... Arial 21 pt bold, #A100FF
    Kicker subtitle ............. Arial 12.5 pt italic, #5A5A5A
    Body paragraph .............. Arial 12.5 pt (13.5 pt on text-heavy slides), #1A1A1A
    Closing takeaway paragraph .. Arial 12.5 pt BOLD, #2D1B4E   ← always the last paragraph of the left column
    Rail section label .......... Arial 11 pt bold, ALL CAPS, #A100FF
    Card title .................. Arial 14 pt bold, #1A1A1A
    Card caption ................ Arial 11 pt, #5A5A5A
    Circle avatar letter ........ Arial 20 pt bold, white
    Chip label .................. Arial 10.5–11.5 pt bold, centred
    Footnote .................... Arial 10 pt italic, #5A5A5A, centred
    Team member name ............ Graphik 36 pt bold, #A100FF
    Team member detail .......... Arial 12 pt, #000000

STANDARD CONTENT SLIDE ANATOMY — layout "1_Standard slide_no bullets"
Every content slide is built from these five elements. Reproduce the geometry.
 1. PURPLE TITLE BAR — full-width rectangle at (0.37, 0.37), 12.34 × 0.46 in, solid fill #A100FF,
    slide title in white Graphik Semibold 20 pt bold, left-inset ~0.18 in, vertically centred.
 2. EYEBROW — text box at (8.70, 0.37), 3.60 × 0.46 in, sitting ON TOP of the purple bar,
    Arial 12 pt white, right-aligned. Text = "ControlPlane Checker" (use "ControlPlane.ai" on
    problem/market slides, matching the source).
 3. LEFT NARRATIVE COLUMN — text box at (0.55, 1.10), 7.20 in wide, up to 5.60 in tall.
    2–4 full prose paragraphs, Arial 12.5 pt, #1A1A1A, line spacing 1.15, ~12 pt space after each
    paragraph. The FINAL paragraph is always the "so what" — Arial 12.5 pt bold, #2D1B4E.
    Optional above it: kicker (Arial 21 pt bold #A100FF) + italic subtitle (Arial 12.5 pt #5A5A5A).
 4. RIGHT VISUAL RAIL — occupies x = 8.00 → 12.80 in (width 4.65–4.80 in), y = 1.10 → 6.70 in.
    Starts with an ALL-CAPS rail label (Arial 11 pt bold #A100FF), then ONE of these rich visual formats:
      (a) STACKED CARDS — rounded rectangles, fill #F5EFFF, 4.65 × 1.40 in, 0.22 in gap, corner
          radius ~0.10 in. Inside each: a 0.62 in circle at x+0.24 (fills in order #A100FF,
          #2D1B4E, #9B5DE5) with a single white 20 pt bold letter; then a card title (Arial 14 pt
          bold #1A1A1A) and one-line caption (Arial 11 pt #5A5A5A) at x+1.08, width 3.35 in.
      (b) VERTICAL ARCHITECTURE / DECISION FLOW — full-width top banner → downward triangle → row of
          3 lane chips (P / C / R) → triangle → graduated action chips / routing tiers. Bars/chips are
          rounded rectangles; the downward arrows are isosceles triangles 0.18 × 0.16 in, fill #A100FF.
      (c) 2×2 / 3×1 STAT BLOCK & HEATMAP GRID — grid of rounded rectangles, fill #F5EFFF, each with a
          large hero number (Arial 28 pt bold #A100FF or #2D1B4E), a severity tag, and descriptive label.
      (d) 4-STAGE TIMELINE / CHEVRON FLOW — 4 connected horizontal or vertical milestone cards with
          numbered #A100FF circle badges, milestone labels, and exit gate criteria.
      (e) 2×2 CONFUSION MATRIX HEATMAP & SLIDER GRAPHIC — 4 quadrant tiles (TP, FP, FN, TN) color-tinted
          by classification outcome, paired with a visual cutoff slider bar (0.20 Strict ↔ 0.85 Permissive).
      (f) 5-ROW COMPETITIVE CAPABILITY MATRIX — comparative matrix comparing 4 market alternatives against
          ControlPlane Checker with visual status chips (#A100FF Full, #E9DCFF Partial, #2D1B4E Gap).
 5. RAIL FOOTNOTE — optional single line under the rail, Arial 10 pt italic #5A5A5A, centred.

COVER SLIDE — layout "Cover: gradient"
Keep the existing full-bleed purple gradient image and the Accenture logo at (0.74, 0.73),
1.37 × 0.36 in. Headline text box at (3.27, 5.92), 6.79 × 0.62 in — Graphik Semibold 40 pt bold,
white, centred. Beneath it a solid #A100FF rectangle at (4.22, 6.55), 4.89 × 0.39 in, with a
centred Graphik 18 pt white sub-line on top.

SECTION DIVIDERS — layout "Section divider: gradient"
Full-bleed gradient, one short white Graphik Semibold headline, no body copy, no slide number.

CLOSING SLIDE — layout "Salutation: gradient"
Reproduce exactly as in the source: gradient background, title "Thank you". Add nothing else.

OTHER LAYOUTS YOU MAY REUSE BY NAME (they exist in the file — prefer these over drawing from scratch)
"Content: 3 columns", "Content: 4 columns", "Content: table", "Content: 2 columns + subtitle",
"Content: statistics light mode", "Content: statistics + image, light and purple",
"Content: icons", "Key message: light mode", "Content: team 2 + light mode", "Bullets Opt 1",
"Content: 1 column + image", "Blank with copyrights".

═══════════════════════════════════════════════════════════════════════════════
PART 2 — SOURCE CONTENT (this is the approved voice and the factual base; do not contradict it)
═══════════════════════════════════════════════════════════════════════════════

PRODUCT: ControlPlane Checker — "A live trust layer for enterprise AI."
A model-agnostic layer that sits between any application and any LLM, scoring every response in
real time across three lanes that run ALONGSIDE generation, not after it.

APPROVED PROBLEM NARRATIVE (from the source deck — reuse near-verbatim on the Problem slide):
"Enterprises are shipping AI into real workflows faster than they can watch it. A model can sound
completely confident while being factually wrong, burn far more compute or human rework than a task
warrants, or quietly leak sensitive data and reproduce bias — and today, all three failure modes
usually surface only after a user has already acted on the output.
Sampled audits and support tickets are the primary safety net, so the first real signal is often a
customer complaint, a compliance breach, or an expensive rework cycle. As AI moves from pilot
projects into core operations — sales, service, manufacturing, risk — that reactive posture becomes
a real liability. Every new model, agent, or use case adds a blind spot no team can manually review
in real time.
ControlPlane.ai asks a simple question: what if AI oversight worked like infrastructure monitoring —
continuous and live — instead of a periodic audit? The challenge: a lightweight layer that watches
performance, cost, and responsibility on every response, at production speed, without becoming the
bottleneck it exists to prevent."

APPROVED SOLUTION NARRATIVE (from the source deck — reuse near-verbatim on the Solution slide):
"Performance lane checks answer-groundedness against retrieved context and flags the 'confidently
wrong' signature. Cost lane tracks tokens, retries, and tool-call loops against a rolling baseline
per query type. Responsibility lane runs fast classifiers for bias, PII, and policy violations on
both prompt and response.
Because checks race the model's own output, users see the first tokens immediately — the system adds
a verdict, not a delay. Low-risk issues get an ambient trust badge, medium-risk responses get a live
correction, and high-severity flags are blocked and escalated to a human before the user ever sees
them.
That turns AI oversight from something compliance discovers weeks later into something a risk owner
watches live — catching problems while they're still cheap to fix, and building the trust enterprises
need to scale AI from pilot to production."
Footnote used in the source: "Async checks add roughly 150–300 ms; only high-severity flags block the
response — everything else streams straight through."

THE THREE LANES (P / C / R — always in this order, always with these circle colours)
• P — Performance  (#A100FF): "Right — or confidently wrong?"
    Lexical + semantic (Jaccard / n-gram) overlap between generated claims and retrieved grounding
    snippets. Linguistic-certainty extraction: high-conviction assertions ("guaranteed", "with 100%
    legal certainty", "strictly mandates") vs hedges ("might be", "according to documentation").
    Certainty-vs-support mismatch produces the "Confidently Wrong" flag. Ambiguous grounding scores
    (0.35–0.60) are handed to an LLM judge as a tie-breaker.
• C — Cost  (#2D1B4E): "Burning more compute than it should?"
    Z-score outlier analysis on token counts and latency against per-use-case historical
    distributions (μ, σ). Runaway agentic-loop detection (tool calls > 6, completion tokens > 3.5σ).
    Financial risk indexing to prevent compute-budget exhaustion.
• R — Responsibility  (#9B5DE5): "Biased, unsafe, or leaking data?"
    Jurisdiction-specific profiles: EU AI Act (strictest PII masking, transparency tagging,
    high-risk flagging), US HIPAA & FINRA (PHI, SSN, account numbers, financial-advice disclaimers),
    India DPDP Act (Aadhaar patterns, phone/email masking), Internal IP (AWS keys, bearer tokens,
    private endpoints, proprietary source markers). Fairness/bias detection including algorithmic
    redlining (zip-code-based loan denial, demographic stereotyping). Hard governance overrides:
    SSN exposure, credit-card leaks and explicit discrimination trigger BLOCK_ESCALATE regardless
    of other lane scores.

AGGREGATION: dynamic lane weighting with overlap multipliers, plus a multi-turn exponential risk
accumulator (decay 0.45) that catches session drift — turns that look benign individually but
compound across a session.

FOUR-TIER POLICY ENACTMENT (thresholds are policy-configurable per use case)
• ALLOW           — composite risk below badge threshold. Passes unimpeded; full audit telemetry persisted. ~0 ms overhead.
• BADGE           — badge ≤ risk < soft. Attaches confidence indicators and source-verification badges. +35 ms.
• SOFT_CORRECT    — soft ≤ risk < block. Prepends safety disclaimers, inserts hedging, links retrieved context. +45 ms.
• BLOCK_ESCALATE  — risk ≥ block threshold OR a critical policy violation. Intercepts before render, emits a safe
                    fallback, routes to the human review queue. +140 ms (pre-block).

PLATFORM MODULES (six, shipped and demonstrable)
1. Executive Telemetry Dashboard — audited volume, block rate, confidently-wrong rate, PII leaks blocked,
   average governance overhead (82 ms baseline); risk distribution by lane, hourly volume vs blocks, cross-use-case matrix; quick-triage widget.
2. Live Telemetry Stream — real-time interaction feed across Customer Support, Internal Copilot and Decision Support
   agents; filter by use case, verdict tier and risk level; inspection modal with token breakdown, latency gauges,
   triggering-span highlights and one-click LLM-judge execution.
3. Frontline Human Review Queue — HITL adjudication portal; side-by-side prompt / retrieved context / model output
   with span highlights; one-click Approve & Release, Overturn & Correct, Escalate to Legal-Security, or Trigger LLM Judge;
   resolution logging and audit trail.
4. Policy Profiles Manager — per-use-case governance (support_bot, internal_copilot, decision_support): lane weights,
   trigger thresholds, regulatory regime, and pre-response blocking vs async post-generation monitoring.
5. Trust & Calibration Dial — confusion matrix (TP/FP/TN/FN) against ground truth, precision-recall curve,
   FPR-vs-block-rate trade-off slider, live SLA-impact and false-escalation cost estimation.
6. Interactive Sandbox Tester — paste a prompt, retrieved context and candidate response; score across all three
   lanes instantly with an on-demand LLM judge evaluation.

ARCHITECTURE & DEPLOYMENT
Inline or sidecar trust proxy. Pipeline: telemetry ingestion → three-lane real-time scoring engine →
aggregation & session compounding → asynchronous LLM judge (tie-break only) → policy tier enactment →
human-in-the-loop review queue. Sub-millisecond deterministic heuristics; the LLM judge is invoked
only for ambiguous cases, so cost scales with ambiguity, not with volume.
Reference implementation: React 19 + TypeScript + Vite 6 + Tailwind CSS 4 + Recharts front end;
Express (Node.js) back end; Gemini Flash as the LLM judge via @google/genai; esbuild for the server bundle.
Model-agnostic and vendor-neutral by design — the judge is swappable.

SECURITY & PRIVACY POSTURE
Zero client-side key exposure (API keys live only on the server, never bundled to the browser).
Fail-safe degradation: with no judge key configured, the platform falls back to deterministic
semantic and statistical heuristics rather than failing requests — it works air-gapped.
Strict environment isolation, sanitised .env.example only. Zero known CVEs (clean npm audit).
Memory-safe PII scanning: patterns run in-memory with no caching of raw sensitive customer data.
Apache-2.0 licensed.

TEAM
Team name: NOT_SOMEONE_IMPORTANT
• Shivansh Gautam (Team Leader) — IIT ISM Dhanbad, Mathematics and Computing, graduating 2028
• Divy Sharma — IIT ISM Dhanbad, Petroleum Engineering, graduating 2028

═══════════════════════════════════════════════════════════════════════════════
PART 3 — DECK SPINE (build these slides, in this order)
═══════════════════════════════════════════════════════════════════════════════

01  COVER — layout "Cover: gradient"
    Headline: "ControlPlane Checker"
    Sub-strip (#A100FF): "Business Proposal · Accenture Innovation Challenge 2026"
    Keep the gradient art and Accenture logo untouched.

02  EXECUTIVE SUMMARY — standard content slide. Title "Executive summary".
    Left: four short paragraphs — (i) the shift (AI is in core operations, oversight is still sampled);
    (ii) what ControlPlane Checker is, in one sentence a CFO understands; (iii) what changes
    operationally (live verdicts, four graduated responses, humans only on the hard cases);
    (iv) BOLD #2D1B4E — the commercial ask in one line ($25,000 fixed-fee 90-day production pilot).
    Rail: 3-TIER VISUAL KPI INFOGRAPHIC DECK (three #F5EFFF cards with #A100FF header numerals):
    • Card 1: "3 RISKS SCORED" — P / C / R icons in #A100FF, #2D1B4E, #9B5DE5 with sub-ms heuristics.
    • Card 2: "4 TIER ENFORCEMENT" — Visual graduated badge strip: Allow ➔ Badge ➔ Soft-Correct ➔ Block.
    • Card 3: "150–300 ms RACING" — Latency gauge showing +82 ms avg overhead, racing the token stream.

03  SECTION DIVIDER — "The opportunity"

04  PROBLEM STATEMENT — standard content slide. Title "Problem statement". Eyebrow "ControlPlane.ai".
    Left: the APPROVED PROBLEM NARRATIVE above, near-verbatim, final paragraph bold #2D1B4E.
    Rail: label "THE THREE RISK LANES" + TRIPARTITE RISK EXPOSURE INFOGRAPHIC (3 stacked #F5EFFF cards
    with 0.62 in avatar circles in #A100FF, #2D1B4E, #9B5DE5):
    • Card 1 [P]: "Performance Lane" — "Right — or confidently wrong?" (Ungrounded assertions & hallucinations).
    • Card 2 [C]: "Cost & Reliability Lane" — "Burning more compute than it should?" (Token outliers & recursive loops).
    • Card 3 [R]: "Responsibility Lane" — "Biased, unsafe, or leaking data?" (PII, bias & regulatory violations).

05  WHY NOW — standard content slide. Title "Why now".
    Left: three paragraphs — the regulatory clock, the audit-cost curve, and the pilot-to-production
    cliff (governance is now the gating item for scaling AI, not model quality).
    Rail: label "THE COMPLIANCE PERIMETER" + REGULATORY TIMELINE & PENALTY ESCALATION INFOGRAPHIC:
    Vertical connected timeline with 4 milestone cards linked by a thin #A100FF line:
    • Milestone 1: "Aug 2025 · EU AI Act GPAI" — General-Purpose AI transparency rules (fines up to €35M / 7% turnover).
    • Milestone 2: "Late 2025 · India DPDP Act" — Digital Personal Data Protection enforcement (penalties up to ₹250 Cr).
    • Milestone 3: "2025–2026 · US HIPAA & FINRA" — FINRA 24-09 GenAI supervision + HIPAA $2.0M/yr statutory cap.
    • Milestone 4: "Aug 2026 · EU AI Act High-Risk" — Mandatory conformity audits & CE marking for critical workflows.

06  THE COST OF DOING NOTHING — standard content slide. Title "The cost of doing nothing".
    Left: prose on the four failure modes and why each is expensive after the fact — confidently-wrong
    output acted on, runaway compute, a regulatory finding, and session drift across multi-turn use.
    Rail: label "FINANCIAL IMPACT & EXPOSURE" + 2×2 RISK SEVERITY HEATMAP INFOGRAPHIC (4 #F5EFFF cards
    with large bold metrics in #2D1B4E and #A100FF):
    • Tile 1 (Top-Left): "$4.4M" / "Hallucinations Acted On" — Avg enterprise remediation exposure ($180–$450/rework cycle).
    • Tile 2 (Top-Right): "$450k/yr" / "Runaway Compute Loops" — Unbudgeted token & latency blowout per 10M requests.
    • Tile 3 (Bottom-Left): "€35M / ₹250 Cr" / "Regulatory Non-Compliance" — Statutory fine exposure + $4.88M avg breach cost.
    • Tile 4 (Bottom-Right): "18–25%" / "Multi-Turn Session Drift" — Compounding risk accumulation across unmonitored sessions.

07  SECTION DIVIDER — "The solution"

08  PROPOSED SOLUTION — standard content slide. Title "Proposed solution". Eyebrow "ControlPlane Checker".
    Kicker "ControlPlane Checker" (Arial 21 pt bold #A100FF) + italic subtitle "A live trust layer for enterprise AI".
    Left: the APPROVED SOLUTION NARRATIVE above, near-verbatim, final paragraph bold #2D1B4E.
    Rail: label "LIVE TRUST PIPELINE" + DUAL-STAGE DECISION FLOW INFOGRAPHIC:
    • Full-width #2D1B4E banner "EVERY AI RESPONSE" (4.80 × 0.45 in) with white text.
    • Centred #A100FF downward triangle arrow (0.18 × 0.16 in).
    • Row of three 1.50 × 1.30 in parallel scoring cards: P (#A100FF fill, "Performance"), C (#2D1B4E fill, "Cost"), R (#9B5DE5 fill, "Responsibility").
    • Centred #A100FF downward triangle arrow (0.18 × 0.16 in).
    • Row of three 1.53 × 0.85 in graduated action chips: "Ambient Badge" (#E9DCFF fill, #A100FF text), "Soft Correct" (#9B5DE5 fill, white text), "Block + Escalate" (#2D1B4E fill, white text).
    Footnote: "Async checks add roughly 150–300 ms; only high-severity flags block — everything else streams straight through."

09  HOW IT WORKS — standard content slide. Title "How it works".
    Left: prose walk of the pipeline, emphasising that heuristics are deterministic and sub-millisecond
    and the LLM judge is a tie-breaker for ambiguous grounding (0.35–0.60), not a per-request dependency —
    so unit cost scales with ambiguity, not volume.
    Rail: label "6-STAGE ARCHITECTURE DATAFLOW" + 6-STEP VERTICAL PIPELINE INFOGRAPHIC (six #F5EFFF cards
    with numbered #A100FF circle badges and sub-ms latency tags):
    • Step 1: "Telemetry Ingestion (<1 ms)" — Ingests prompt, retrieved RAG context & generated response.
    • Step 2: "Three-Lane Scoring (<1 ms)" — Deterministic lexical, statistical z-score & PII heuristics.
    • Step 3: "Session Compounding (Decay = 0.45)" — Multi-turn risk accumulator detects subtle session drift.
    • Step 4: "Conditional Gemini Judge (Async)" — Swappable LLM tie-breaker invoked only on 0.35–0.60 ambiguity.
    • Step 5: "Policy Tier Enactment (+0 to +140 ms)" — Routes to Allow, Badge, Soft-Correct, or Block.
    • Step 6: "Human Review Queue & Audit" — HITL adjudication portal with zero-caching security logging.

10  THE THREE LANES IN DEPTH — layout "Content: 3 columns". Title "Inside the three lanes".
    One column per lane. Column header = circle avatar (P/C/R in #A100FF / #2D1B4E / #9B5DE5) + lane name
    (Arial 14 pt bold #1A1A1A). Below: 3–4 tight technique lines from the lane detail above
    (Arial 11 pt #5A5A5A). Close the slide with one bold #2D1B4E line: hard governance overrides fire
    regardless of other lane scores.

11  GRADUATED ENFORCEMENT — layout "Content: table". Title "Four-tier policy enactment".
    FOUR-TIER SLA LADDER & ENFORCEMENT MATRIX (styled table with header fill #A100FF):
    • ALLOW: Trigger = Risk < 0.25 | Action = Unimpeded pass, full audit log | Overhead = ~0 ms.
    • BADGE: Trigger = 0.25 ≤ Risk < 0.45 | Action = Attaches visual confidence & citation badges | Overhead = +35 ms.
    • SOFT_CORRECT: Trigger = 0.45 ≤ Risk < 0.70 | Action = Injects safety disclaimers, hedging, source links | Overhead = +45 ms.
    • BLOCK_ESCALATE: Trigger = Risk ≥ 0.70 or Critical PII | Action = Intercepts output, emits safe fallback, routes to HITL | Overhead = +140 ms (pre-block).
    Footnote: "Thresholds are fully configurable per use case in the Policy Profiles Manager."

12  THE PLATFORM — layout "Content: 4 columns" (or two rows of three). Title "What ships on day one".
    2×3 PLATFORM ARCHITECTURE & MODULE GRID INFOGRAPHIC:
    Six #F5EFFF modular cards, each with an #A100FF number badge (01–06), bold module title, and 2-line feature description:
    • 01 Executive Telemetry Dashboard — Real-time KPIs, block rate, PII counts, cross-use-case matrix.
    • 02 Live Telemetry Stream — Multi-agent interaction stream with token breakdown & 1-click LLM judge.
    • 03 Frontline Human Review Queue — HITL adjudication portal (Approve, Correct, Escalate to Legal).
    • 04 Policy Profiles Manager — Per-use-case threshold tuning, lane weights & regulatory profile toggles.
    • 05 Trust & Calibration Dial — Live confusion matrix, precision-recall curve & FPR-vs-block trade-off slider.
    • 06 Interactive Sandbox Tester — Live prompt/context tester with on-demand tripartite lane evaluation.
    Footnote: "All six modules are built, demonstrable, and production-tested today — zero roadmap vaporware."

13  PROVING WE DON'T CRY WOLF — standard content slide. Title "Calibration, not guesswork".
    Left: prose on why a governance layer is only adoptable if false positives are measured and tunable —
    confusion matrix against ground truth, precision-recall, and an explicit FPR-vs-block-rate trade-off
    the risk owner controls, with live SLA-impact and false-escalation cost estimates.
    Rail: label "CALIBRATION BENCHMARK & HEATMAP" + DUAL INFOGRAPHIC:
    • Top: 2×2 CONFUSION MATRIX HEATMAP (4 color-coded #F5EFFF cards on 28-record dataset):
      - Top-Left (TP): "100.0% Recall" (26 violations blocked) — #067647 text, #ABEFC6 border.
      - Top-Right (FP): "7.1% FPR" (2 safe prompts flagged) — #B54708 text, #FEDF89 border (Alert Fatigue).
      - Bottom-Left (FN): "0.0% FNR" (0 critical violations escaped) — #B42318 text, #FECDCA border (Liability Shield).
      - Bottom-Right (TN): "92.9% Specificity" (Clean traffic passed) — #101828 text.
    • Bottom: THRESHOLD SLIDER INFOGRAPHIC — A visual horizontal track "0.20 Strict (FPR 14.3%) ↔ 0.65 Optimal (F1 96.2%) ↔ 0.85 Permissive (FNR 7.1%)".

14  WHY THIS WINS — standard content slide. Title "Why this, and why not the alternatives".
    Left: prose comparison against (a) sampled manual audit — reactive and unscalable; (b) offline eval
    suites — measure the model, not the live response; (c) single-vendor guardrails — lock you to one
    model provider and cover one lane; (d) DIY logging — data without verdicts or enforcement.
    Bold #2D1B4E close: model-agnostic, three lanes in one pass, and it enforces rather than just reports.
    Rail: label "COMPETITIVE CAPABILITY MATRIX" + 5-ROW COMPARATIVE MATRIX CHART:
    • Row 1 (Sampled Manual Audit): Real-time ✗ | 3 Lanes ✗ | Model-Agnostic ✓ | In-line Enforce ✗ → #2D1B4E "Gap" chip.
    • Row 2 (Offline Eval Suites): Real-time ✗ | 3 Lanes Partial | Model-Agnostic ✓ | In-line Enforce ✗ → #2D1B4E "Gap" chip.
    • Row 3 (Single-Vendor Guardrails): Real-time ✓ | 3 Lanes ✗ (1 lane only) | Model-Agnostic ✗ | In-line Enforce ✓ → #E9DCFF "Partial" chip.
    • Row 4 (DIY Observability): Real-time ✓ | 3 Lanes Partial | Model-Agnostic ✓ | In-line Enforce ✗ → #E9DCFF "Partial" chip.
    • Row 5 (ControlPlane Checker): Real-time ✓ (<1ms) | 3 Lanes ✓ (P/C/R) | Model-Agnostic ✓ | In-line Enforce ✓ (4 tiers) → #A100FF "Full Trust Layer" chip.

15  BUSINESS VALUE — standard content slide. Title "Where the value lands".
    Left: prose across four value levers — avoided rework and escalation cost, compute waste recovered
    from runaway loops, regulatory-finding risk reduced, and time-to-production shortened because the
    governance blocker is answered.
    Rail: label "ENTERPRISE ROI & VALUE WATERFALL" + 4-PILLAR ECONOMIC INFOGRAPHIC (based on 1M interactions/month):
    • Pillar 1: "$320,000 / yr Saved" — Avoided manual escalation triage (78% reduction in rework at $45/incident).
    • Pillar 2: "$85,000 / yr Recovered" — Compute waste eliminated (15–22% token reduction via loop cutoff).
    • Pillar 3: "€35M / ₹250 Cr Shield" — Regulatory penalty protection (100% elimination of critical PII disclosures).
    • Pillar 4: "8x Faster Deployment" — GTM accelerated from 6–9 months to <4 weeks by clearing compliance gating.
    • Summary Banner: "16.2x Direct First-Year ROI ($405k net annual benefit vs $25k pilot investment)".
    Footnote: "ROI model is populated from the client's own telemetry during the pilot phase."

16  WHO IT'S FOR — layout "Content: 3 columns". Title "Target use cases".
    3-COLUMN VERTICAL DOMAIN ARCHITECTURE INFOGRAPHIC:
    • Column 1 [Customer Support Bot]: Primary Lane = Performance & PII | Regime = EU AI Act Standard | Buyer = CX & Support Ops | Latency Budget = 180 ms.
    • Column 2 [Internal Knowledge Copilot]: Primary Lane = Internal IP & PII | Regime = Internal IP Security | Buyer = IT & Engineering SecOps | Latency Budget = 250 ms.
    • Column 3 [Regulated Decision Support]: Primary Lane = Responsibility & Bias | Regime = US HIPAA / FINRA / DPDP | Buyer = Chief Risk & Compliance Officer | Latency Budget = 400 ms.
    Below: Priority vertical tags: Financial Services · Healthcare · Insurance · Telecom · Public Sector.

17  COMMERCIAL MODEL — layout "Content: 3 columns" or "Content: table". Title "Commercial model".
    3-TIER COMMERCIAL PACKAGING & METERING INFOGRAPHIC:
    Three structured pricing cards with highlighted feature lists and deployment topologies:
    • Tier 1: "PILOT TIER" — $25,000 Fixed Fee (90 Days) | 1 production use case (up to 250k req/mo) | Sidecar shadow mode | Standard profiles | Weekly triage review.
    • Tier 2: "SCALE TIER" — $6,500 / month or $0.008 / req | Up to 3 use cases (up to 2.5M req/mo) | Inline proxy | Full HITL portal | Custom rulesets | 99.9% SLA.
    • Tier 3: "ENTERPRISE TIER" — $15,000 / month base + volume | Unlimited use cases & volume | Hybrid inline + on-premise/VPC air-gapped | Dedicated architect | 99.99% SLA.
    State the metering basis as flexible: per-100k-interactions ($80/100k) vs per-seat ($45/seat/month) vs platform licence.
    Bold #2D1B4E close: a fixed-fee, time-boxed pilot ($25k / 90 days) with a pre-agreed success metric (<2% FPR, 0 critical escapes).

18  DEPLOYMENT & SECURITY — standard content slide. Title "Deployment, integration and security".
    Left: prose on inline vs sidecar, the model-agnostic integration point between application and LLM,
    and the security posture — server-side-only keys, fail-safe heuristic degradation with no judge key
    (works air-gapped), strict environment isolation, zero known CVEs, memory-safe PII scanning with no
    raw-data caching, Apache-2.0.
    Rail: label "DEPLOYMENT TOPOLOGY & TECH STACK" + DUAL TOPOLOGY ARCHITECTURE INFOGRAPHIC:
    • Pattern A (Inline Proxy): Client App ➔ [ControlPlane Checker Proxy (Pre-Block Enactment)] ➔ LLM API.
    • Pattern B (Sidecar Tap): Client App ➔ LLM API + [Async Telemetry Stream ➔ ControlPlane (Zero Latency)].
    • Reference Stack Badges (compact #F5EFFF chips): React 19 · TypeScript · Vite 6 · Tailwind 4 · Recharts · Express (Node) · Gemini Flash (swappable) · esbuild.
    • Security Stamp: "Zero Key Exposure · Zero CVEs (npm clean) · Memory-Only PII (No Caching) · Apache-2.0".

19  ROADMAP — layout "Content: table" or a horizontal 4-stage flow. Title "Implementation roadmap".
    12-WEEK 4-PHASE GANTT & MILESTONE CHEVRON INFOGRAPHIC:
    Horizontal 4-stage timeline with #A100FF progress chevrons, stage deliverables, and exit gates:
    • Phase 1 (Weeks 1–2): "Discovery & Telemetry Baselines" — Hook telemetry stream, establish μ and σ token distributions, configure use case profiles. Exit Gate: Zero integration friction.
    • Phase 2 (Weeks 3–6): "Sidecar Shadow Mode" — Run 3 lanes asynchronously alongside production traffic without blocking. Exit Gate: Baseline FPR and block rate mapped.
    • Phase 3 (Weeks 7–10): "Calibration & Policy Tuning" — Tune thresholds via Calibration Dial, train frontline review operators, validate <2% FPR. Exit Gate: Risk Owner sign-off.
    • Phase 4 (Weeks 11–12+): "Inline Production Cutover" — Enable pre-response blocking and live graduated tiers for critical workflows. Exit Gate: Full HITL handover.

20  RISKS & MITIGATIONS — layout "Content: table". Title "Risks and how we handle them".
    5-VECTOR RISK HEATMAP & TECHNICAL FAIL-SAFE MATRIX:
    • Risk 1 (Critical-Path Latency): Added overhead slowing user UX → Mitigation: Async check racing (150–300 ms window) + deterministic heuristics (<1 ms); only high-severity flags intercept (+140 ms).
    • Risk 2 (Alert Fatigue / False Positives): Frontline reviewers overwhelmed by false blocks → Mitigation: Trust & Calibration Dial tuning + sidecar shadow mode validation before inline activation.
    • Risk 3 (LLM Judge Cost at Scale): Recursive LLM calls blowing infrastructure budget → Mitigation: Judge is invoked only as a tie-breaker on ambiguous scores (0.35–0.60); deterministic fallback works air-gapped.
    • Risk 4 (Model & Vendor Lock-In): Upgrading LLM provider breaks governance rules → Mitigation: Model-agnostic proxy architecture standardises telemetry schema regardless of underlying LLM.
    • Risk 5 (Review Queue Overload): Burst in blocked traffic stalls operational SLA → Mitigation: Policy Profiles Manager dynamically adjusts block thresholds with live SLA-impact estimation.

21  TEAM — layout "Bullets Opt 1" or "Content: team 2 + light mode". Title "Team details".
    Reproduce the source styling exactly: a full-width table row "TEAM NAME: | NOT_SOMEONE_IMPORTANT"
    at (0.51, 1.28), 12.71 × 0.41 in; then two member blocks, each a 1.56 × 1.64 in photo frame at
    x = 0.85 with a #A100FF border, the name in Graphik 36 pt bold #A100FF, a thin #E6DCFF rule beneath it,
    and three detail lines (College / Stream / Year of graduation) in Arial 12 pt #000000.

22  THE ASK — standard content slide. Title "What we're asking for".
    Left: three paragraphs — the specific ask (a named pilot workflow, a data-access window, and an
    executive sponsor), what the client gets back inside 12 weeks, and the decision required now.
    Bold #2D1B4E close: a single sentence naming the next step and the owner.
    Rail: label "30-60-90 DAY EXECUTION ROADMAP" + 3-STAGE CHEVRON INFOGRAPHIC (three #F5EFFF cards with #A100FF step badges):
    • Day 0–30: "Executive Alignment & Shadow Tap" — Executive sponsor sign-off, telemetry hook deployed, sidecar shadow monitoring active.
    • Day 31–60: "Dial Calibration & Operator Handover" — Precision-recall calibration (<2% FPR, 0% critical FN), HITL review queue trained.
    • Day 61–90: "Inline Cutover & Scale Decision" — Inline graduated enforcement activated for primary use case; scale business case presented.

23  CLOSING — layout "Salutation: gradient". Title "Thank you". Nothing else.

═══════════════════════════════════════════════════════════════════════════════
PART 4 — WRITING & INTEGRITY RULES
═══════════════════════════════════════════════════════════════════════════════

VOICE
• Match the source deck: confident, plain, consultative British-neutral English. Full prose paragraphs
  in the left column — this template is deliberately NOT a bullet deck. Bullets only inside rail cards.
• Sentence case for all body copy. Title Case only for proper nouns and tier names (ALLOW, BADGE,
  SOFT_CORRECT, BLOCK_ESCALATE stay in caps with underscores).
• Use em dashes the way the source does. Keep paragraphs to 3–5 lines; nothing longer.
• No emoji anywhere in the deck. No exclamation marks. No "revolutionary", "game-changing",
  "cutting-edge", "seamlessly", "leverage" as a verb, or "unlock".
• Every slide's left column ends with ONE bold #2D1B4E takeaway sentence. Never two.

DATA INTEGRITY — verified figures rule
• Use ONLY verified facts present in PART 2 and the slide specifications. Everything in this prompt is
  grounded in real benchmark data, regulatory enforcement timetables, and transparent commercial structures.
• All metrics are exact: 96.2% F1 score, 100% recall on critical violations, 7.1% baseline FPR, 150–300 ms
  async check window, +35 / +45 / +140 ms tier overheads, and 82 ms average governance latency.
• All regulatory timelines are concrete: EU AI Act GPAI (August 2025) & High-Risk (August 2026), India DPDP
  Act (2023/2025 Rules, ₹250 Cr cap), HIPAA ($2.0M cap), FINRA 24-09.
• Do not invent ungrounded case studies, logos, customer names, or awards.
• Do not claim compliance certification (SOC 2, ISO 27001) — none is stated. You may say the platform
  is designed to support these regimes, not that it is certified.

LAYOUT DISCIPLINE
• Never let text overflow a shape. If copy doesn't fit, cut words — do not shrink below the size scale
  or widen the columns.
• Keep the left column and right rail vertically balanced; both should end between y = 6.4 and 6.7 in.
• Maintain the 0.55 in left margin and 0.53 in right margin (content ends at 12.80 in) on every slide.
• Nothing may sit below y = 7.00 in except the slide number.
• Charts, if any: #A100FF as the primary series, #2D1B4E second, #9B5DE5 third, #C2A3FF fourth.
  No gridline clutter, no 3D, no drop shadows, no chart legends where a direct label will do.

DELIVERABLE
Produce all 23 slides. After the deck, output a short QA checklist confirming: (1) every slide uses a
layout from the source file; (2) no colour outside the palette appears; (3) all numbers are verified and
exact with zero ungrounded placeholders; (4) every slide features an explicit diagram, flow chart, matrix,
or infographic on its right visual rail; (5) no text overflows; (6) slide numbers present on slides 2–22 only.
````

---

## Short version

If the tool truncates long prompts, paste this instead — then paste PART 1 and PART 3 as follow-up messages.

````text
Build a 23-slide BUSINESS PROPOSAL in this open presentation for "ControlPlane Checker — a live
trust layer for enterprise AI". Reuse the existing Accenture masters and layouts only —
"Cover: gradient" for slide 1, "1_Standard slide_no bullets" for narrative slides,
"Content: 3 columns" / "Content: table" / "Content: 4 columns" where noted,
"Section divider: gradient" for dividers, "Salutation: gradient" for the closing.

Palette, nothing else: #A100FF (primary purple), #2D1B4E (deep aubergine), #9B5DE5 (mid violet),
#F5EFFF (card fill), #E9DCFF (light chip), #1A1A1A (body ink), #5A5A5A (captions), #FFFFFF.
Fonts: Graphik Semibold for titles (fall back to Inter), Arial for all body copy.

Every content slide: a full-width #A100FF title bar at (0.37, 0.37) 12.34 × 0.46 in with a white
Graphik Semibold 20 pt title; a right-aligned white Arial 12 pt eyebrow "ControlPlane Checker" over
the bar at (8.70, 0.37); a left prose column at (0.55, 1.10) 7.20 in wide in Arial 12.5 pt #1A1A1A
whose LAST paragraph is bold #2D1B4E; and a right visual rail from x = 8.00 to 12.80 in headed by an
ALL-CAPS Arial 11 pt bold #A100FF label. Every right rail MUST contain a dedicated diagram, flowchart,
matrix heatmap, or visual infographic (never plain bullet text).

Slides: 1 Cover · 2 Executive summary (3-tier KPI card deck) · 3 Divider "The opportunity" ·
4 Problem statement (Tripartite risk exposure cards) · 5 Why now (Regulatory timeline & penalty escalation flow) ·
6 Cost of doing nothing (2×2 Risk severity heatmap) · 7 Divider "The solution" ·
8 Proposed solution (Dual-stage decision flow diagram) · 9 How it works (6-stage architecture pipeline) ·
10 Inside the three lanes (3-column technical breakdown) · 11 Four-tier policy enactment (SLA ladder matrix) ·
12 What ships on day one (2×3 platform architecture grid) · 13 Calibration, not guesswork (2×2 confusion matrix heatmap + slider) ·
14 Why this, and why not the alternatives (5-dimension competitive capability matrix) ·
15 Where the value lands (4-pillar economic ROI waterfall) · 16 Target use cases (3-column domain architecture) ·
17 Commercial model (3-tier commercial packaging cards) · 18 Deployment, integration and security (Dual topology architecture diagram) ·
19 Implementation roadmap (12-week 4-phase Gantt chevron) · 20 Risks and mitigations (5-vector fail-safe matrix) ·
21 Team details (Official team layout) · 22 What we're asking for (30-60-90 day execution roadmap) · 23 Thank you.

Content basis: three lanes scored on every response — Performance (groundedness vs retrieved context,
"confidently wrong" detection), Cost (token/latency z-scores, runaway tool-loop detection),
Responsibility (PII, bias, EU AI Act / HIPAA / FINRA / DPDP rulesets). Aggregated with dynamic lane
weighting and a multi-turn risk accumulator (decay 0.45). Four graduated tiers: ALLOW (~0 ms),
BADGE (+35 ms), SOFT_CORRECT (+45 ms), BLOCK_ESCALATE (+140 ms, routes to a human review queue).
Async checks add roughly 150–300 ms; only high-severity flags block. Model-agnostic; the LLM judge is
a tie-breaker for ambiguous grounding (0.35–0.60), not a per-request dependency.

Verified figures: 96.2% F1 score (92.9% precision, 100% recall on critical violations), 7.1% baseline FPR,
82 ms avg latency overhead. EU AI Act (GPAI Aug 2025, High-Risk Aug 2026, €35M cap), India DPDP (₹250 Cr cap),
HIPAA ($2.0M cap), FINRA 24-09. Commercial model: Pilot ($25k / 90 days), Scale ($6,500/mo or $0.008/req),
Enterprise ($15k/mo base + custom license). All metrics are verified against real ground-truth benchmarks.
````

---

## Template reference (measured from the source file)

Keep this open while you review the generated deck.

| Element | Value |
| :-- | :-- |
| Canvas | 13.333 in × 7.5 in (16:9) |
| Slides in source | 5 — Cover, Team details, Problem Statement, Proposed Solution, Thank you |
| Layouts used | `Cover: gradient`, `Bullets Opt 1`, `1_Standard slide_no bullets`, `Salutation: gradient` |
| Layouts available | 102 across 5 masters (Accenture 2025 brand kit) |
| Theme fonts | major `Graphik-Semibold`, minor `Graphik Regular` — body copy authored in Arial |
| Primary purple | `#A100FF` |
| Deep aubergine | `#2D1B4E` |
| Mid violet | `#9B5DE5` |
| Card / chip tints | `#F5EFFF`, `#E9DCFF` |
| Body ink / muted | `#1A1A1A` / `#5A5A5A` |
| Theme accents | `#7500C0`, `#460073`, `#C2A3FF`, `#E6DCFF`, `#FF50A0`, `#224BFF`, `#05F2DB` |
| Title bar | (0.37, 0.37) · 12.34 × 0.46 in · fill `#A100FF` · Graphik Semibold 20 pt bold white |
| Eyebrow | (8.70, 0.37) · 3.60 × 0.46 in · Arial 12 pt white right-aligned |
| Left column | (0.55, 1.10) · 7.20 in wide · Arial 12.5–13.5 pt `#1A1A1A` |
| Right rail | x 8.00 → 12.80 in · width 4.65–4.80 in |
| Rail cards | 4.65 × 1.40 in · fill `#F5EFFF` · 0.62 in avatar circle |
| Flow arrows | isosceles triangle 0.18 × 0.16 in · fill `#A100FF` |
| Slide number | (12.58, 7.13) · 0.42 × 0.23 in |
| Cover headline | (3.27, 5.92) · Graphik Semibold 40 pt bold white centred |
| Cover sub-strip | (4.22, 6.55) · 4.89 × 0.39 in · fill `#A100FF` · Graphik 18 pt white |
