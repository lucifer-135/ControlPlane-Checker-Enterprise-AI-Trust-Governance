# 🛡️ ControlPlane Checker
### Enterprise AI Trust, Governance & Observability Control Plane

[![CI](https://github.com/lucifer-135/ControlPlane-Checker-Enterprise-AI-Trust-Governance/actions/workflows/ci.yml/badge.svg)](https://github.com/lucifer-135/ControlPlane-Checker-Enterprise-AI-Trust-Governance/actions/workflows/ci.yml)
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)
[![React](https://img.shields.io/badge/React-19.0-61DAFB?logo=react&logoColor=black)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![SQLite / libSQL](https://img.shields.io/badge/Database-SQLite_3-003B57?logo=sqlite&logoColor=white)](https://sqlite.org/)
[![Express](https://img.shields.io/badge/Express-4.21-000000?logo=express&logoColor=white)](https://expressjs.com/)
[![Google Gemini API](https://img.shields.io/badge/Google_Gemini-3.6_Flash-8E75B2?logo=google&logoColor=white)](https://ai.google.dev/)
[![Tests](https://img.shields.io/badge/Tests-72_passed-brightgreen)]()
[![Code Style](https://img.shields.io/badge/Code_Style-Prettier-ff69b4?logo=prettier&logoColor=white)](https://prettier.io/)

> A high-throughput, model-agnostic enterprise governance and trust layer that scores AI interactions across **Performance**, **Cost**, and **Responsibility** in real-time, enforcing policy tiers (`ALLOW`, `BADGE`, `SOFT_CORRECT`, `BLOCK_ESCALATE`) with Gemini LLM Judge tie-breaking.

---

## 📌 Table of Contents
1. [Overview & Problem Statement](#-overview--problem-statement)
2. [Solution Architecture](#-solution-architecture)
3. [The Three Governance Lanes](#-the-three-governance-lanes)
4. [Four-Tier Policy Enactment](#-four-tier-policy-enactment)
5. [Database & Audit Ledger](#-database--audit-ledger)
6. [REST API Reference](#-rest-api-reference)
7. [Key Platform Features](#-key-platform-features)
8. [Technology Stack & Dependencies](#-technology-stack--dependencies)
9. [Security & Privacy Posture](#-security--privacy-posture)
10. [Getting Started & Execution Instructions](#-getting-started--execution-instructions)
11. [Project Directory Layout](#-project-directory-layout)
12. [Contributing](#-contributing)
13. [License](#-license)

---

## 🚀 Overview & Problem Statement

Enterprises deploying Generative AI models into production encounter four catastrophic failure modes:
1. **Confidently Wrong Hallucinations**: Models asserting incorrect facts with high linguistic confidence (e.g., claiming non-existent refund policies or false regulatory exemptions).
2. **Operational & Cost Blowouts**: Runaway recursive tool calls and token outliers draining infrastructure budgets.
3. **Regulatory & PII Violations**: Silent leakage of Personally Identifiable Information (SSN, credit cards, customer emails) and biased decisions violating the EU AI Act, HIPAA, FINRA, or India DPDP Act.
4. **Session Drift**: Compounding risk across multi-turn user sessions where individual turns appear benign but cumulative interactions violate enterprise boundaries.

**ControlPlane Checker** acts as an inline/sidecar trust proxy that intercepts AI prompts, retrieved context documents, and generated responses. It calculates composite risk scores in sub-millisecond heuristics, dynamically escalates ambiguous cases to a live **Gemini 3.6 Flash LLM Judge**, and enforces granular policy guardrails before outputs reach end users.

---

## 🏗️ Solution Architecture

```mermaid
flowchart TD
    subgraph Ingestion["1. Telemetry Ingestion"]
        Req["AI Interaction\n(Prompt + Retrieved Context + Response)"]
    end

    subgraph ScoringEngine["2. Three-Lane Real-Time Scoring Engine"]
        direction LR
        L1["<b>Lane 1: Performance</b><br/>• Lexical/Semantic Overlap<br/>• Certainty vs. Support Mismatch<br/>• 'Confidently Wrong' Detector"]
        L2["<b>Lane 2: Cost & Reliability</b><br/>• Token Z-Score Outliers<br/>• Latency Drift Outliers<br/>• Runaway Tool Call Loops"]
        L3["<b>Lane 3: Responsibility</b><br/>• Regulatory Rulesets (EU, US, IN)<br/>• PII Regex & Pattern Scanner<br/>• Bias, Redlining & Toxicity"]
    end

    subgraph CompositeCompounding["3. Aggregation & Session Compounding"]
        Weights["Dynamic Lane Weighting & Overlap Multipliers"]
        Accumulator["Multi-Turn Exponential Risk Accumulator (Decay = 0.45)"]
    end

    subgraph LLMJudge["4. Asynchronous Gemini LLM Judge"]
        JudgeTrigger{"Ambiguous Grounding<br/>or Tie-Breaker?"}
        GeminiFlash["Gemini 3.6 Flash / 2.5 Flash<br/>Autonomous Evaluation Judge"]
    end

    subgraph PolicyTiers["5. Policy Tier Enactment"]
        Tier{"Composite Risk Score vs. Policy Thresholds"}
        T1["✅ ALLOW<br/>Zero overhead, full audit log"]
        T2["🏷️ BADGE<br/>Attach confidence & citation tags"]
        T3["⚠️ SOFT_CORRECT<br/>Inject safety hedging & disclaimer"]
        T4["🛑 BLOCK_ESCALATE<br/>Pre-response block & HITL review queue"]
    end

    subgraph HITL["6. Human-in-the-Loop Review Queue"]
        ReviewQueue["Frontline Review Portal<br/>(Adjudicate, Overturn, Escalate)"]
    end

    Req --> ScoringEngine
    L1 --> Weights
    L2 --> Weights
    L3 --> Weights
    Weights --> Accumulator
    Accumulator --> JudgeTrigger
    JudgeTrigger -- Yes --> GeminiFlash
    GeminiFlash --> Tier
    JudgeTrigger -- No --> Tier
    Tier --> T1
    Tier --> T2
    Tier --> T3
    Tier --> T4
    T4 --> ReviewQueue
```

---

## 🚦 The Three Governance Lanes

### 1. 🎯 Performance & Groundedness Lane
- **Lexical & Semantic Context Overlap**: Measures Jaccard and n-gram overlap between generated claims and retrieved grounding snippets.
- **Linguistic Certainty Extraction**: Scans for high-conviction asserting keywords (*"with 100% legal certainty"*, *"guaranteed"*, *"without a doubt"*, *"strictly mandates"*) versus hedging phrases (*"might be"*, *"according to documentation"*).
- **Certainty vs. Support Mismatch**: Calculates the delta between assertiveness and contextual backing. Discrepancies generate a `"Confidently Wrong"` flag.
- **LLM Judge Tie-Breaker**: Automatically hands off ambiguous cases (grounding scores between 0.35–0.60) to Gemini Flash for deep semantic verification.

### 2. ⚡ Cost & Operational Reliability Lane
- **Z-Score Outlier Analysis**: Benchmarks token counts ($Z_{tokens}$) and latency ($Z_{latency}$) against per-use-case historical normal distributions ($\mu, \sigma$).
- **Runaway Loop Detection**: Flags recursive agentic patterns where tool invocations exceed threshold bounds ($N_{tools} > 6$) or completion tokens spike $> 3.5\sigma$.
- **Financial Risk Indexing**: Converts cost anomalies into normalized risk scores to prevent compute budget exhaustion.

### 3. ⚖️ Responsibility, PII & Regulatory Compliance Lane
- **Jurisdiction-Specific Profiles**:
  - **EU AI Act Standard**: Strictest PII masking, transparency tagging, mandatory high-risk flagging.
  - **US HIPAA & FINRA**: Patient health identifiers, social security, account numbers, and financial advice disclaimers.
  - **India DPDP Act**: Digital personal data protection, Aadhaar patterns, strict phone/email masking.
  - **Internal IP Security**: Redacts AWS access keys, Bearer tokens, private endpoints, and proprietary source code markers.
- **Fairness & Bias Detection**: Identifies algorithmic redlining (e.g., zip-code-based loan denial heuristics, demographic stereotyping).
- **Hard Governance Overrides**: Non-negotiable violations (SSN exposure, credit card leaks, explicit discrimination) immediately trigger `BLOCK_ESCALATE` regardless of other lane scores.

---

## 🎚️ Four-Tier Policy Enactment

| Tier | Condition / Threshold | Enactment Action | Latency Overhead |
| :--- | :--- | :--- | :--- |
| **`ALLOW`** | Composite Risk $< \theta_{badge}$ | Interaction passes unimpeded; detailed audit telemetry persisted. | $\approx 0\text{ ms}$ |
| **`BADGE`** | $\theta_{badge} \le \text{Risk} < \theta_{soft}$ | Appends visual confidence indicators and source verification badges to UI. | $+35\text{ ms}$ |
| **`SOFT_CORRECT`** | $\theta_{soft} \le \text{Risk} < \theta_{block}$ | Prepends safety disclaimers, inserts hedging syntax, or links retrieved context docs. | $+45\text{ ms}$ |
| **`BLOCK_ESCALATE`** | $\text{Risk} \ge \theta_{block}$ OR Critical Policy Violation | Intercepts response before rendering; generates safe fallback message; routes to HITL Queue. | $+140\text{ ms}$ (pre-block) |

---

## 🖥️ Key Platform Features

### 📊 1. Executive Telemetry Dashboard (`DashboardTab.tsx`)
- High-level KPIs: Total Audited Volume, Block Rate, Confidently Wrong Hallucination Rate, PII Leaks Blocked, and Average Governance Overhead.
- Interactive multi-dimensional charts: Risk Distribution by Lane (Recharts), Hourly Interaction Volume vs. Blocks, and Cross-Use-Case Governance Matrix.
- Quick Triage widget displaying the latest high-risk escalations with instant review actions.

### ⚡ 2. Live Telemetry Stream (`LiveFeedTab.tsx`)
- Real-time simulation of incoming enterprise AI interactions across Customer Support, Internal Copilots, and Decision Support agents.
- Filter by Use Case, Verdict Tier, and Risk Level.
- Interactive telemetry inspection modal with token breakdown, latency gauges, triggering span highlights, and 1-click **Gemini LLM Judge** execution.

### 🧑‍⚖️ 3. Frontline Human Review Queue (`ReviewQueueTab.tsx`)
- Human-in-the-Loop (HITL) adjudication portal for blocked or escalated interactions.
- Side-by-side prompt, retrieved context, and model output view with colored span highlights.
- 1-click arbitration actions: **Approve & Release**, **Overturn & Correct**, **Escalate to Legal/Security**, or **Trigger Gemini LLM Judge**.
- Real-time resolution logging and historical audit trail.

### ⚙️ 4. Policy Profiles Manager (`PolicyProfilesTab.tsx`)
- Tailor governance parameters per use-case (`support_bot`, `internal_copilot`, `decision_support`).
- Configure lane weights (Performance vs. Cost vs. Responsibility), trigger thresholds, and regulatory regimes (EU AI Act, HIPAA/FINRA, DPDP).
- Toggle pre-response blocking vs. asynchronous post-generation monitoring.

### 🎯 5. Trust & Calibration Dial (`TrustMetricsTab.tsx`)
- Interactive Confusion Matrix calculating True Positives, False Positives, True Negatives, and False Negatives against synthetic ground truth.
- Precision-Recall Curve and False Positive Rate (FPR) vs. Block Rate trade-off slider.
- Real-time SLA impact estimation and false escalation cost projections.

### 🧪 6. Interactive Sandbox Tester (`InteractionTesterModal.tsx`)
- Live testing harness to input custom prompts, retrieved contexts, and candidate responses.
- Evaluates inputs in real-time across all three lanes and provides on-demand Gemini 3.6 Flash judge evaluations.

---

## 🗄️ Database & Audit Ledger

ControlPlane Checker integrates an **embedded SQLite relational ledger** (powered by `@libsql/client`) providing zero-config local persistence without requiring external database services or Docker dependencies.

```mermaid
erDiagram
    INTERACTIONS ||--|| EVALUATIONS : "audits"
    INTERACTIONS ||--o{ REVIEW_DECISIONS : "adjudicated by"
    POLICY_PROFILES ||--o{ EVALUATIONS : "governs"

    INTERACTIONS {
        string id PK
        string use_case
        string session_id
        int turn_number
        string query_type
        string prompt
        string retrieved_context
        string response
        int token_total
        int latency_ms
        string created_at
    }

    EVALUATIONS {
        string interaction_id PK, FK
        float composite_risk_score
        float session_accumulated_risk
        string verdict
        string overlapping_lanes
        string performance_result
        string cost_result
        string responsibility_result
    }

    REVIEW_DECISIONS {
        string id PK
        string interaction_id FK
        string reviewer
        string action
        string original_verdict
        string new_verdict
        string reviewed_at
    }

    POLICY_PROFILES {
        string use_case PK
        string name
        string config_json
        string updated_at
    }
```

* **Zero Setup Required**: Automatically creates `data/controlplane.db` and seeds baseline interactions on first run.
* **EU AI Act Article 12 Compliance**: Permanent immutable audit logging for all AI interactions and risk scores.
* **HITL Decision Persistence**: Saves Frontline Human Review decisions across sessions.

---

## 🌐 REST API Reference

The Express backend provides a complete RESTful interface for integration into external LLM gateways and pipelines:

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/api/health` | System health, database connection state, and interaction counts |
| `GET` | `/api/interactions` | Query all audited interactions with optional `?useCase=` filtering |
| `POST` | `/api/interactions` | Ingest new prompt/response telemetry, run 3-lane evaluation, persist to DB |
| `GET` | `/api/reviews` | Fetch all historical Human-in-the-Loop review adjudications |
| `POST` | `/api/reviews` | Submit and persist a compliance officer review decision |
| `GET` | `/api/policies` | Retrieve active policy threshold configurations across use cases |
| `PUT` | `/api/policies/:useCase` | Update and persist customized lane weights and thresholds |
| `POST` | `/api/judge` | Autonomous Gemini 3.6 Flash LLM Judge tie-breaker evaluation |
| `POST` | `/api/reset` | Restore database tables to baseline factory state |

---

## 📦 Technology Stack & Dependencies

### Core Frameworks & Libraries
| Component | Technology | Purpose |
| :--- | :--- | :--- |
| **Frontend Framework** | [React 19](https://react.dev/) + [TypeScript](https://www.typescriptlang.org/) | Type-safe UI state management and component lifecycle |
| **Database & Persistence** | [SQLite](https://sqlite.org/) via [@libsql/client](https://www.npmjs.com/package/@libsql/client) | Embedded relational audit ledger & decision persistence |
| **Backend Server** | [Express](https://expressjs.com/) (Node.js) | REST API endpoints, Vite middleware proxy, and static file serving |
| **AI LLM Judge** | [@google/genai](https://www.npmjs.com/package/@google/genai) | Server-side integration with Gemini 3.6 / 2.5 Flash models |
| **Unit Testing** | [Vitest](https://vitest.dev/) (72 tests) | Comprehensive unit & database integration test coverage |
| **Build Tooling** | [Vite 6](https://vitejs.dev/) + [esbuild](https://esbuild.github.io/) | Sub-millisecond HMR and dual client/server bundling |
| **Styling** | [Tailwind CSS 4](https://tailwindcss.com/) | Modern design system, glassmorphism, fluid responsive layouts |
| **Data Visualization** | [Recharts](https://recharts.org/) | Interactive responsive telemetry and metric charts |
| **Icons & UI FX** | [Lucide React](https://lucide.dev/) + [Motion](https://motion.dev/) | Visual iconography and smooth micro-interactions |

---

## 🔒 Security & Privacy Posture

- **Zero Client-Side Key Exposure**: The `GEMINI_API_KEY` is strictly accessed on the Node.js Express server. No API keys or secret credentials are ever bundled or transmitted to the client browser.
- **Fail-Safe Heuristic Simulation**: In air-gapped environments or scenarios where `GEMINI_API_KEY` is omitted, the platform gracefully switches to deterministic semantic and statistical heuristics without failing requests.
- **Strict Environment Isolation**: All `.env*` files are excluded from version control via `.gitignore`, retaining only a sanitised `.env.example`.
- **Zero Known CVEs**: Verified clean with `npm audit` (0 vulnerabilities).
- **Memory-Safe PII Scanning**: Regular expressions and pattern matchers run locally in memory without caching raw sensitive customer data.

---

## 💻 Getting Started & Execution Instructions

### Prerequisites
- [Node.js](https://nodejs.org/) version `18.0.0` or higher (Node 20+ recommended)
- [npm](https://www.npmjs.com/) or [bun](https://bun.sh/)
- (Optional) A [Google AI Studio Gemini API Key](https://aistudio.google.com/app/apikey) for live LLM Judge features.

---

### Step 1: Clone the Repository
```bash
git clone https://github.com/lucifer-135/ControlPlane-Checker-Enterprise-AI-Trust-Governance.git
cd ControlPlane-Checker-Enterprise-AI-Trust-Governance
```

### Step 2: Install Dependencies
```bash
npm install
```

### Step 3: Configure Environment Variables
Copy the `.env.example` template to `.env`:
```bash
cp .env.example .env
```
Open `.env` in your text editor and provide your Gemini API key (optional):
```env
GEMINI_API_KEY="your_actual_gemini_api_key"
PORT=3000
NODE_ENV=development
APP_URL="http://localhost:3000"
```

### Step 4: Run the Development Server
```bash
npm run dev
```
Open your browser and navigate to:
```
http://localhost:3000
```

---

### Step 5: Production Build & Execution
To compile and run the optimized production bundle:
```bash
# 1. Build Vite client assets and compile backend server bundle
npm run build

# 2. Start the production server
npm start
```

### Additional Available Scripts
| Script | Description |
| :--- | :--- |
| `npm run lint` | Runs ESLint static analysis across the codebase |
| `npm run lint:types` | Executes TypeScript type-checking (`tsc --noEmit`) |
| `npm test` | Runs the full Vitest unit test suite (72 tests) |
| `npm run test:watch` | Runs tests in watch mode for TDD workflow |
| `npm run test:coverage` | Generates test coverage report with V8 provider |
| `npm run format` | Formats all files with Prettier |
| `npm run format:check` | Checks formatting without modifying files (CI) |
| `npm run preview` | Previews Vite production build locally |
| `npm run clean` | Cleans generated `dist/` directory |

---

## 📂 Project Directory Layout

```
ControlPlane-Checker/
├── .env.example              # Sanitized environment template
├── .github/workflows/ci.yml  # GitHub Actions CI pipeline
├── .gitignore                # Comprehensive Git exclusion rules
├── .prettierrc               # Prettier formatting configuration
├── CONTRIBUTING.md           # Developer contribution guidelines
├── Dockerfile                # Multi-stage production Docker build
├── eslint.config.js          # ESLint 9 flat config (TypeScript + React)
├── index.html                # HTML entrypoint & typography configuration
├── package.json              # Dependencies, build scripts & metadata
├── tsconfig.json             # TypeScript compiler settings
├── vite.config.ts            # Vite & Tailwind CSS bundler configuration
├── vitest.config.ts          # Vitest unit test configuration
├── server.ts                 # Express server & Gemini LLM Judge backend proxy
├── data/                     # Embedded SQLite database storage (gitignored)
├── src/
│   ├── main.tsx              # React DOM mounting
│   ├── App.tsx               # Main application controller & tab orchestration
│   ├── types.ts              # Domain types (Lanes, Tiers, Policies, Telemetry)
│   ├── index.css             # Tailwind 4 theme & custom glassmorphism styles
│   ├── server/               # Backend Database & Persistence
│   │   └── db.ts             # SQLite / libSQL database schema, seeding & queries
│   ├── components/           # UI Components & Tabs
│   │   ├── AmbientShaderBackground.tsx # WebGL ambient background
│   │   ├── DashboardTab.tsx            # Executive KPI & overview charts
│   │   ├── GeminiJudgeResultCard.tsx   # LLM Judge evaluation breakdown card
│   │   ├── Header.tsx                  # Global navigation bar & tester trigger
│   │   ├── InteractionTesterModal.tsx  # Live interactive sandbox tester
│   │   ├── LiveFeedTab.tsx             # Real-time telemetry feed & stream
│   │   ├── PolicyProfilesTab.tsx       # Per-use-case policy threshold editor
│   │   ├── ReviewQueueTab.tsx          # Frontline HITL adjudication portal
│   │   ├── TrustMetricsTab.tsx         # Confusion matrix & calibration dial
│   │   ├── VerdictBadge.tsx            # Visual tier badge component
│   │   └── WavyDots.tsx                # Visual indicator effects
│   ├── data/                 # Baseline & Synthetic Datasets
│   │   ├── baselines.ts                # Token & latency normal distributions
│   │   └── interactions.ts             # Multi-domain synthetic interaction dataset
│   └── lib/                  # Core Business Logic & Decision Engine
│       ├── __tests__/                  # Unit test suite (72 tests)
│       │   ├── performanceLane.test.ts  # Groundedness & Confidently Wrong tests
│       │   ├── costLane.test.ts         # Z-score & runaway loop tests
│       │   ├── responsibilityLane.test.ts # PII, bias & regulatory tests
│       │   ├── decisionEngine.test.ts  # Composite scoring & tier mapping tests
│       │   ├── metrics.test.ts         # Confusion matrix & precision-recall tests
│       │   └── db.test.ts              # SQLite database CRUD & seeding tests
│       ├── api.ts              # Frontend API client with offline fallback
│       ├── decisionEngine.ts   # 3-lane aggregator & session compounding
│       ├── metrics.ts          # Confusion matrix & PR calculations
│       ├── policyProfiles.ts   # Default policy profile definitions
│       └── lanes/              # Individual Lane Evaluators
│           ├── costLane.ts     # Z-score outlier & runaway loop detector
│           ├── performanceLane.ts # Grounding & Confidently Wrong detector
│           └── responsibilityLane.ts # PII scanner, bias & regulatory rulesets
└── dist/                     # Production build output (generated)
```

---

## 🤝 Contributing

Contributions are welcome! Please read the [Contributing Guide](CONTRIBUTING.md) for development setup, coding standards, and PR guidelines.

---

## 📄 License

This project is licensed under the **Apache-2.0 License**. See [LICENSE](LICENSE) for details.
