import { loadFullAccessServerSettings, type FullAccessServerSettings } from './settings.js';

export interface RemoteAgentSettings {
  workstation: FullAccessServerSettings;
  gatewayBaseUrl: string;
  workstationId: string;
  workstationToken: string;
  pollRetryDelayMs: number;
}

function parseNumber(value: string | undefined, fallback: number): number {
  if (!value || value.trim() === '') {
    return fallback;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function loadRemoteAgentSettings(cwd = process.cwd()): RemoteAgentSettings {
  const workstation = loadFullAccessServerSettings(cwd);
  const gatewayBaseUrl = process.env.AGENT_GATEWAY_BASE_URL?.trim();
  const workstationToken = process.env.REMOTE_WORKSTATION_TOKEN?.trim();

  if (!gatewayBaseUrl) {
    throw new Error('AGENT_GATEWAY_BASE_URL is required for the remote workstation agent');
  }

  if (!workstationToken) {
    throw new Error('REMOTE_WORKSTATION_TOKEN is required for the remote workstation agent');
  }

  return {
    workstation,
    gatewayBaseUrl: gatewayBaseUrl.replace(/\/+$/, ''),
    workstationId: process.env.REMOTE_WORKSTATION_ID?.trim() || 'primary-workstation',
    workstationToken,
    pollRetryDelayMs: parseNumber(process.env.AGENT_POLL_RETRY_DELAY_MS, 2_000),
  };
}
