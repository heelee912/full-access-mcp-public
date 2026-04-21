import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import {
  createFullAccessToolMetadataCatalog,
  createReadOnlyToolMetadataCatalog,
} from './localWorkstationRuntime.js';
import { type RemoteGatewayQueue } from './remoteGatewayQueue.js';

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

interface RemoteGatewayMcpServerDependencies {
  remoteGatewayQueue: RemoteGatewayQueue;
  surface?: RemoteGatewaySurface;
}

type RemoteGatewaySurface = 'full-access' | 'read-only';

interface RemoteGatewaySurfaceConfiguration {
  name: string;
  title: string;
  statusResourceDescription: string;
  recentToolCallsResourceDescription: string;
  taskPromptName: string;
  taskPromptDescription: string;
  taskPromptBuilder: (objective: string) => string;
  projectReviewPromptName: string;
  projectReviewPromptDescription: string;
  projectReviewPromptBuilder: (path: string, objective: string) => string;
  createToolMetadataCatalog: typeof createFullAccessToolMetadataCatalog;
}

function createFullAccessTaskPrompt(objective: string): string {
  return [
    'You can inspect files, edit files, run shell commands, keep long-lived terminal sessions, control the current local Chrome session, launch separate Playwright sessions, and automate the real Windows desktop on the connected local Windows PC.',
    'Prefer Full Access MCP tools over built-in container or Python tools when a Full Access MCP tool can do the job directly.',
    'Use server_describe when you need to confirm whether path access is workspace-only or computer-wide.',
    'Use the most specific high-level tool first when it matches the task, such as workspace_describe_project, workspace_review_project, or workspace_suggest_smoke_commands.',
    'Work in small steps, verify with concrete commands or browser checks, and report exact outcomes.',
    `Objective: ${objective}`,
  ].join('\n');
}

function createReadOnlyTaskPrompt(objective: string): string {
  return [
    'You can inspect local files and project structure on the connected local Windows PC through read-only MCP tools.',
    'Do not suggest built-in container or Python fallback when a read-only Full Access MCP tool can inspect the requested local Windows path directly.',
    'Use server_describe first if you need to confirm whether path access is workspace-only or computer-wide.',
    'Prefer workspace_describe_project for first-pass local project inspection, workspace_search_text for symbol or text search, workspace_stat_path for path checks, and workspace_read_text only after you know the exact file.',
    'Stay read-only: inspect, compare, summarize, review, and recommend next steps without modifying files or running write actions.',
    `Objective: ${objective}`,
  ].join('\n');
}

function createFullAccessProjectReviewPrompt(path: string, objective: string): string {
  return [
    createFullAccessTaskPrompt(objective),
    `Project path: ${path}`,
    'Recommended workflow:',
    '1. Use workspace_review_project first for structure, candidate files, and smoke-test command hints.',
    '2. Use workspace_read_text or workspace_search_text only for targeted follow-up on specific files or symbols.',
    '3. If the user requests changes, apply the smallest safe edit with workspace_write_text or workspace_replace_text.',
    '4. Verify with a short local smoke test using command_run or command_start_session.',
  ].join('\n');
}

function createReadOnlyProjectReviewPrompt(path: string, objective: string): string {
  return [
    createReadOnlyTaskPrompt(objective),
    `Project path: ${path}`,
    'Recommended workflow:',
    '1. Use workspace_describe_project first for project shape and likely key files.',
    '2. Use workspace_search_text to find symbols, strings, or APIs relevant to the review goal.',
    '3. Use workspace_read_text only for the exact files you need to inspect in detail.',
    '4. Stay read-only and finish by recommending exact next actions for a write-capable follow-up model.',
  ].join('\n');
}

