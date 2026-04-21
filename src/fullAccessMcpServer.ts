import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { BrowserSessionRegistry } from './browserSessionRegistry.js';
import { CommandSessionRegistry } from './commandSessionRegistry.js';
import { type FullAccessServerSettings } from './settings.js';
import { createFullAccessToolCatalog } from './toolCatalog.js';
import { WindowsDesktopAutomation } from './windowsDesktopAutomation.js';
import { WindowsSystemControl } from './windowsSystemControl.js';
import { WorkspaceFileAccess } from './workspaceFileAccess.js';

interface FullAccessServerDependencies {
  settings: FullAccessServerSettings;
  workspaceFileAccess: WorkspaceFileAccess;
  commandSessionRegistry: CommandSessionRegistry;
  browserSessionRegistry: BrowserSessionRegistry;
  windowsDesktopAutomation: WindowsDesktopAutomation;
  windowsSystemControl: WindowsSystemControl;
}

function createJsonText(payload: unknown): string {
  return JSON.stringify(payload, null, 2);
}

function createToolResult(payload: unknown) {
  return {
    content: [
      {
        type: 'text' as const,
        text: createJsonText(payload),
      },
    ],
    structuredContent:
      payload && typeof payload === 'object' && !Array.isArray(payload)
        ? (payload as Record<string, unknown>)
        : { value: payload },
  };
}

export function createFullAccessMcpServer(
  dependencies: FullAccessServerDependencies,
): McpServer {
  const server = new McpServer(
    {
      name: 'full-access-mcp-server',
      version: '0.2.0',
      title: 'Full Access MCP Server',
    },
    {
      capabilities: {
        logging: {},
      },
    },
  );

  const {
    settings,
    workspaceFileAccess,
    commandSessionRegistry,
    browserSessionRegistry,
    windowsDesktopAutomation,
    windowsSystemControl,
  } = dependencies;
  const toolCatalog = createFullAccessToolCatalog(dependencies);

  server.registerResource(
    'server-status',
    'server://status',
    {
      mimeType: 'application/json',
      description: 'Current server configuration and live session summary.',
    },
    async () => {
      const status = {
        host: settings.host,
        port: settings.port,
        browserEnabled: settings.browserEnabled,
        workspaceRoots: workspaceFileAccess.listWorkspaceRoots(),
        commandSessions: commandSessionRegistry.listCommandSessions(),
        browserSessions: browserSessionRegistry.listBrowserSessions(),
      };

      return {
        contents: [
          {
            uri: 'server://status',
            mimeType: 'application/json',
            text: createJsonText(status),
          },
        ],
      };
    },
  );

  server.registerPrompt(
    'full-access-task',
    {
      description:
        'Suggested operating prompt for coding tasks that need file, shell, and browser tools.',
      argsSchema: {
        objective: z.string().describe('Primary task objective.'),
      },
    },
    async ({ objective }) => {
      return {
        description: 'Prompt template for full-access task execution',
        messages: [
          {
            role: 'user',
            content: {
              type: 'text',
              text: [
                'You can inspect files, edit files, run shell commands, keep long-lived command sessions, and control a browser.',
                'Work in small steps, verify with commands when possible, and report concrete outcomes.',
                `Objective: ${objective}`,
              ].join('\n'),
            },
          },
        ],
      };
    },
  );

  for (const toolDefinition of toolCatalog.toolDefinitions) {
    server.registerTool(
      toolDefinition.name,
      {
        description: toolDefinition.description,
        inputSchema: toolDefinition.inputSchema,
        annotations: toolDefinition.annotations,
      },
      async (input) => {
        return createToolResult(
          await toolCatalog.executeToolCall(toolDefinition.name, input),
        );
      },
    );
  }

  return server;
}
