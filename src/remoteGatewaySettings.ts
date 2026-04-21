import { loadFullAccessServerSettings } from './settings.js';

export interface RemoteGatewayOidcSettings {
  issuerUrl: string;
  audience: string;
  resourceUrl?: string;
  publicGatewayBaseUrl: string;
  mcpPath?: string;
  protectedResourceMetadataPath?: string;
  requiredScopes: string[];
  allowedSubjects: string[];
  allowedEmails: string[];
}

export interface RemoteGatewaySettings {
  host: string;
  port: number;
  corsOrigin: string;
  httpRequestBodyLimitBytes: number;
  mcpAuthToken?: string;
  allowLoopbackDebugBypass: boolean;
  workstationId: string;
  workstationToken: string;
  toolCallTimeoutMs: number;
  agentPollTimeoutMs: number;
  agentStaleAfterMs: number;
  recentToolCallLimit: number;
  oidc?: RemoteGatewayOidcSettings;
  readOnlyMcpAuthToken?: string;
  readOnlyOidc?: RemoteGatewayOidcSettings;
}

function parseNumber(value: string | undefined, fallback: number): number {
  if (!value || value.trim() === '') {
    return fallback;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
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

function parseStringList(value: string | undefined): string[] {
  return value?.split(',').map((entry) => entry.trim()).filter(Boolean) ?? [];
}

function readTrimmedEnv(key: string): string | undefined {
  const value = process.env[key];
  const trimmedValue = value?.trim();
  return trimmedValue ? trimmedValue : undefined;
}

function readTrimmedPrefixedEnv(
  prefix: string,
  key: string,
  fallbackKey = key,
): string | undefined {
  return readTrimmedEnv(`${prefix}${key}`) ?? readTrimmedEnv(fallbackKey);
}

export function loadRemoteGatewaySettings(
  cwd = process.cwd(),
): RemoteGatewaySettings {
  loadFullAccessServerSettings(cwd);

  const workstationToken = readTrimmedEnv('REMOTE_WORKSTATION_TOKEN');

  if (!workstationToken) {
    throw new Error('REMOTE_WORKSTATION_TOKEN is required for the remote gateway');
  }

  const host = readTrimmedEnv('GATEWAY_HOST') || '127.0.0.1';
  const port = parseNumber(process.env.GATEWAY_PORT, 9797);
  const oidcIssuerUrl = readTrimmedEnv('OIDC_ISSUER_URL');
  const publicGatewayBaseUrl =
    readTrimmedEnv('PUBLIC_GATEWAY_BASE_URL') || `http://${host}:${String(port)}`;
  const readOnlyPublicGatewayBaseUrl =
    readTrimmedPrefixedEnv('READ_ONLY_', 'PUBLIC_GATEWAY_BASE_URL') ||
    publicGatewayBaseUrl;
  const readOnlyOidcIssuerUrl = readTrimmedPrefixedEnv('READ_ONLY_', 'OIDC_ISSUER_URL');
  const fullMcpAuthToken =
    readTrimmedEnv('GATEWAY_MCP_AUTH_TOKEN') || readTrimmedEnv('MCP_AUTH_TOKEN');
  const readOnlyMcpAuthToken =
    readTrimmedEnv('READ_ONLY_GATEWAY_MCP_AUTH_TOKEN') ||
    readTrimmedEnv('READ_ONLY_MCP_AUTH_TOKEN') ||
    fullMcpAuthToken;

  return {
    host,
    port,
    corsOrigin: readTrimmedEnv('GATEWAY_CORS_ORIGIN') || '*',
    httpRequestBodyLimitBytes: parseNumber(
      process.env.GATEWAY_HTTP_REQUEST_BODY_LIMIT_BYTES,
      512_000,
    ),
    allowLoopbackDebugBypass: parseBoolean(
      process.env.GATEWAY_ALLOW_LOOPBACK_DEBUG_BYPASS,
      false,
    ),
    mcpAuthToken: fullMcpAuthToken,
    workstationId: readTrimmedEnv('REMOTE_WORKSTATION_ID') || 'primary-workstation',
    workstationToken,
    toolCallTimeoutMs: parseNumber(process.env.GATEWAY_TOOL_CALL_TIMEOUT_MS, 300_000),
    agentPollTimeoutMs: parseNumber(process.env.GATEWAY_AGENT_POLL_TIMEOUT_MS, 25_000),
    agentStaleAfterMs: parseNumber(process.env.GATEWAY_AGENT_STALE_AFTER_MS, 60_000),
    recentToolCallLimit: parseNumber(
      process.env.GATEWAY_RECENT_TOOL_CALL_LIMIT,
      40,
    ),
    readOnlyMcpAuthToken,
    oidc: oidcIssuerUrl
      ? {
          issuerUrl: oidcIssuerUrl,
          audience: readTrimmedEnv('OIDC_AUDIENCE') || `${publicGatewayBaseUrl}/mcp`,
          resourceUrl:
            readTrimmedEnv('OIDC_AUDIENCE') || `${publicGatewayBaseUrl}/mcp`,
          publicGatewayBaseUrl,
          mcpPath: '/mcp',
          protectedResourceMetadataPath: '/.well-known/oauth-protected-resource/mcp',
          requiredScopes: parseStringList(readTrimmedEnv('OIDC_REQUIRED_SCOPES')),
          allowedSubjects: parseStringList(readTrimmedEnv('OIDC_ALLOWED_SUBJECTS')),
          allowedEmails: parseStringList(readTrimmedEnv('OIDC_ALLOWED_EMAILS')),
        }
      : undefined,
    readOnlyOidc: readOnlyOidcIssuerUrl
      ? {
          issuerUrl: readOnlyOidcIssuerUrl,
          audience:
            readTrimmedPrefixedEnv('READ_ONLY_', 'OIDC_AUDIENCE') ||
            `${readOnlyPublicGatewayBaseUrl}/mcp-readonly`,
          resourceUrl:
            readTrimmedPrefixedEnv('READ_ONLY_', 'OIDC_AUDIENCE') ||
            `${readOnlyPublicGatewayBaseUrl}/mcp-readonly`,
          publicGatewayBaseUrl: readOnlyPublicGatewayBaseUrl,
          mcpPath: '/mcp-readonly',
          protectedResourceMetadataPath:
            '/.well-known/oauth-protected-resource/mcp-readonly',
          requiredScopes: parseStringList(
            readTrimmedPrefixedEnv('READ_ONLY_', 'OIDC_REQUIRED_SCOPES'),
          ),
          allowedSubjects: parseStringList(
            readTrimmedPrefixedEnv('READ_ONLY_', 'OIDC_ALLOWED_SUBJECTS'),
          ),
          allowedEmails: parseStringList(
            readTrimmedPrefixedEnv('READ_ONLY_', 'OIDC_ALLOWED_EMAILS'),
          ),
        }
      : undefined,
  };
}
