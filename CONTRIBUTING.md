# Contributing to ControlPlane Checker

Thank you for your interest in contributing! This document provides guidelines for development and contribution.

## Development Setup

### Prerequisites

- [Node.js](https://nodejs.org/) v18+ (v20+ recommended)
- [npm](https://www.npmjs.com/)
- (Optional) [Docker](https://www.docker.com/) for containerized development

### Getting Started

```bash
# Clone the repository
git clone https://github.com/lucifer-135/ControlPlane-Checker-Enterprise-AI-Trust-Governance.git
cd ControlPlane-Checker-Enterprise-AI-Trust-Governance

# Install dependencies
npm install

# Copy environment config
cp .env.example .env

# Start development server
npm run dev
```

The app will be available at `http://localhost:3000`.

## Code Quality

### Linting & Formatting

This project uses **ESLint** for static analysis and **Prettier** for formatting.

```bash
# Run ESLint
npm run lint

# Run TypeScript type-check
npm run lint:types

# Format code with Prettier
npm run format

# Check formatting (CI)
npm run format:check
```

### Testing

Unit tests are written with **Vitest** and cover the core governance engine.

```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

# Run tests with coverage report
npm run test:coverage
```

### Pre-commit Checklist

Before submitting a PR, ensure:

1. `npm run lint` passes with zero warnings
2. `npm run lint:types` passes
3. `npm test` passes
4. `npm run format:check` passes
5. `npm run build` succeeds

## Project Structure

```
src/
├── lib/                    # Core business logic (testable, framework-agnostic)
│   ├── lanes/              # Individual governance lane evaluators
│   │   ├── performanceLane.ts    # Groundedness & hallucination scoring
│   │   ├── costLane.ts           # Z-score outlier & runaway loop detection
│   │   └── responsibilityLane.ts # PII scanning, bias detection, regulatory rules
│   ├── decisionEngine.ts  # 3-lane aggregator, session compounding, tier mapping
│   ├── metrics.ts          # Confusion matrix & precision-recall calculations
│   └── policyProfiles.ts  # Default policy profile definitions
├── data/                   # Synthetic datasets & baseline distributions
├── components/             # React UI components
├── types.ts                # Domain type definitions
└── App.tsx                 # Main application shell
```

## Pull Request Process

1. **Fork** the repository and create a feature branch from `main`
2. Make your changes following the code style guidelines above
3. Add or update tests for any new business logic
4. Update documentation if applicable
5. Open a PR with a clear title and description

## Architecture Decisions

- **Business logic is framework-agnostic**: All scoring, evaluation, and policy logic lives in `src/lib/` with zero React dependencies, making it independently testable and portable.
- **Synthetic data for demonstration**: The app uses pre-built synthetic interactions to demonstrate governance capabilities without requiring a live AI model connection.
- **Gemini API is optional**: The LLM Judge feature gracefully falls back to deterministic heuristics when no API key is configured.

## License

By contributing, you agree that your contributions will be licensed under the [Apache-2.0 License](LICENSE).
