/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Live gateway demo. Run with the server running and the dashboard on Live Stream:
 *
 *   npm run demo:gateway                    # the live pitch sequence, 6 s apart
 *   npm run demo:gateway -- --all           # every scenario, including scripted ones
 *   npm run demo:gateway -- --pause 10      # more time to narrate
 *   npm run demo:gateway -- --only injection,pii-stream
 *
 * Acts as an external app: plain OpenAI-compatible HTTP calls to /v1/chat/completions,
 * with only the base URL and API key pointing at ControlPlane. Each request appears
 * on the dashboard's Live Stream within a few seconds.
 */

import 'dotenv/config';
import {
  DEMO_SEQUENCE,
  GATEWAY_SCENARIOS,
  buildScenarioRequest,
  collectStreamText,
} from '../src/lib/gatewayScenarios';
import { DEMO_API_KEY } from '../src/server/config';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
}

const port = arg('port') ?? process.env.PORT ?? '3000';
const baseUrl = `http://localhost:${port}/v1`;
const apiKey = arg('key') ?? process.env.CONTROLPLANE_DEMO_KEY ?? DEMO_API_KEY;
const model = arg('model') ?? process.env.GEMINI_MODEL ?? 'gemini-flash-lite-latest';
const pauseMs = Number(arg('pause') ?? 6) * 1000;
const only = arg('only')?.split(',');
const scenarios = process.argv.includes('--all')
  ? GATEWAY_SCENARIOS
  : (only ?? DEMO_SEQUENCE)
      .map((id) => GATEWAY_SCENARIOS.find((s) => s.id === id))
      .filter((s): s is (typeof GATEWAY_SCENARIOS)[number] => Boolean(s));
const runId = Date.now().toString(36);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main(): Promise<void> {
  try {
    await fetch(`http://localhost:${port}/api/health`, { signal: AbortSignal.timeout(2000) });
  } catch {
    console.error(`The server is not running on port ${port}. Start it with "npm run dev" first.`);
    process.exit(1);
  }

  console.log(`ControlPlane gateway demo → ${baseUrl}  (model ${model})`);
  console.log('Watch the dashboard Live Stream: each request appears within a few seconds.\n');

  for (const [i, scenario] of scenarios.entries()) {
    const mode = scenario.scripted ? ' (scripted answer, no model call)' : '';
    console.log(`── ${i + 1}/${scenarios.length}  ${scenario.title}${mode}`);
    console.log(`   ${scenario.narration}`);
    const { body, headers } = buildScenarioRequest(scenario, model, `demo-${runId}-${scenario.id}`);
    const start = Date.now();
    try {
      const resp = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { ...headers, Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify(body),
      });
      const ms = Date.now() - start;
      if (scenario.stream) {
        console.log(`   → streamed in ${ms} ms: ${collectStreamText(await resp.text()).trim()}`);
      } else {
        const data: any = await resp.json();
        const verdict = resp.headers.get('x-controlplane-verdict');
        const text = data.choices?.[0]?.message?.content ?? data.error?.message ?? '';
        console.log(
          `   → HTTP ${resp.status}${verdict ? ` · ${verdict}` : ''} · ${ms} ms: ${String(text).replace(/\s+/g, ' ').trim()}`,
        );
      }
    } catch (err) {
      console.log(`   → request failed: ${(err as Error).message}`);
    }
    console.log(`   expected: ${scenario.expected}\n`);
    if (i < scenarios.length - 1) await sleep(pauseMs);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
