# Contributing to ControlPlane Checker Enterprise AI Trust & Governance

Thank you for your interest in contributing! This document provides guidelines for development and contribution.

## Development Setup

### Prerequisites

- [Node.js](https://nodejs.org/) v20+ (v20.x or v22.x recommended)
- [npm](https://www.npmjs.com/)
- (Optional) [Docker](https://www.docker.com/) for containerized development

### Getting Started

```bash
# Clone the repository
git clone https://github.com/lucifer-135/ControlPlane-Checker-Enterprise-AI-Trust-Governance.git
cd ControlPlane-Checker-Enterprise-AI-Trust-Governance

# Install dependencies
npm install

# Start development server
npm run dev
```

The application will be available at `http://localhost:3000`.

## Code Quality

### Linting & Formatting

This project uses TypeScript compiler for strict type-checking and **Prettier** for formatting.

```bash
# Run TypeScript type-check & lint
npm run lint

# Format code with Prettier
npm run format

# Check formatting (CI)
npm run format:check
```

### Testing

Unit tests are written with **Vitest** and cover the core governance engine, cryptographic audit chaining, streaming interceptor, circuit breaker, and policy loaders.

```bash
# Run all tests
npm test

# Run tests with coverage report
npm run test:coverage
```

### Pre-commit Checklist

Before submitting a PR, ensure:

1. `npm run lint` passes with zero errors
2. `npm test` passes (all 75+ tests passing)
3. `npm run format:check` passes
4. `npm run build` succeeds

## Architecture

- **Independent Governance Lanes**: Deterministic evaluators in `src/lib/lanes/` evaluate Groundedness, Cost/Tokens, and Safety/PII with zero external dependencies.
- **Cryptographic Audit Log Chaining**: Immutable SHA-256 HMAC hash chains stored in SQLite with genesis hash verification.
- **GitOps YAML Policies**: Strict schemas dynamically reloaded from `policies/*.yaml`.
- **Low-Latency Streaming Interceptor**: Chunk-by-chunk SSE evaluator that severs connections immediately on policy violations.

## License

By contributing, you agree that your contributions will be licensed under the [Apache-2.0 License](LICENSE).
