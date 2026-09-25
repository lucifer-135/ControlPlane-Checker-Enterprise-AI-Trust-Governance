/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import path from 'path';

/**
 * Builds the Vite/chokidar watch-ignore matcher for local development.
 *
 * Only runtime state is ignored: the root `data/` directory (SQLite database),
 * the root `policies/` directory (hot-reloaded by the server's own watcher), and
 * SQLite database/WAL/journal files. Source data such as `src/data/**` stays
 * watched so edits trigger HMR.
 */
export function createDevWatchIgnore(rootDir: string): (filePath: string) => boolean {
  const root = path.resolve(rootDir);
  return (filePath: string) => {
    const rel = path.relative(root, path.resolve(root, filePath)).split(path.sep).join('/');
    if (rel.startsWith('..')) return false;
    if (rel === 'data' || rel.startsWith('data/')) return true;
    if (rel === 'policies' || rel.startsWith('policies/')) return true;
    return /\.db(-wal|-shm|-journal)?$/.test(rel);
  };
}
