/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import path from 'path';
import { createDevWatchIgnore } from './devWatch.js';

describe('createDevWatchIgnore', () => {
  const root = path.resolve('/project');
  const ignored = createDevWatchIgnore(root);
  const at = (...parts: string[]) => path.join(root, ...parts);

  it('ignores root runtime state', () => {
    expect(ignored(at('data'))).toBe(true);
    expect(ignored(at('data', 'controlplane.db'))).toBe(true);
    expect(ignored(at('policies', 'support-bot.yaml'))).toBe(true);
    expect(ignored(at('tmp', 'x.db-wal'))).toBe(true);
    expect(ignored(at('x.db-shm'))).toBe(true);
  });

  it('keeps source data and other source files watched', () => {
    expect(ignored(at('src', 'data', 'interactions.ts'))).toBe(false);
    expect(ignored(at('src', 'data', 'baselines.ts'))).toBe(false);
    expect(ignored(at('src', 'App.tsx'))).toBe(false);
    expect(ignored(at('src', 'server', 'policyLoader.ts'))).toBe(false);
  });
});