function getRemoteGatewaySurfaceConfiguration(
  surface: RemoteGatewaySurface,
): RemoteGatewaySurfaceConfiguration {
  if (surface === 'read-only') {
    return {
      name: 'local-inspector-mcp-gateway',
      title: 'Local Inspector MCP',
      statusResourceDescription:
        'Current remote gateway workstation connection state and recent read-only tool-call trace summary.',
      recentToolCallsResourceDescription:
        'Recent read-only remote tool-call outcomes for debugging whether ChatGPT Pro actually selected this MCP server.',
      taskPromptName: 'read-only-local-task',
      taskPromptDescription:
        'Read-only workflow prompt for local Windows PC inspection tasks that should use the connected MCP tools instead of built-in container tools.',
      taskPromptBuilder: createReadOnlyTaskPrompt,
      projectReviewPromptName: 'read-only-project-review-workflow',
      projectReviewPromptDescription:
        'Review a local project in read-only mode by using high-level inspection tools and local Codex session context before suggesting changes.',
      projectReviewPromptBuilder: createReadOnlyProjectReviewPrompt,
      createToolMetadataCatalog: createReadOnlyToolMetadataCatalog,
    };
  }

  return {
    name: 'remote-full-access-mcp-gateway',
    title: 'Remote Full Access MCP Gateway',
    statusResourceDescription:
      'Current remote gateway workstation connection state and a small recent tool-call trace summary.',
    recentToolCallsResourceDescription:
      'Recent remote tool-call outcomes for debugging whether the official ChatGPT app actually selected this MCP server.',
    taskPromptName: 'full-access-task',
    taskPromptDescription:
      'General workflow prompt for tasks that should use the connected local Windows PC instead of built-in container or Python tools.',
    taskPromptBuilder: createFullAccessTaskPrompt,
    projectReviewPromptName: 'project-review-workflow',
    projectReviewPromptDescription:
      'Review or improve a local project by starting with the highest-level project inspection tools and then using targeted follow-up tools.',
    projectReviewPromptBuilder: createFullAccessProjectReviewPrompt,
    createToolMetadataCatalog: createFullAccessToolMetadataCatalog,
  };
}

export function createRemoteGatewayMcpServer(
  dependencies: RemoteGatewayMcpServerDependencies,
): {
  server: McpServer;
  close: () => Promise<void>;
} {
  const surface = dependencies.surface ?? 'full-access';
  const surfaceConfiguration = getRemoteGatewaySurfaceConfiguration(surface);
  const server = new McpServer(
    {
      name: surfaceConfiguration.name,
      version: '0.1.0',
      title: surfaceConfiguration.title,
    },
    {
      capabilities: {
        logging: {},
      },
    },
  );
  const toolMetadataCatalog = surfaceConfiguration.createToolMetadataCatalog();
  const { remoteGatewayQueue } = dependencies;

  server.registerResource(
    'gateway-status',
    'gateway://status',
    {
      mimeType: 'application/json',
      description: surfaceConfiguration.statusResourceDescription,
    },
    async () => ({
      contents: [
        {
          uri: 'gateway://status',
          mimeType: 'application/json',
          text: createJsonText({
            workstation: remoteGatewayQueue.getWorkstationSnapshot(),
            recentToolCalls: remoteGatewayQueue.getRecentToolCalls(),
          }),
        },
      ],
    }),
  );

  server.registerResource(
    'gateway-tool-activity',
    'gateway://recent-tool-calls',
    {
      mimeType: 'application/json',
      description: surfaceConfiguration.recentToolCallsResourceDescription,
    },
    async () => ({
      contents: [
        {
          uri: 'gateway://recent-tool-calls',
          mimeType: 'application/json',
          text: createJsonText({
            workstation: remoteGatewayQueue.getWorkstationSnapshot(),
            recentToolCalls: remoteGatewayQueue.getRecentToolCalls(),
          }),
        },
      ],
    }),
  );

  server.registerPrompt(
    surfaceConfiguration.taskPromptName,
    {
      description: surfaceConfiguration.taskPromptDescription,
      argsSchema: {
        objective: z.string().describe('Primary task objective.'),
      },
    },
    async ({ objective }) => ({
      description: 'Prompt template for end-to-end local workstation execution',
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: surfaceConfiguration.taskPromptBuilder(objective),
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    surfaceConfiguration.projectReviewPromptName,
    {
      description: surfaceConfiguration.projectReviewPromptDescription,
      argsSchema: {
        path: z.string().describe('Absolute local Windows path to the project root.'),
        objective: z
          .string()
          .default('Review the project, suggest improvements, and verify changes.')
          .describe('Specific project-review goal.'),
      },
    },
    async ({ path, objective }) => ({
      description: 'Prompt template for local project review and smoke testing',
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: surfaceConfiguration.projectReviewPromptBuilder(path, objective),
          },
        },
      ],
    }),
  );

  for (const toolDefinition of toolMetadataCatalog.toolDefinitions) {
    server.registerTool(
      toolDefinition.name,
      {
        description: toolDefinition.description,
        inputSchema: toolDefinition.inputSchema,
        annotations: toolDefinition.annotations,
      },
      async (input) => {
        return createToolResult(
          await remoteGatewayQueue.enqueueToolCall(toolDefinition.name, input),
        );
      },
    );
  }

  return {
    server,
    close: toolMetadataCatalog.close,
  };
}
