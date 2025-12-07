import { execSync } from 'child_process';

const PORT = process.env.PORT || 4000;

function log(msg) {
  console.log(`[free-port:${PORT}] ${msg}`);
}

try {
  if (process.platform === 'win32') {
    log('Skipping automatic port cleanup on Windows.');
    process.exit(0);
  }

  // Find PIDs listening on the port
  const stdout = execSync(`lsof -ti :${PORT}`, { encoding: 'utf8' }).trim();
  if (!stdout) {
    log(`No process found on port ${PORT}`);
    process.exit(0);
  }

  const pids = stdout.split('\n').filter(Boolean);
  log(`Killing PIDs on port ${PORT}: ${pids.join(', ')}`);
  try {
    execSync(`kill ${pids.join(' ')}`);
  } catch (killErr) {
    log(`Soft kill failed (${killErr.message || killErr}), retrying with -9`);
    execSync(`kill -9 ${pids.join(' ')}`);
  }

  // Verify
  try {
    execSync(`lsof -ti :${PORT}`, { stdio: 'ignore' });
    log(`Port ${PORT} still busy after kill attempt. Please free it manually.`);
    process.exit(1);
  } catch {
    log('Port freed.');
  }
} catch (err) {
  // lsof exits non-zero if nothing found; treat that as informational
  if (err.status === 1) {
    log(`No process found on port ${PORT}`);
    process.exit(0);
  }
  console.error(`[free-port:${PORT}] Failed to free port:`, err.message || err);
  process.exit(1);
}
