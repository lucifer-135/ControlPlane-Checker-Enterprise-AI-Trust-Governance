// Load .env before any module reads process.env at import time
import 'dotenv/config';
import express from 'express';
import http from 'http';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import { createApp, type CreatedApp } from './src/server/app.js';
import { DuplicatePolicyError } from './src/server/policyLoader.js';
import { initDatabase } from './src/server/db/database.js';
import { getAuthMode, isProduction } from './src/server/config.js';
import {
  restoreBaselineState,
  flushBaselineState,
  startBaselinePersistence,
} from './src/server/baselinePersistence.js';
import { createDevWatchIgnore } from './src/server/devWatch.js';

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

// Initialize SQLite database and restore durable rolling baselines
initDatabase();
restoreBaselineState();
const stopBaselinePersistence = startBaselinePersistence();

let created: CreatedApp;
try {
  created = createApp({ watchPolicies: true });
} catch (err) {
  if (err instanceof DuplicatePolicyError) {
    console.error(`[Server Error] ${err.message}`);
    console.error('Refusing to start with ambiguous policy definitions.');
    process.exit(1);
  }
  throw err;
}
const { app } = created;

async function startServer() {
  const httpServer = http.createServer(app);

  // Vite middleware for development
  if (!isProduction()) {
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: {
          server: httpServer,
        },
        watch: {
          // Ignore only root runtime state; src/data/** stays watched for HMR
          ignored: [createDevWatchIgnore(process.cwd())],
        },
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const authMode = getAuthMode();
  // Unauthenticated dev mode only listens on loopback unless HOST is set explicitly
  const host = process.env.HOST || (authMode === 'dev' ? '127.0.0.1' : '0.0.0.0');
  const server = httpServer.listen(PORT, host, () => {
    console.log(
      `ControlPlane Checker Server running on http://localhost:${PORT} (bound to ${host})`,
    );
    if (authMode === 'dev') {
      console.warn(
        '[Server] Auth mode: dev — requests without an API key run as a local-dev admin. ' +
          'Set CONTROLPLANE_AUTH_MODE=required (always on in production) before exposing this server.',
      );
    } else {
      console.log('[Server] Auth mode: required — every API route needs a Bearer API key.');
    }
  });

  server.on('error', (err: any) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`\n[Server Error] Port ${PORT} is already in use by another process.`);
      console.error(
        `To release port ${PORT} on Windows, run:\n  Get-Process -Id (Get-NetTCPConnection -LocalPort ${PORT}).OwningProcess | Stop-Process -Force\n`,
      );
      process.exit(1);
    } else {
      console.error('[Server Error] Fatal error:', err);
      process.exit(1);
    }
  });

  const shutdown = () => {
    stopBaselinePersistence();
    flushBaselineState();
    created.stop();
    server.close(() => {
      process.exit(0);
    });
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

startServer();
