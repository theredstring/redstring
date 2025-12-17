#!/usr/bin/env node
// Self-starting E2E runner for Wizard agent tests
// Starts agent-server, runs tests, cleans up

import { spawn } from 'child_process';
import fetch from 'node-fetch';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const BRIDGE_URL = process.env.BRIDGE_URL || 'http://localhost:3001';
const BRIDGE_PORT = process.env.BRIDGE_PORT || '3001';
const API_KEY = process.env.API_KEY || '';
const MODEL = process.env.MODEL || '';

const EXTRA_ARGS = process.argv.slice(2);
const IS_DRY_RUN = EXTRA_ARGS.includes('--dry-run');

let agentServerProcess = null;

function log(color, message) {
  const colors = {
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    reset: '\x1b[0m'
  };
  console.log(`${colors[color] || ''}${message}${colors.reset}`);
}

async function checkHealth(url, maxAttempts = 30) {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const res = await fetch(`${url}/api/bridge/health`);
      if (res.ok) {
        return true;
      }
    } catch (e) {
      // Not ready yet
    }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  return false;
}

async function startAgentServer() {
  log('blue', '🚀 Starting agent-server...');
  
  // Check if already running
  try {
    const res = await fetch(`${BRIDGE_URL}/api/bridge/health`);
    if (res.ok) {
      log('yellow', '⚠️  Agent server already running, reusing existing instance');
      return null;
    }
  } catch (e) {
    // Not running, continue
  }

  // Start new instance
  const projectRoot = join(__dirname, '../..');
  agentServerProcess = spawn('node', ['agent-server.js'], {
    cwd: projectRoot,
    stdio: 'pipe',
    env: { ...process.env, BRIDGE_PORT }
  });

  agentServerProcess.stdout.on('data', (data) => {
    const text = data.toString();
    if (text.includes('listening') || text.includes('✅')) {
      log('green', `   ${text.trim()}`);
    }
  });

  agentServerProcess.stderr.on('data', (data) => {
    log('red', `   ${data.toString().trim()}`);
  });

  agentServerProcess.on('error', (err) => {
    log('red', `❌ Failed to start agent-server: ${err.message}`);
    process.exit(1);
  });

  // Wait for health check
  log('blue', '   Waiting for agent-server to be ready...');
  const isReady = await checkHealth(BRIDGE_URL);
  if (!isReady) {
    log('red', '❌ Agent server failed to start within timeout');
    if (agentServerProcess) agentServerProcess.kill();
    process.exit(1);
  }

  log('green', '✅ Agent server is ready');
  return agentServerProcess;
}

async function runTests() {
  log('blue', '\n🧪 Running Wizard E2E tests...\n');
  
  const testFile = join(__dirname, 'wizard-e2e.js');
  const args = EXTRA_ARGS.length > 0 ? EXTRA_ARGS : ['--auto-discover'];

  return new Promise((resolve, reject) => {
    const testProcess = spawn('node', [testFile, ...args], {
      cwd: join(__dirname, '../..'),
      stdio: 'inherit',
      env: { ...process.env, BRIDGE_URL, API_KEY, MODEL }
    });

    testProcess.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Tests failed with exit code ${code}`));
      }
    });

    testProcess.on('error', (err) => {
      reject(err);
    });
  });
}

async function cleanup() {
  if (agentServerProcess) {
    log('blue', '\n🧹 Cleaning up agent-server...');
    agentServerProcess.kill('SIGTERM');
    await new Promise(resolve => setTimeout(resolve, 1000));
    if (!agentServerProcess.killed) {
      agentServerProcess.kill('SIGKILL');
    }
    log('green', '✅ Cleanup complete');
  }
}

// Handle process termination
process.on('SIGINT', async () => {
  await cleanup();
  process.exit(1);
});

process.on('SIGTERM', async () => {
  await cleanup();
  process.exit(1);
});

// Main
(async () => {
  try {
    if (!API_KEY && !IS_DRY_RUN) {
      log('red', '❌ API_KEY environment variable is required (unless running --dry-run)');
      log('yellow', '   Usage: API_KEY=... MODEL=... node test/ai/run-wizard-e2e.js [--auto-discover|--dry-run]');
      process.exit(1);
    }

    await startAgentServer();
    await runTests();
    await cleanup();
    
    log('green', '\n✅ All tests passed!');
    process.exit(0);
  } catch (error) {
    log('red', `\n❌ Error: ${error.message}`);
    await cleanup();
    process.exit(1);
  }
})();

