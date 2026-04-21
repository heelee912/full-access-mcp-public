import fs from 'node:fs';
import path from 'node:path';

export interface FullAccessServerSettings {
  host: string;
  port: number;
  authToken?: string;
  corsOrigin: string;
  httpRequestBodyLimitBytes: number;
  workspaceRoots: string[];
  allowComputerWideAccess: boolean;
  commandOutputLimit: number;
  processSessionIdleTtlMs: number;
  localBridgeEnabled: boolean;
  localBridgeToken?: string;
  localBridgeRequireLoopback: boolean;
  localBridgeRequireLocalHostHeader: boolean;
  localBridgeRejectWebOrigins: boolean;
  localBridgeAllowedClients: string[];
  localBridgeStartLocked: boolean;
  localBridgeAuditLogEnabled: boolean;
  localBridgeAuditLogPath: string;
  browserEnabled: boolean;
  browserHeadless: boolean;
  browserStorageRoot: string;
  chromeRemoteDebuggingAutoAllowEnabled: boolean;
  chromeRemoteDebuggingAutoAllowPollIntervalMs: number;
  chatGptMcpAutoAllowEnabled: boolean;
  chatGptMcpAutoAllowPollIntervalMs: number;
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) {
    return fallback;
  }

  const normalized = value.trim().toLowerCase();

  if (['1', 'true', 'yes', 'on'].includes(normalized)) {
    return true;
  }

  if (['0', 'false', 'no', 'off'].includes(normalized)) {
    return false;
  }

  return fallback;
}

function parseNumber(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === '') {
    return fallback;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseWorkspaceRoots(value: string | undefined, cwd: string): string[] {
  const rawRoots =
    value?.split(',').map((entry) => entry.trim()).filter(Boolean) ?? ['.'];

  return rawRoots.map((entry) => path.resolve(cwd, entry));
}

function parseStringList(
  value: string | undefined,
  fallback: string[],
): string[] {
  const parsedEntries =
    value?.split(',').map((entry) => entry.trim()).filter(Boolean) ?? [];

  if (parsedEntries.length === 0) {
    return fallback;
  }

  return parsedEntries;
}

function loadDotEnvFile(cwd: string): void {
  const dotEnvPath = path.join(cwd, '.env');

  if (!fs.existsSync(dotEnvPath)) {
    return;
  }

  const rawContent = fs.readFileSync(dotEnvPath, 'utf8');
  const lines = rawContent.split(/\r?\n/);

  for (const line of lines) {
    const trimmedLine = line.trim();
    if (trimmedLine === '' || trimmedLine.startsWith('#')) {
      continue;
    }

    const separatorIndex = trimmedLine.indexOf('=');
    if (separatorIndex === -1) {
      continue;
    }

    const key = trimmedLine.slice(0, separatorIndex).trim();
    const value = trimmedLine.slice(separatorIndex + 1).trim();

    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

export function loadFullAccessServerSettings(
  cwd = process.cwd(),
): FullAccessServerSettings {
  loadDotEnvFile(cwd);

  return {
    host: process.env.HOST?.trim() || '127.0.0.1',
    port: parseNumber(process.env.PORT, 8787),
    authToken: process.env.MCP_AUTH_TOKEN?.trim() || undefined,
    corsOrigin: process.env.MCP_CORS_ORIGIN?.trim() || '*',
    httpRequestBodyLimitBytes: parseNumber(
      process.env.HTTP_REQUEST_BODY_LIMIT_BYTES,
      512_000,
    ),
    workspaceRoots: parseWorkspaceRoots(process.env.WORKSPACE_ROOTS, cwd),
    allowComputerWideAccess: parseBoolean(
      process.env.ALLOW_COMPUTER_WIDE_ACCESS,
      false,
    ),
    commandOutputLimit: parseNumber(process.env.COMMAND_OUTPUT_LIMIT, 250_000),
    processSessionIdleTtlMs: parseNumber(
      process.env.PROCESS_SESSION_IDLE_TTL_MS,
      30 * 60 * 1000,
    ),
    localBridgeEnabled: parseBoolean(process.env.LOCAL_BRIDGE_ENABLED, true),
    localBridgeToken:
      process.env.LOCAL_BRIDGE_TOKEN?.trim() ||
      process.env.MCP_AUTH_TOKEN?.trim() ||
      undefined,
    localBridgeRequireLoopback: parseBoolean(
      process.env.LOCAL_BRIDGE_REQUIRE_LOOPBACK,
      true,
    ),
    localBridgeRequireLocalHostHeader: parseBoolean(
      process.env.LOCAL_BRIDGE_REQUIRE_LOCAL_HOST_HEADER,
      true,
    ),
    localBridgeRejectWebOrigins: parseBoolean(
      process.env.LOCAL_BRIDGE_REJECT_WEB_ORIGINS,
      true,
    ),
    localBridgeAllowedClients: parseStringList(
      process.env.LOCAL_BRIDGE_ALLOWED_CLIENTS,
      ['tampermonkey-userscript', 'codex-shell'],
    ),
    localBridgeStartLocked: parseBoolean(
      process.env.LOCAL_BRIDGE_START_LOCKED,
      false,
    ),
    localBridgeAuditLogEnabled: parseBoolean(
      process.env.LOCAL_BRIDGE_AUDIT_LOG_ENABLED,
      true,
    ),
    localBridgeAuditLogPath: path.resolve(
      cwd,
      process.env.LOCAL_BRIDGE_AUDIT_LOG_PATH ||
        '.full-access-mcp/local-bridge-audit.log',
    ),
    browserEnabled: parseBoolean(process.env.BROWSER_ENABLED, true),
    browserHeadless: parseBoolean(process.env.BROWSER_HEADLESS, true),
    browserStorageRoot: path.resolve(
      cwd,
      process.env.BROWSER_STORAGE_ROOT || '.full-access-mcp/browser',
    ),
    chromeRemoteDebuggingAutoAllowEnabled: parseBoolean(
      process.env.CHROME_REMOTE_DEBUGGING_AUTO_ALLOW_ENABLED,
      true,
    ),
    chromeRemoteDebuggingAutoAllowPollIntervalMs: parseNumber(
      process.env.CHROME_REMOTE_DEBUGGING_AUTO_ALLOW_POLL_INTERVAL_MS,
      750,
    ),
    chatGptMcpAutoAllowEnabled: parseBoolean(
      process.env.CHATGPT_MCP_AUTO_ALLOW_ENABLED,
      true,
    ),
    chatGptMcpAutoAllowPollIntervalMs: parseNumber(
      process.env.CHATGPT_MCP_AUTO_ALLOW_POLL_INTERVAL_MS,
      800,
    ),
  };
}
