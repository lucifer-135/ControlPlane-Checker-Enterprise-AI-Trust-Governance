/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Pre-demo judge warm-up. Run with the server running:
 *
 *   npm run demo:warm                     # Gemini judge for every demo interaction
 *   npm run demo:warm -- --provider dual  # or qwen / dual
 *
 * Sends each demo interaction to /api/judge exactly as the dashboard does, so the
 * server's judge cache answers the on-stage clicks instantly. Judgements run at
 * temperature 0, so a cached verdict is the one a live call would return.
 */

import 'dotenv/config';
import { SYNTHETIC_INTERACTIONS } from '../src/data/interactions';

const port = process.env.PORT || '3000';
const providerArg = process.argv.indexOf('--provider');
const provider = providerArg > 0 ? process.argv[providerArg + 1] : 'gemini';
const apiKey = process.env.CONTROLPLANE_BOOTSTRAP_ADMIN_KEY;
const CONCURRENCY = 3;

async function judge(item: (typeof SYNTHETIC_INTERACTIONS)[number]): Promise<string> {
  const start = Date.now();
  const resp = await fetch(`http://localhost:${port}/api/judge`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    },
    // Same body as handleRunJudge in App.tsx, so the cache key matches
    body: JSON.stringify({
      prompt: item.prompt,
      context: item.retrieved_context || '',
      retrievedContext: item.retrieved_context || '',
      response: item.response,
      responseText: item.response,
      useCase: item.use_case,
      provider,
    }),
  });
  const ms = Date.now() - start;
  if (!resp.ok) return `✗ ${item.id.padEnd(11)} HTTP ${resp.status}`;
  const r: any = await resp.json();
  const state = r.cached
    ? 'already cached'
    : r.isLiveLLM
      ? `${ms} ms`
      : 'heuristic fallback (not cached)';
  return `${r.isLiveLLM ? '✓' : '!'} ${item.id.padEnd(11)} ${String(r.verdict).padEnd(17)} ${state}`;
}

async function main(): Promise<void> {
  try {
    await fetch(`http://localhost:${port}/api/health`, { signal: AbortSignal.timeout(2000) });
  } catch {
    console.error(`The server is not running on port ${port}. Start it with "npm run dev" first.`);
    process.exit(1);
  }

  console.log(
    `Warming the ${provider} judge for ${SYNTHETIC_INTERACTIONS.length} demo interactions\n`,
  );
  const queue = [...SYNTHETIC_INTERACTIONS];
  let fallbacks = 0;
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      for (let item = queue.shift(); item; item = queue.shift()) {
        const line = await judge(item);
        if (!line.startsWith('✓')) fallbacks++;
        console.log(`  ${line}`);
      }
    }),
  );
  console.log(
    fallbacks === 0
      ? '\nAll judgements cached: judge clicks during the demo answer instantly.'
      : `\n${fallbacks} interaction(s) were not cached (the LLM did not answer in time). Rerun to retry them.`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
