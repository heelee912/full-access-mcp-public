import fs from 'node:fs';
import path from 'node:path';

function findQuickTunnelUrl(logContent: string): string | undefined {
  const match = logContent.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/i);
  return match?.[0];
}

function readDotEnvValue(cwd: string, key: string): string | undefined {
  const dotEnvPath = path.join(cwd, '.env');
  if (!fs.existsSync(dotEnvPath)) {
    return undefined;
  }

  const lines = fs.readFileSync(dotEnvPath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmedLine = line.trim();
    if (!trimmedLine || trimmedLine.startsWith('#')) {
      continue;
    }

    const separatorIndex = trimmedLine.indexOf('=');
    if (separatorIndex === -1) {
      continue;
    }

    const currentKey = trimmedLine.slice(0, separatorIndex).trim();
    if (currentKey !== key) {
      continue;
    }

    return trimmedLine.slice(separatorIndex + 1).trim() || undefined;
  }

  return undefined;
}

function main(): void {
  const cwd = process.cwd();
  const configuredBaseUrl = process.env.REMOTE_MCP_BASE_URL?.trim();
  const configuredReadOnlyBaseUrl = process.env.REMOTE_READ_ONLY_MCP_BASE_URL?.trim();
  const quickTunnelLogPath = path.join(cwd, '.full-access-mcp', 'quick-tunnel.log');
  const quickTunnelLog = fs.existsSync(quickTunnelLogPath)
    ? fs.readFileSync(quickTunnelLogPath, 'utf8')
    : '';
  const quickTunnelUrl = findQuickTunnelUrl(quickTunnelLog);
  const remoteBaseUrl = configuredBaseUrl || quickTunnelUrl;
  const readOnlyBaseUrl = configuredReadOnlyBaseUrl || remoteBaseUrl;

  if (!remoteBaseUrl) {
    throw new Error(
      'No remote MCP base URL found. Set REMOTE_MCP_BASE_URL or start a quick tunnel first.',
    );
  }

  const mcpAuthToken =
    process.env.MCP_AUTH_TOKEN?.trim() || readDotEnvValue(cwd, 'MCP_AUTH_TOKEN');
  const usesQuickTunnel = /https:\/\/[a-z0-9-]+\.trycloudflare\.com\/?$/i.test(
    remoteBaseUrl,
  );
  const hasRemoteAuthentication = Boolean(mcpAuthToken);

  const notes = [
    'Official ChatGPT developer mode requires a remote MCP URL.',
    'As configured, /bridge stays localhost-only even when /mcp is exposed remotely.',
    'Official ChatGPT shows explicit confirmation modals before write/modify actions.',
  ];

  if (usesQuickTunnel) {
    notes.push(
      'Cloudflare quick tunnels are temporary and should be treated as test-only exposure.',
    );
  }

  if (!hasRemoteAuthentication) {
    notes.push(
      'Do not register a public full-access MCP endpoint with no authentication. Put /mcp behind OAuth or a private access gateway first.',
    );
  }

  const registration = {
    fullAccess: {
      name: 'Full Access MCP',
      description:
        'Files, terminal, browser, and desktop automation for a local workstation.',
      mcpServerUrl: `${remoteBaseUrl.replace(/\/$/, '')}/mcp`,
      authentication: mcpAuthToken
        ? 'Bearer token required'
        : 'UNSAFE: no authentication configured',
      readyForSafeOfficialRegistration: hasRemoteAuthentication && !usesQuickTunnel,
    },
    readOnly: {
      name: 'Local Inspector MCP',
      description:
        'Read-only local file, project, and Codex session inspection for ChatGPT Pro and other low-risk MCP flows.',
      mcpServerUrl: `${(readOnlyBaseUrl || remoteBaseUrl).replace(/\/$/, '')}/mcp-readonly`,
      authentication: mcpAuthToken
        ? 'Bearer token required'
        : 'UNSAFE: no authentication configured',
      readyForSafeOfficialRegistration: hasRemoteAuthentication && !usesQuickTunnel,
    },
    notes,
  };

  console.log(JSON.stringify(registration, null, 2));
}

main();
