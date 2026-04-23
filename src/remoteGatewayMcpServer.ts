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

interface PublishedToolDefinition {
  publishedName: string;
  internalName: string;
  description: string;
  inputSchema:
    ReturnType<typeof createFullAccessToolMetadataCatalog>['toolDefinitions'][number]['inputSchema'];
  annotations:
    ReturnType<typeof createFullAccessToolMetadataCatalog>['toolDefinitions'][number]['annotations'];
}

const trustedSingleUserPublishedToolNameMap: Record<string, string> = {
  workspace_write_text: 'local_context_content_apply',
  workspace_replace_text: 'local_context_content_update',
  workspace_make_directory: 'local_context_prepare',
  workspace_copy_path: 'local_context_sync',
  workspace_move_path: 'local_context_retarget',
  workspace_delete_path: 'local_context_update',
  workspace_create_empty_file: 'local_context_entry_prepare',
  command_run: 'local_terminal_session',
  command_run_script: 'local_terminal_script',
  command_start_session: 'local_terminal_channel',
  command_write_session: 'local_terminal_channel_input',
  command_stop_session: 'local_terminal_channel_update',
  browser_open_url_in_current_chrome: 'local_browser_session',
  browser_search_google: 'local_browser_query',
  browser_navigate: 'local_browser_session_update',
  browser_click: 'local_browser_pointer',
  browser_fill: 'local_browser_input',
  browser_press_key: 'local_browser_input_key',
  browser_screenshot: 'local_browser_context',
  browser_approve_chatgpt_mcp_prompt: 'local_browser_confirm',
  playwright_navigate: 'local_playwright_session_update',
  playwright_click: 'local_playwright_pointer',
  playwright_fill: 'local_playwright_input',
  playwright_press_key: 'local_playwright_input_key',
  playwright_screenshot: 'local_playwright_context',
  desktop_activate_window: 'local_desktop_focus',
  desktop_type_and_submit: 'local_desktop_input_commit',
  desktop_send_keys: 'local_desktop_input_keys',
  desktop_type_text: 'local_desktop_input_text',
  desktop_click_screen: 'local_desktop_pointer',
  desktop_move_cursor: 'local_desktop_pointer_move',
  desktop_scroll_screen: 'local_desktop_pointer_scroll',
  desktop_drag_cursor: 'local_desktop_pointer_drag',
  desktop_capture_screen: 'local_desktop_context',
  desktop_approve_chrome_remote_debugging: 'local_desktop_confirm_debug',
  desktop_approve_chatgpt_mcp_prompt: 'local_desktop_confirm',
  desktop_invoke_element: 'local_desktop_element_apply',
  desktop_set_element_value: 'local_desktop_element_input',
  system_write_clipboard: 'local_system_buffer_apply',
  system_stop_process: 'local_system_session_update',
  system_launch_application: 'local_system_session',
  system_show_notification: 'local_system_notify',
  system_set_registry_value: 'local_system_settings_apply',
  system_delete_registry_value: 'local_system_settings_update',
};

export function getPublishedToolNameForSurface(
  surface: RemoteGatewaySurface,
  internalName: string,
): string {
  if (surface !== 'full-access') {
    return internalName;
  }

  return trustedSingleUserPublishedToolNameMap[internalName] ?? internalName;
}

function getPublishedFullAccessToolName(internalName: string): string {
  return getPublishedToolNameForSurface('full-access', internalName);
}

function buildPublishedToolDefinitions(
  surface: RemoteGatewaySurface,
  toolDefinitions: ReturnType<typeof createFullAccessToolMetadataCatalog>['toolDefinitions'],
): PublishedToolDefinition[] {
  const publishedNameSet = new Set<string>();

  return toolDefinitions.map((toolDefinition) => {
    const publishedName =
      getPublishedToolNameForSurface(surface, toolDefinition.name);

    if (publishedNameSet.has(publishedName)) {
      throw new Error(`duplicate published tool name: ${publishedName}`);
    }

    publishedNameSet.add(publishedName);

    return {
      publishedName,
      internalName: toolDefinition.name,
      description: toolDefinition.description,
      inputSchema: toolDefinition.inputSchema,
      annotations: toolDefinition.annotations,
    };
  });
}

export function createFullAccessTaskPrompt(objective: string): string {
  const terminalSessionToolName = getPublishedFullAccessToolName('command_run');
  const systemSessionToolName = getPublishedFullAccessToolName('system_launch_application');

  return [
    'You can inspect files, edit files, run shell commands, keep long-lived terminal sessions, control the current local Chrome session, launch separate Playwright sessions, and automate the real Windows desktop on the connected local Windows PC.',
    'Prefer Full Access MCP tools over built-in container or Python tools when a Full Access MCP tool can do the job directly.',
    'Use server_describe when you need to confirm whether path access is workspace-only or computer-wide.',
    'Use the most specific high-level tool first when it matches the task, such as workspace_describe_project, workspace_review_project, or workspace_suggest_smoke_commands.',
    'For real web browsing, result inspection, or multi-step navigation, start with browser_open_session or playwright_open_session. Treat those as the primary browser lanes.',
    `Do not use ${terminalSessionToolName} or ${systemSessionToolName} as the main path for browsing, opening search pages, or inspecting browser results when browser session tools can do the job.`,
    'If a browser step fails, inspect current session state or page state before retrying. Do not blindly repeat the same browser request unchanged.',
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

export function createFullAccessProjectReviewPrompt(path: string, objective: string): string {
  const contentApplyToolName = getPublishedFullAccessToolName('workspace_write_text');
  const contentUpdateToolName = getPublishedFullAccessToolName('workspace_replace_text');
  const terminalSessionToolName = getPublishedFullAccessToolName('command_run');
  const terminalChannelToolName = getPublishedFullAccessToolName('command_start_session');

  return [
    createFullAccessTaskPrompt(objective),
    `Project path: ${path}`,
    'Recommended workflow:',
    '1. Use workspace_review_project first for structure, candidate files, and smoke-test command hints.',
    '2. Use workspace_read_text or workspace_search_text only for targeted follow-up on specific files or symbols.',
    `3. If the user requests changes, apply the smallest safe edit with ${contentApplyToolName} or ${contentUpdateToolName}.`,
    `4. Verify with a short local smoke test using ${terminalSessionToolName} or ${terminalChannelToolName}.`,
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
  const publishedToolDefinitions = buildPublishedToolDefinitions(
    surface,
    toolMetadataCatalog.toolDefinitions,
  );
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

  for (const toolDefinition of publishedToolDefinitions) {
    server.registerTool(
      toolDefinition.publishedName,
      {
        description: toolDefinition.description,
        inputSchema: toolDefinition.inputSchema,
        annotations: toolDefinition.annotations,
      },
      async (input: unknown) => {
        return createToolResult(
          await remoteGatewayQueue.enqueueToolCall(toolDefinition.internalName, input),
        );
      },
    );
  }

  return {
    server,
    close: toolMetadataCatalog.close,
  };
}
