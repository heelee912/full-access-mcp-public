const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

function readDotEnvValues() {
  const dotEnvPath = path.join(process.cwd(), '.env');
  if (!fs.existsSync(dotEnvPath)) {
    return {};
  }

  const envValues = {};
  const dotEnvContent = fs.readFileSync(dotEnvPath, 'utf8');
  for (const rawLine of dotEnvContent.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }

    const separatorIndex = line.indexOf('=');
    if (separatorIndex <= 0) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1).trim();
    if (key) {
      envValues[key] = value;
    }
  }

  return envValues;
}

function createRuntimeEnv() {
  return {
    ...process.env,
    ...readDotEnvValues(),
  };
}

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

function getBrowserInfo(runtimeEnv) {
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
      env: runtimeEnv,
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

function usesAutoConnect(runtimeEnv) {
  const attachMode = String(runtimeEnv.CHROME_DEVTOOLS_ATTACH_MODE || '').trim().toLowerCase();
  return (
    attachMode === 'existing-required' ||
    attachMode === 'autoconnect' ||
    attachMode === 'auto-connect' ||
    attachMode === 'main-chrome-devtools'
  );
}

async function main() {
  const runtimeEnv = createRuntimeEnv();
  runtimeEnv.CHROME_DEVTOOLS_MCP_NO_USAGE_STATISTICS = '1';
  const npxCliScript = resolveNpxCliScript();
  const chromeDevtoolsArgs = [
    npxCliScript,
    '-y',
    'chrome-devtools-mcp@latest',
  ];

  if (usesAutoConnect(runtimeEnv)) {
    chromeDevtoolsArgs.push('--autoConnect', '--channel=stable');
  } else {
    const browserInfo = getBrowserInfo(runtimeEnv);
    chromeDevtoolsArgs.push('--browserUrl', browserInfo.browserUrl);
  }

  chromeDevtoolsArgs.push('--no-usage-statistics');

  const child = spawn(
    process.execPath,
    chromeDevtoolsArgs,
    {
      cwd: process.cwd(),
      env: runtimeEnv,
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
