const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

function resolveNpxCliScript() {
  const nodeExecutable = process.execPath;
  const nodeDirectory = path.dirname(nodeExecutable);
  const bundledCandidate = path.join(
    nodeDirectory,
    'node_modules',
    'npm',
    'bin',
    'npx-cli.js',
  );

  if (fs.existsSync(bundledCandidate)) {
    return bundledCandidate;
  }

  throw new Error('Unable to locate npm/bin/npx-cli.js for chrome-devtools-mcp startup.');
}

function parseBrowserInfo(stdout) {
  const trimmedStdout = String(stdout || '').trim();
  const jsonStartIndex = trimmedStdout.indexOf('{');

  if (jsonStartIndex === -1) {
    throw new Error(`Chrome browser info JSON was not found in helper output: ${trimmedStdout}`);
  }

  return JSON.parse(trimmedStdout.slice(jsonStartIndex));
}

function getBrowserInfo() {
  const helperScriptPath = path.join(__dirname, 'start-chrome-devtools-mcp.ps1');
  const helperResult = spawnSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-WindowStyle',
      'Hidden',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      helperScriptPath,
      '-NoMcp',
      '-PrintBrowserInfo',
    ],
    {
      cwd: process.cwd(),
      encoding: 'utf8',
      windowsHide: true,
    },
  );

  if (helperResult.error) {
    throw helperResult.error;
  }

  if (helperResult.status !== 0) {
    const stderr = String(helperResult.stderr || '').trim();
    const stdout = String(helperResult.stdout || '').trim();
    throw new Error(stderr || stdout || `Chrome browser helper exited with status ${String(helperResult.status)}`);
  }

  return parseBrowserInfo(helperResult.stdout);
}

async function main() {
  const browserInfo = getBrowserInfo();
  const npxCliScript = resolveNpxCliScript();

  process.env.CHROME_DEVTOOLS_MCP_NO_USAGE_STATISTICS = '1';

  const child = spawn(
    process.execPath,
    [
      npxCliScript,
      '-y',
      'chrome-devtools-mcp@latest',
      '--browserUrl',
      browserInfo.browserUrl,
      '--no-usage-statistics',
    ],
    {
      cwd: process.cwd(),
      env: process.env,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    },
  );

  if (process.stdin) {
    process.stdin.on('error', () => {});
    process.stdin.pipe(child.stdin);
  }

  if (child.stdin) {
    child.stdin.on('error', () => {});
  }

  if (child.stdout) {
    child.stdout.pipe(process.stdout);
  }

  if (child.stderr) {
    child.stderr.pipe(process.stderr);
  }

  const forwardSignal = (signal) => {
    if (!child.killed) {
      child.kill(signal);
    }
  };

  process.on('SIGINT', () => forwardSignal('SIGINT'));
  process.on('SIGTERM', () => forwardSignal('SIGTERM'));

  child.on('exit', (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }

    process.exit(code ?? 0);
  });
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`);
  process.exit(1);
});
