import { setTimeout as delay } from 'node:timers/promises';

import { z } from 'zod';

import { createLocalWorkstationRuntime } from './localWorkstationRuntime.js';
import { loadRemoteAgentSettings } from './remoteAgentSettings.js';

async function postJson(
  url: string,
  token: string,
  workstationId: string,
  payload?: unknown,
): Promise<Response> {
  return await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'X-Workstation-Id': workstationId,
    },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  });
}

async function main(): Promise<void> {
  const settings = loadRemoteAgentSettings();
  const runtime = createLocalWorkstationRuntime(settings.workstation);
  let keepRunning = true;

  const shutdown = async () => {
    keepRunning = false;
    await runtime.close();
  };

  process.once('SIGINT', () => {
    void shutdown().finally(() => process.exit(0));
  });
  process.once('SIGTERM', () => {
    void shutdown().finally(() => process.exit(0));
  });

  console.log(
    `remote workstation agent connecting to ${settings.gatewayBaseUrl} as ${settings.workstationId}`,
  );

  while (keepRunning) {
    try {
      const pollResponse = await postJson(
        `${settings.gatewayBaseUrl}/agent/poll`,
        settings.workstationToken,
        settings.workstationId,
        {
          browserEnabled: settings.workstation.browserEnabled,
          workspaceRoots: runtime.workspaceFileAccess.listWorkspaceRoots(),
        },
      );

      if (!pollResponse.ok) {
        throw new Error(`agent poll failed with status ${String(pollResponse.status)}`);
      }

      const pollPayload = agentPollResponseSchema.parse(await pollResponse.json());

      if (!pollPayload.task) {
        continue;
      }

      try {
        const result = await runtime.toolCatalog.executeToolCall(
          pollPayload.task.toolName,
          pollPayload.task.arguments,
        );

        const resultResponse = await postJson(
          `${settings.gatewayBaseUrl}/agent/tasks/${pollPayload.task.taskId}/result`,
          settings.workstationToken,
          settings.workstationId,
          {
            ok: true,
            result,
          },
        );

        if (!resultResponse.ok) {
          throw new Error(
            `agent result upload failed with status ${String(resultResponse.status)}`,
          );
        }
      } catch (error) {
        const resultResponse = await postJson(
          `${settings.gatewayBaseUrl}/agent/tasks/${pollPayload.task.taskId}/result`,
          settings.workstationToken,
          settings.workstationId,
          {
            ok: false,
            error: error instanceof Error ? error.message : String(error),
          },
        );

        if (!resultResponse.ok) {
          throw new Error(
            `agent error upload failed with status ${String(resultResponse.status)}`,
          );
        }
      }
    } catch (error) {
      console.error('remote workstation agent loop failed', error);
      await delay(settings.pollRetryDelayMs);
    }
  }
}

const agentPollResponseSchema = z.object({
  ok: z.literal(true),
  workstationId: z.string(),
  task: z
    .object({
      taskId: z.string(),
      toolName: z.string(),
      arguments: z.unknown(),
      enqueuedAt: z.string(),
    })
    .nullable(),
});

void main();
