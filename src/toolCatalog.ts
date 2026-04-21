import path from 'node:path';

import { z, type ZodTypeAny } from 'zod';

import {
  BrowserSessionRegistry,
  buildGoogleSearchUrl,
} from './browserSessionRegistry.js';
import { CommandSessionRegistry } from './commandSessionRegistry.js';
import {
  describeCodexSessionArtifact,
  listCodexSessionArtifacts,
} from './codexSessionArtifacts.js';
import {
  inferLocalProjectSmokeCommandCandidates,
  selectLocalProjectReviewCandidatePaths,
} from './localProjectInspection.js';
import {
  selectProjectContextCandidateFiles,
  sortProjectContextPaths,
} from './projectContextCollection.js';
import { type FullAccessServerSettings } from './settings.js';
import { WindowsDesktopAutomation } from './windowsDesktopAutomation.js';
import { WindowsSystemControl } from './windowsSystemControl.js';
import { WorkspaceFileAccess } from './workspaceFileAccess.js';

type FullAccessToolAnnotations = {
  title?: string;
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
};

export interface FullAccessToolDefinition {
  name: string;
  description: string;
  inputSchema?: ZodTypeAny;
  annotations?: FullAccessToolAnnotations;
  execute: (input: unknown) => Promise<unknown>;
}

interface FullAccessToolCatalogDependencies {
  settings: FullAccessServerSettings;
  workspaceFileAccess: WorkspaceFileAccess;
  commandSessionRegistry: CommandSessionRegistry;
  browserSessionRegistry: BrowserSessionRegistry;
  windowsDesktopAutomation: WindowsDesktopAutomation;
  windowsSystemControl: WindowsSystemControl;
}

export interface FullAccessToolCatalog {
  toolDefinitions: FullAccessToolDefinition[];
  getToolDefinition: (name: string) => FullAccessToolDefinition | undefined;
  executeToolCall: (name: string, input: unknown) => Promise<unknown>;
}

const projectSummaryCandidateNames = [
  'README.md',
  'README',
  'README.txt',
  'package.json',
  'tsconfig.json',
  'pyproject.toml',
  'requirements.txt',
  'go.mod',
  'Cargo.toml',
  'pom.xml',
  'build.gradle',
  'build.gradle.kts',
];

function toProjectSignal(rootEntryNames: string[]): Record<string, boolean> {
  const rootEntryNameSet = new Set(rootEntryNames.map((name) => name.toLowerCase()));

  return {
    hasReadme: projectSummaryCandidateNames
      .slice(0, 3)
      .some((entry) => rootEntryNameSet.has(entry.toLowerCase())),
    hasNodePackage: rootEntryNameSet.has('package.json'),
    hasTypeScriptConfig: rootEntryNameSet.has('tsconfig.json'),
    hasPythonProject: rootEntryNameSet.has('pyproject.toml'),
    hasRequirementsTxt: rootEntryNameSet.has('requirements.txt'),
    hasGoModule: rootEntryNameSet.has('go.mod'),
    hasRustCargo: rootEntryNameSet.has('cargo.toml'),
    hasJavaBuild:
      rootEntryNameSet.has('pom.xml') ||
      rootEntryNameSet.has('build.gradle') ||
      rootEntryNameSet.has('build.gradle.kts'),
  };
}

function buildLocalWorkstationDescription(
  toolName: string,
  description: string,
): string {
  const normalizedDescription = description.trim().replace(/\.$/, '');

  const preferenceByToolName: Record<string, string> = {
    workspace_describe_project:
      'Use this first for local project understanding instead of chaining many low-level file listing and file reading tools.',
    workspace_collect_project_context:
      'Use this when the model needs the actual contents of key local project files, not just folder structure or snippets.',
    workspace_collect_text_files:
      'Use this instead of repeated single-file reads when several known local files are needed together.',
    workspace_read_text:
      'Prefer this over terminal commands when reading a specific local text file.',
    workspace_write_text:
      'Prefer this over terminal redirection when updating a specific local text file.',
    command_run:
      'Use this for one-shot PowerShell or shell commands on the local Windows PC when the user explicitly asks for terminal work.',
    command_run_script:
      'Use this for multi-line PowerShell or shell scripts on the local Windows PC.',
    command_start_session:
      'Use this when the local process must stay alive across multiple turns.',
    command_read_session:
      'Use this to inspect buffered output from an already running local process.',
    command_write_session:
      'Use this to continue an interactive local process that is already running.',
    browser_attach_selected_page:
      'Use this to work with the user\'s current local Chrome page instead of opening a separate browser.',
    browser_open_url_in_current_chrome:
      'Use this when the user wants the connected local Chrome browser to open a URL without managing browser session ids manually. This tool automatically falls back to desktop address-bar control if the Chrome DevTools session is unavailable.',
    browser_search_google:
      'Use this first for Google searches in the connected local Chrome browser instead of chaining open session, navigate, and key press tools. This tool automatically falls back to desktop address-bar control if the Chrome DevTools session is unavailable.',
    browser_approve_chatgpt_mcp_prompt:
      'Use this only to confirm that a visible Full Access MCP approval card on chatgpt.com can be approved from the current local Chrome page.',
    browser_open_session:
      'Use this when a fresh local Chrome tab or session is needed.',
    browser_snapshot:
      'Use this to read the current local Chrome page after navigation or interaction.',
    desktop_type_and_submit:
      'Use this instead of separate desktop typing and Enter key tools when text entry must be submitted immediately.',
    playwright_open_session:
      'Use this when a separate automation browser is more reliable than the user\'s live Chrome session.',
  };

  if (toolName === 'server_describe') {
    return `${normalizedDescription}. Use this to confirm the connected local Windows PC, whether path access is workspace-only or computer-wide, the configured seed workspace roots, and live sessions.`;
  }

  if (toolName.startsWith('workspace_')) {
    return `${normalizedDescription}. This reads or writes files and folders directly on the connected local Windows PC, not in a sandbox. When computer-wide access is enabled, absolute paths anywhere on the local Windows PC are allowed and the listed workspace roots are only seed locations, not hard limits. ${preferenceByToolName[toolName] ?? ''}`.trim();
  }

  if (toolName.startsWith('command_')) {
    return `${normalizedDescription}. This runs PowerShell, cmd, or other CLI commands directly on the connected local Windows PC, not in a container. When computer-wide access is enabled, cwd may be any absolute local Windows path and is not limited to the listed workspace roots. ${preferenceByToolName[toolName] ?? ''}`.trim();
  }

  if (toolName.startsWith('browser_')) {
    return `${normalizedDescription}. This attaches to and controls the real Google Chrome session on the connected local Windows PC, not a sandbox browser. ${preferenceByToolName[toolName] ?? ''}`.trim();
  }

  if (toolName.startsWith('playwright_')) {
    return `${normalizedDescription}. This controls a separate Playwright browser session on the connected local Windows PC for reliable scripted browser automation. ${preferenceByToolName[toolName] ?? ''}`.trim();
  }

  if (toolName.startsWith('desktop_')) {
    return `${normalizedDescription}. This controls the real Windows desktop UI on the connected local Windows PC.`;
  }

  if (toolName.startsWith('system_')) {
    return `${normalizedDescription}. This controls Windows system state on the connected local Windows PC.`;
  }

  return normalizedDescription;
}

function buildLocalWorkstationTitle(toolName: string): string | undefined {
  const explicitTitleByToolName: Record<string, string> = {
    server_describe: 'Get Local Workstation Status',
    workspace_describe_project: 'Describe Local Project',
    workspace_review_project: 'Review Local Project',
    workspace_collect_project_context: 'Read Local Project Files',
    workspace_collect_text_files: 'Read Multiple Local Files',
    workspace_read_text: 'Read Local Text File',
    workspace_write_text: 'Write Local Text File',
    workspace_replace_text: 'Edit Local Text File',
    workspace_list_entries: 'List Local Directory Contents',
    workspace_search_text: 'Search Local Text',
    workspace_create_empty_file: 'Create Local Empty File',
    command_run: 'Run Local Terminal Command',
    command_run_script: 'Run Local PowerShell Script',
    command_start_session: 'Start Interactive Local Process',
    command_read_session: 'Read Interactive Process Output',
    command_write_session: 'Send Input to Interactive Process',
    command_stop_session: 'Stop Interactive Process',
    browser_attach_selected_page: 'Attach Current Chrome Page',
    browser_open_url_in_current_chrome: 'Open URL in Current Chrome',
    browser_search_google: 'Search Google in Current Chrome',
    browser_approve_chatgpt_mcp_prompt: 'Approve ChatGPT MCP Prompt',
    browser_open_session: 'Open Local Chrome Session',
    browser_list_pages: 'List Open Chrome Pages',
    browser_snapshot: 'Read Current Chrome Page',
    browser_navigate: 'Navigate Current Chrome Page',
    playwright_open_session: 'Open Playwright Browser Session',
    playwright_snapshot: 'Read Playwright Page',
    desktop_list_windows: 'List Desktop Windows',
    desktop_inspect_elements: 'Inspect Desktop UI Elements',
    desktop_type_and_submit: 'Type Text and Submit',
    system_list_processes: 'List Windows Processes',
    system_launch_application: 'Launch Local Application',
  };

  const explicitTitle = explicitTitleByToolName[toolName];
  if (explicitTitle) {
    return explicitTitle;
  }

  if (toolName === 'server_describe') {
    return 'Local Workstation Status';
  }

  if (toolName.startsWith('workspace_')) {
    return `Local File ${toolName.replace('workspace_', '').replaceAll('_', ' ')}`;
  }

  if (toolName.startsWith('command_')) {
    return `Local Terminal ${toolName.replace('command_', '').replaceAll('_', ' ')}`;
  }

  if (toolName.startsWith('browser_')) {
    return `Local Browser ${toolName.replace('browser_', '').replaceAll('_', ' ')}`;
  }

  if (toolName.startsWith('playwright_')) {
    return `Local Playwright ${toolName.replace('playwright_', '').replaceAll('_', ' ')}`;
  }

  if (toolName.startsWith('desktop_')) {
    return `Local Desktop ${toolName.replace('desktop_', '').replaceAll('_', ' ')}`;
  }

  if (toolName.startsWith('system_')) {
    return `Local System ${toolName.replace('system_', '').replaceAll('_', ' ')}`;
  }

  return undefined;
}

function defineTool(definition: FullAccessToolDefinition): FullAccessToolDefinition {
  return {
    ...definition,
    description: buildLocalWorkstationDescription(
      definition.name,
      definition.description,
    ),
    annotations: {
      title: buildLocalWorkstationTitle(definition.name),
      ...definition.annotations,
    },
  };
}

async function collectTextFiles(options: {
  workspaceFileAccess: WorkspaceFileAccess;
  paths: string[];
  maxLinesPerFile: number;
}): Promise<
  Array<{
    path: string;
    lineCount: number;
    returnedRange?: { startLine: number; endLine: number };
    content: string;
  }>
> {
  const collectedFiles = [];

  for (const filePath of sortProjectContextPaths(options.paths)) {
    const snippet = await options.workspaceFileAccess.readText(
      filePath,
      1,
      options.maxLinesPerFile,
    );
    collectedFiles.push({
      path: snippet.path,
      lineCount: snippet.lineCount,
      returnedRange: snippet.returnedRange,
      content: snippet.content,
    });
  }

  return collectedFiles;
}

export function createFullAccessToolCatalog(
  dependencies: FullAccessToolCatalogDependencies,
): FullAccessToolCatalog {
  const {
    settings,
    workspaceFileAccess,
    commandSessionRegistry,
    browserSessionRegistry,
    windowsDesktopAutomation,
    windowsSystemControl,
  } = dependencies;

  const openUrlInChromeWithFallback = async (options: {
    url: string;
    attachSelectedPage: boolean;
    bringToFront: boolean;
    allowDesktopFallback: boolean;
  }) => {
    try {
      const browserResult = await browserSessionRegistry.openUrlInCurrentChrome({
        url: options.url,
        attachSelectedPage: options.attachSelectedPage,
      });

      let activatedWindow: unknown | null = null;
      if (options.bringToFront) {
        activatedWindow = await windowsDesktopAutomation
          .activateWindow({
            titleContains: 'Chrome',
          })
          .catch(() => null);
      }

      return {
        ...browserResult,
        activatedWindow,
        executionPath: 'browser-session',
      } as const;
    } catch (error) {
      if (!options.allowDesktopFallback) {
        throw error;
      }

      const activatedWindow = await windowsDesktopAutomation.activateWindow({
        titleContains: 'Chrome',
      });

      await windowsDesktopAutomation.sendKeys({
        keys: '^l',
        titleContains: 'Chrome',
        waitMs: 80,
      });

      const submittedInput = await windowsDesktopAutomation.typeTextAndSubmit({
        text: options.url,
        titleContains: 'Chrome',
        waitMs: 80,
        submitWaitMs: 220,
      });

      const foregroundWindow = await windowsDesktopAutomation
        .getForegroundWindow()
        .catch(() => null);

      return {
        url: options.url,
        activatedWindow,
        foregroundWindow,
        submittedInput,
        executionPath: 'desktop-fallback',
        originalError:
          error instanceof Error ? error.message : 'browser session open failed',
      } as const;
    }
  };

  const searchGoogleWithChromeFallback = async (options: {
    query: string;
    attachSelectedPage: boolean;
    bringToFront: boolean;
    allowDesktopFallback: boolean;
  }) => {
    const searchUrl = buildGoogleSearchUrl(options.query);
    const browserResult = await openUrlInChromeWithFallback({
      url: searchUrl,
      attachSelectedPage: options.attachSelectedPage,
      bringToFront: options.bringToFront,
      allowDesktopFallback: options.allowDesktopFallback,
    });

    return {
      query: options.query,
      searchUrl,
      ...browserResult,
    };
  };

  const toolDefinitions: FullAccessToolDefinition[] = [
    defineTool({
      name: 'server_describe',
      description: 'Return workspace roots and current live session summary.',
      annotations: {
        readOnlyHint: true,
        openWorldHint: false,
      },
      execute: async () => ({
        host: settings.host,
        port: settings.port,
        computerWideAccess: workspaceFileAccess.isComputerWideAccessEnabled(),
        pathAccessScope: workspaceFileAccess.isComputerWideAccessEnabled()
          ? 'computer-wide'
          : 'workspace-only',
        pathAccessPolicy: workspaceFileAccess.isComputerWideAccessEnabled()
          ? 'Absolute local Windows paths outside workspaceRoots are allowed. The listed workspaceRoots are only starting locations.'
          : 'Paths must stay inside the listed workspaceRoots.',
        browserEnabled: settings.browserEnabled,
        workspaceRoots: workspaceFileAccess.listWorkspaceRoots(),
        commandSessions: commandSessionRegistry.listCommandSessions(),
        browserSessions: browserSessionRegistry.listBrowserSessions(),
      }),
    }),
    defineTool({
      name: 'workspace_list_entries',
      description:
        'List files and directories from a workspace path. Use this only for targeted inspection when the exact folder contents are needed. Do not use this for first-pass project summaries; prefer workspace_describe_project.',
      inputSchema: z.object({
        path: z.string().describe('Absolute or workspace-relative path to list.'),
        maxDepth: z.number().int().min(0).max(8).default(1),
        includeHidden: z.boolean().default(false),
      }),
      annotations: {
        readOnlyHint: true,
        openWorldHint: false,
      },
      execute: async (input) => {
        const parsed = z
          .object({
            path: z.string(),
            maxDepth: z.number().int().min(0).max(8).default(1),
            includeHidden: z.boolean().default(false),
          })
          .parse(input);

        return {
          path: parsed.path,
          entries: await workspaceFileAccess.listEntries(
            parsed.path,
            parsed.maxDepth,
            parsed.includeHidden,
          ),
        };
      },
    }),
    defineTool({
      name: 'workspace_read_text',
      description:
        'Read a UTF-8 text file, optionally limiting the line range. Use this for a specific known file after you already know which file matters. Do not use this as the first tool for whole-project summaries; prefer workspace_describe_project.',
      inputSchema: z.object({
        path: z.string().describe('Absolute or workspace-relative file path.'),
        startLine: z.number().int().min(1).optional(),
        endLine: z.number().int().min(1).optional(),
      }),
      annotations: {
        readOnlyHint: true,
        openWorldHint: false,
      },
      execute: async (input) => {
        const parsed = z
          .object({
            path: z.string(),
            startLine: z.number().int().min(1).optional(),
            endLine: z.number().int().min(1).optional(),
          })
          .parse(input);

        return await workspaceFileAccess.readText(
          parsed.path,
          parsed.startLine,
          parsed.endLine,
        );
      },
    }),
    defineTool({
      name: 'workspace_write_text',
      description: 'Write or append UTF-8 text to a workspace file.',
      inputSchema: z.object({
        path: z.string().describe('Absolute or workspace-relative file path.'),
        content: z.string().describe('Text to write.'),
        mode: z.enum(['overwrite', 'append']).default('overwrite'),
      }),
      annotations: {
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      },
      execute: async (input) => {
        const parsed = z
          .object({
            path: z.string(),
            content: z.string(),
            mode: z.enum(['overwrite', 'append']).default('overwrite'),
          })
          .parse(input);

        return await workspaceFileAccess.writeText(
          parsed.path,
          parsed.content,
          parsed.mode,
        );
      },
    }),
    defineTool({
      name: 'workspace_replace_text',
      description: 'Apply literal search-and-replace operations to a UTF-8 text file.',
      inputSchema: z.object({
        path: z.string().describe('Absolute or workspace-relative file path.'),
        replacements: z
          .array(
            z.object({
              search: z.string(),
              replace: z.string(),
              expectedCount: z.number().int().min(0).optional(),
            }),
          )
          .min(1),
      }),
      annotations: {
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      },
      execute: async (input) => {
        const parsed = z
          .object({
            path: z.string(),
            replacements: z
              .array(
                z.object({
                  search: z.string(),
                  replace: z.string(),
                  expectedCount: z.number().int().min(0).optional(),
                }),
              )
              .min(1),
          })
          .parse(input);

        return await workspaceFileAccess.replaceText(
          parsed.path,
          parsed.replacements,
        );
      },
    }),
    defineTool({
      name: 'workspace_make_directory',
      description: 'Create a workspace directory.',
      inputSchema: z.object({
        path: z.string().describe('Absolute or workspace-relative directory path.'),
        recursive: z.boolean().default(true),
      }),
      annotations: {
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
      execute: async (input) => {
        const parsed = z
          .object({
            path: z.string(),
            recursive: z.boolean().default(true),
          })
          .parse(input);

        return await workspaceFileAccess.makeDirectory(
          parsed.path,
          parsed.recursive,
        );
      },
    }),
    defineTool({
      name: 'workspace_copy_path',
      description: 'Copy a workspace file or directory to another workspace path.',
      inputSchema: z.object({
        sourcePath: z.string(),
        destinationPath: z.string(),
        overwrite: z.boolean().default(false),
      }),
      annotations: {
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      },
      execute: async (input) => {
        const parsed = z
          .object({
            sourcePath: z.string(),
            destinationPath: z.string(),
            overwrite: z.boolean().default(false),
          })
          .parse(input);

        return await workspaceFileAccess.copyPath(
          parsed.sourcePath,
          parsed.destinationPath,
          parsed.overwrite,
        );
      },
    }),
    defineTool({
      name: 'workspace_move_path',
      description: 'Move or rename a workspace file or directory.',
      inputSchema: z.object({
        sourcePath: z.string(),
        destinationPath: z.string(),
        overwrite: z.boolean().default(false),
      }),
      annotations: {
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      },
      execute: async (input) => {
        const parsed = z
          .object({
            sourcePath: z.string(),
            destinationPath: z.string(),
            overwrite: z.boolean().default(false),
          })
          .parse(input);

        return await workspaceFileAccess.movePath(
          parsed.sourcePath,
          parsed.destinationPath,
          parsed.overwrite,
        );
      },
    }),
    defineTool({
      name: 'workspace_delete_path',
      description: 'Delete a workspace file or directory.',
      inputSchema: z.object({
        path: z.string(),
        recursive: z.boolean().default(true),
        force: z.boolean().default(false),
      }),
      annotations: {
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      },
      execute: async (input) => {
        const parsed = z
          .object({
            path: z.string(),
            recursive: z.boolean().default(true),
            force: z.boolean().default(false),
          })
          .parse(input);

        return await workspaceFileAccess.deletePath(
          parsed.path,
          parsed.recursive,
          parsed.force,
        );
      },
    }),
    defineTool({
      name: 'workspace_stat_path',
      description: 'Return stat metadata for a workspace path.',
      inputSchema: z.object({
        path: z.string().describe('Absolute or workspace-relative path.'),
      }),
      annotations: {
        readOnlyHint: true,
        openWorldHint: false,
      },
      execute: async (input) => {
        const parsed = z.object({ path: z.string() }).parse(input);
        return await workspaceFileAccess.statPath(parsed.path);
      },
    }),
    defineTool({
      name: 'workspace_search_text',
      description:
        'Search text recursively across the workspace. Use this when the user asks to find specific text or symbols. Do not use this as the default first step for project overviews; prefer workspace_describe_project.',
      inputSchema: z.object({
        query: z.string().describe('Text query to search for.'),
        rootPath: z.string().default('.'),
        caseSensitive: z.boolean().default(false),
        maxResults: z.number().int().min(1).max(500).default(50),
        fileExtensions: z.array(z.string()).default([]),
      }),
      annotations: {
        readOnlyHint: true,
        openWorldHint: false,
      },
      execute: async (input) => {
        const parsed = z
          .object({
            query: z.string(),
            rootPath: z.string().default('.'),
            caseSensitive: z.boolean().default(false),
            maxResults: z.number().int().min(1).max(500).default(50),
            fileExtensions: z.array(z.string()).default([]),
          })
          .parse(input);

        return {
          query: parsed.query,
          rootPath: parsed.rootPath,
          matches: await workspaceFileAccess.searchText(parsed),
        };
      },
    }),
    defineTool({
      name: 'workspace_describe_project',
      description:
        'Primary read-only tool for inspecting a local project folder and gathering the key files needed for a concise project summary. Use this first, and usually as the only tool, when the user asks for a project overview, codebase summary, or folder inspection.',
      inputSchema: z.object({
        path: z.string().describe('Absolute or workspace-relative project root path.'),
        maxEntries: z.number().int().min(1).max(60).default(30),
        maxLinesPerFile: z.number().int().min(20).max(200).default(80),
      }),
      annotations: {
        readOnlyHint: true,
        openWorldHint: false,
      },
      execute: async (input) => {
        const parsed = z
          .object({
            path: z.string(),
            maxEntries: z.number().int().min(1).max(60).default(30),
            maxLinesPerFile: z.number().int().min(20).max(200).default(80),
          })
          .parse(input);

        const listedEntries = await workspaceFileAccess.listEntries(
          parsed.path,
          1,
          false,
        );
        const childEntries = listedEntries
          .filter((entry) => entry.depth === 1)
          .slice(0, parsed.maxEntries);
        const rootEntryNames = childEntries.map((entry) => path.basename(entry.path));
        const candidatePaths = childEntries
          .filter((entry) => entry.kind === 'file')
          .filter((entry) =>
            projectSummaryCandidateNames.some(
              (candidateName) =>
                path.basename(entry.path).toLowerCase() === candidateName.toLowerCase(),
            ),
          )
          .slice(0, 6)
          .map((entry) => entry.path);

        const fileSnippets = [];
        for (const candidatePath of candidatePaths) {
          const snippet = await workspaceFileAccess.readText(
            candidatePath,
            1,
            parsed.maxLinesPerFile,
          );
          fileSnippets.push({
            path: snippet.path,
            lineCount: snippet.lineCount,
            content: snippet.content,
          });
        }

        return {
          path: workspaceFileAccess.resolveWorkspacePath(parsed.path, false),
          rootEntries: childEntries.map((entry) => ({
            path: entry.path,
            kind: entry.kind,
            sizeBytes: entry.sizeBytes,
          })),
          projectSignals: toProjectSignal(rootEntryNames),
          snippets: fileSnippets,
        };
      },
    }),
    defineTool({
      name: 'workspace_review_project',
      description:
        'Primary read-only tool for project code review and improvement planning. Use this first when the user asks to inspect, review, debug, refactor, improve, or smoke-test a local project. It returns key files, focused code snippets, and suggested smoke-test commands.',
      inputSchema: z.object({
        path: z.string().describe('Absolute or computer-relative project root path.'),
        maxEntries: z.number().int().min(1).max(80).default(40),
        maxReviewFiles: z.number().int().min(1).max(16).default(8),
        maxLinesPerFile: z.number().int().min(20).max(220).default(120),
      }),
      annotations: {
        readOnlyHint: true,
        openWorldHint: false,
      },
      execute: async (input) => {
        const parsed = z
          .object({
            path: z.string(),
            maxEntries: z.number().int().min(1).max(80).default(40),
            maxReviewFiles: z.number().int().min(1).max(16).default(8),
            maxLinesPerFile: z.number().int().min(20).max(220).default(120),
          })
          .parse(input);

        const listedEntries = await workspaceFileAccess.listEntries(
          parsed.path,
          2,
          false,
        );
        const projectRootPath = workspaceFileAccess.resolveWorkspacePath(
          parsed.path,
          false,
        );
        const rootEntries = listedEntries
          .filter((entry) => entry.depth === 1)
          .slice(0, parsed.maxEntries);
        const reviewCandidatePaths = selectLocalProjectReviewCandidatePaths(
          listedEntries,
          parsed.maxReviewFiles,
        );

        const snippets = [];
        for (const candidatePath of reviewCandidatePaths) {
          const snippet = await workspaceFileAccess.readText(
            candidatePath,
            1,
            parsed.maxLinesPerFile,
          );
          snippets.push({
            path: snippet.path,
            lineCount: snippet.lineCount,
            content: snippet.content,
          });
        }

        return {
          path: projectRootPath,
          rootEntries: rootEntries.map((entry) => ({
            path: entry.path,
            kind: entry.kind,
            sizeBytes: entry.sizeBytes,
          })),
          reviewTargets: reviewCandidatePaths,
          smokeCommandCandidates: inferLocalProjectSmokeCommandCandidates({
            projectRootPath,
            snippets,
          }),
          snippets,
        };
      },
    }),
    defineTool({
      name: 'workspace_collect_project_context',
      description:
        'Primary read-only tool for pulling actual file contents from a local project when the model needs more than a shallow overview. Use this after or instead of workspace_describe_project when detailed code, HTML, CSS, or config contents are required.',
      inputSchema: z.object({
        path: z.string().describe('Absolute or workspace-relative project root path.'),
        maxDepth: z.number().int().min(1).max(6).default(3),
        maxFiles: z.number().int().min(1).max(40).default(12),
        maxLinesPerFile: z.number().int().min(20).max(400).default(180),
        targetPaths: z
          .array(z.string())
          .max(40)
          .default([])
          .describe(
            'Optional explicit file paths to read. Use this when you already know which files matter.',
          ),
      }),
      annotations: {
        readOnlyHint: true,
        openWorldHint: false,
      },
      execute: async (input) => {
        const parsed = z
          .object({
            path: z.string(),
            maxDepth: z.number().int().min(1).max(6).default(3),
            maxFiles: z.number().int().min(1).max(40).default(12),
            maxLinesPerFile: z.number().int().min(20).max(400).default(180),
            targetPaths: z.array(z.string()).max(40).default([]),
          })
          .parse(input);

        const projectRootPath = workspaceFileAccess.resolveWorkspacePath(
          parsed.path,
          false,
        );
        const listedEntries = await workspaceFileAccess.listEntries(
          parsed.path,
          parsed.maxDepth,
          false,
        );
        const rootEntries = listedEntries.filter((entry) => entry.depth === 1);
        const candidateFiles =
          parsed.targetPaths.length > 0
            ? sortProjectContextPaths(parsed.targetPaths).slice(0, parsed.maxFiles).map((filePath) => ({
                path: filePath,
                reason: 'explicitly requested path',
              }))
            : selectProjectContextCandidateFiles(
                listedEntries.filter((entry) => entry.depth > 0),
                parsed.maxFiles,
              );

        const files = await collectTextFiles({
          workspaceFileAccess,
          paths: candidateFiles.map((candidateFile) => candidateFile.path),
          maxLinesPerFile: parsed.maxLinesPerFile,
        });
        const reasonByPath = new Map(
          candidateFiles.map((candidateFile) => [
            path.normalize(candidateFile.path).toLowerCase(),
            candidateFile.reason,
          ]),
        );

        return {
          path: projectRootPath,
          rootEntries: rootEntries.map((entry) => ({
            path: entry.path,
            kind: entry.kind,
            sizeBytes: entry.sizeBytes,
          })),
          collectedFiles: files.map((file, index) => ({
            ...file,
            reason:
              reasonByPath.get(path.normalize(file.path).toLowerCase()) ??
              'selected file',
          })),
        };
      },
    }),
    defineTool({
      name: 'workspace_collect_text_files',
      description:
        'Read multiple known text files from the connected local Windows PC in one call. Use this instead of repeated workspace_read_text calls when the model already knows which files it needs.',
      inputSchema: z.object({
        paths: z
          .array(z.string().describe('Absolute or workspace-relative file path.'))
          .min(1)
          .max(40),
        maxLinesPerFile: z.number().int().min(20).max(400).default(220),
      }),
      annotations: {
        readOnlyHint: true,
        openWorldHint: false,
      },
      execute: async (input) => {
        const parsed = z
          .object({
            paths: z.array(z.string()).min(1).max(40),
            maxLinesPerFile: z.number().int().min(20).max(400).default(220),
          })
          .parse(input);

        return {
          files: await collectTextFiles({
            workspaceFileAccess,
            paths: parsed.paths,
            maxLinesPerFile: parsed.maxLinesPerFile,
          }),
        };
      },
    }),
    defineTool({
      name: 'workspace_suggest_smoke_commands',
      description:
        'Inspect the local project and suggest concise smoke-test or startup commands before running them.',
      inputSchema: z.object({
        path: z.string().describe('Absolute or computer-relative project root path.'),
        maxLinesPerFile: z.number().int().min(20).max(220).default(120),
      }),
      annotations: {
        readOnlyHint: true,
        openWorldHint: false,
      },
      execute: async (input) => {
        const parsed = z
          .object({
            path: z.string(),
            maxLinesPerFile: z.number().int().min(20).max(220).default(120),
          })
          .parse(input);

        const listedEntries = await workspaceFileAccess.listEntries(
          parsed.path,
          2,
          false,
        );
        const projectRootPath = workspaceFileAccess.resolveWorkspacePath(
          parsed.path,
          false,
        );
        const candidatePaths = selectLocalProjectReviewCandidatePaths(
          listedEntries,
          6,
        );
        const snippets = [];

        for (const candidatePath of candidatePaths) {
          const snippet = await workspaceFileAccess.readText(
            candidatePath,
            1,
            parsed.maxLinesPerFile,
          );
          snippets.push({
            path: snippet.path,
            lineCount: snippet.lineCount,
            content: snippet.content,
          });
        }

        return {
          path: projectRootPath,
          smokeCommandCandidates: inferLocalProjectSmokeCommandCandidates({
            projectRootPath,
            snippets,
          }),
          basedOnFiles: snippets.map((snippet) => snippet.path),
        };
      },
    }),
    defineTool({
      name: 'codex_list_session_artifacts',
      description:
        'List local Codex Desktop session JSONL artifacts from the connected Windows PC, including session ids, cwd, thread names, and archived status. Use this when the user asks to find related Codex conversations or local session traces.',
      inputSchema: z.object({
        query: z.string().optional(),
        cwdContains: z.string().optional(),
        includeArchived: z.boolean().default(true),
        limit: z.number().int().min(1).max(50).default(10),
      }),
      annotations: {
        readOnlyHint: true,
        openWorldHint: false,
      },
      execute: async (input) => {
        const parsed = z
          .object({
            query: z.string().optional(),
            cwdContains: z.string().optional(),
            includeArchived: z.boolean().default(true),
            limit: z.number().int().min(1).max(50).default(10),
          })
          .parse(input);

        return await listCodexSessionArtifacts(parsed);
      },
    }),
    defineTool({
      name: 'codex_describe_session_artifact',
      description:
        'Read a local Codex Desktop session JSONL artifact and return session metadata plus a compact event preview. Use this after codex_list_session_artifacts when the user wants to inspect a specific local Codex conversation.',
      inputSchema: z.object({
        path: z.string().describe('Absolute path to a local Codex session JSONL file.'),
        maxEvents: z.number().int().min(1).max(60).default(12),
        maxPreviewChars: z.number().int().min(80).max(1200).default(280),
      }),
      annotations: {
        readOnlyHint: true,
        openWorldHint: false,
      },
      execute: async (input) => {
        const parsed = z
          .object({
            path: z.string(),
            maxEvents: z.number().int().min(1).max(60).default(12),
            maxPreviewChars: z.number().int().min(80).max(1200).default(280),
          })
          .parse(input);

        return await describeCodexSessionArtifact(parsed);
      },
    }),
    defineTool({
      name: 'workspace_create_empty_file',
      description: 'Create a blank file directly in the local workspace.',
      inputSchema: z.object({
        path: z.string().describe('Absolute or workspace-relative file path.'),
        overwrite: z.boolean().default(false),
      }),
      annotations: {
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      },
      execute: async (input) => {
        const parsed = z
          .object({
            path: z.string(),
            overwrite: z.boolean().default(false),
          })
          .parse(input);

        let existed = false;
        let existingKind: 'file' | 'directory' | null = null;

        try {
          const existingPath = await workspaceFileAccess.statPath(parsed.path);
          existed = true;
          existingKind = existingPath.kind;
        } catch {
          existed = false;
        }

        if (existed && !parsed.overwrite) {
          return {
            path: workspaceFileAccess.resolveWorkspacePath(parsed.path, false),
            created: false,
            reason:
              existingKind === 'directory'
                ? 'a directory already exists at this path'
                : 'a file already exists at this path',
          };
        }

        const writeResult = await workspaceFileAccess.writeText(
          parsed.path,
          '',
          'overwrite',
        );

        return {
          path: writeResult.path,
          created: true,
          bytesWritten: writeResult.bytesWritten,
          overwrittenExistingFile: existed && existingKind === 'file',
        };
      },
    }),
    defineTool({
      name: 'command_run',
      description:
        'Run a shell command and wait for completion. Use command_start_session for long-lived processes.',
      inputSchema: z.object({
        command: z.string().describe('Command or shell snippet to execute.'),
        arguments: z.array(z.string()).default([]),
        cwd: z.string().default('.'),
        shell: z.boolean().optional(),
        timeoutMs: z.number().int().min(0).max(3_600_000).default(120_000),
        environment: z.record(z.string(), z.string()).default({}),
      }),
      annotations: {
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      },
      execute: async (input) => {
        const parsed = z
          .object({
            command: z.string(),
            arguments: z.array(z.string()).default([]),
            cwd: z.string().default('.'),
            shell: z.boolean().optional(),
            timeoutMs: z.number().int().min(0).max(3_600_000).default(120_000),
            environment: z.record(z.string(), z.string()).default({}),
          })
          .parse(input);

        return await commandSessionRegistry.runCommand(parsed);
      },
    }),
    defineTool({
      name: 'command_run_script',
      description:
        'Run an inline PowerShell, Python, or Node script in memory and wait for completion.',
      inputSchema: z.object({
        runtime: z.enum(['powershell', 'python', 'node']),
        script: z.string(),
        cwd: z.string().default('.'),
        timeoutMs: z.number().int().min(0).max(3_600_000).default(120_000),
        environment: z.record(z.string(), z.string()).default({}),
      }),
      annotations: {
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      },
      execute: async (input) => {
        const parsed = z
          .object({
            runtime: z.enum(['powershell', 'python', 'node']),
            script: z.string(),
            cwd: z.string().default('.'),
            timeoutMs: z.number().int().min(0).max(3_600_000).default(120_000),
            environment: z.record(z.string(), z.string()).default({}),
          })
          .parse(input);

        return await commandSessionRegistry.runInlineScript(parsed);
      },
    }),
    defineTool({
      name: 'command_start_session',
      description:
        'Start a long-lived command session that keeps stdin/stdout available across calls.',
      inputSchema: z.object({
        command: z.string().describe('Command or shell snippet to execute.'),
        arguments: z.array(z.string()).default([]),
        cwd: z.string().default('.'),
        shell: z.boolean().optional(),
        environment: z.record(z.string(), z.string()).default({}),
      }),
      annotations: {
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      },
      execute: async (input) => {
        const parsed = z
          .object({
            command: z.string(),
            arguments: z.array(z.string()).default([]),
            cwd: z.string().default('.'),
            shell: z.boolean().optional(),
            environment: z.record(z.string(), z.string()).default({}),
          })
          .parse(input);

        return commandSessionRegistry.startCommandSession(parsed);
      },
    }),
    defineTool({
      name: 'command_read_session',
      description: 'Read buffered stdout/stderr chunks from a long-lived command session.',
      inputSchema: z.object({
        sessionId: z.string(),
        afterSequence: z.number().int().min(0).default(0),
      }),
      annotations: {
        readOnlyHint: true,
        openWorldHint: false,
      },
      execute: async (input) => {
        const parsed = z
          .object({
            sessionId: z.string(),
            afterSequence: z.number().int().min(0).default(0),
          })
          .parse(input);

        return commandSessionRegistry.readCommandSession(
          parsed.sessionId,
          parsed.afterSequence,
        );
      },
    }),
    defineTool({
      name: 'command_write_session',
      description: 'Send input to a long-lived command session.',
      inputSchema: z.object({
        sessionId: z.string(),
        input: z.string(),
        appendNewline: z.boolean().default(false),
      }),
      annotations: {
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      },
      execute: async (input) => {
        const parsed = z
          .object({
            sessionId: z.string(),
            input: z.string(),
            appendNewline: z.boolean().default(false),
          })
          .parse(input);

        return commandSessionRegistry.writeCommandSession(
          parsed.sessionId,
          parsed.input,
          parsed.appendNewline,
        );
      },
    }),
    defineTool({
      name: 'command_stop_session',
      description: 'Stop a long-lived command session.',
      inputSchema: z.object({
        sessionId: z.string(),
        force: z.boolean().default(false),
      }),
      annotations: {
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      },
      execute: async (input) => {
        const parsed = z
          .object({
            sessionId: z.string(),
            force: z.boolean().default(false),
          })
          .parse(input);

        return await commandSessionRegistry.stopCommandSession(
          parsed.sessionId,
          parsed.force,
        );
      },
    }),
    defineTool({
      name: 'browser_open_url_in_current_chrome',
      description:
        'Open a URL in the connected local Google Chrome browser and return the resulting page snapshot. This hides browser session creation and stale-session retries inside the server, and can fall back to desktop address-bar control when needed.',
      inputSchema: z.object({
        url: z.string().url(),
        attachSelectedPage: z.boolean().default(false),
        bringToFront: z.boolean().default(true),
        allowDesktopFallback: z.boolean().default(true),
      }),
      annotations: {
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
      execute: async (input) => {
        const parsed = z
          .object({
            url: z.string().url(),
            attachSelectedPage: z.boolean().default(false),
            bringToFront: z.boolean().default(true),
            allowDesktopFallback: z.boolean().default(true),
          })
          .parse(input);
        return await openUrlInChromeWithFallback(parsed);
      },
    }),
    defineTool({
      name: 'browser_search_google',
      description:
        'Search Google in the connected local Chrome browser and return the resulting page snapshot. This hides URL construction, browser session creation, stale-session retries, and desktop fallback inside the server.',
      inputSchema: z.object({
        query: z.string().min(1),
        attachSelectedPage: z.boolean().default(false),
        bringToFront: z.boolean().default(true),
        allowDesktopFallback: z.boolean().default(true),
      }),
      annotations: {
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
      execute: async (input) => {
        const parsed = z
          .object({
            query: z.string().min(1),
            attachSelectedPage: z.boolean().default(false),
            bringToFront: z.boolean().default(true),
            allowDesktopFallback: z.boolean().default(true),
          })
          .parse(input);
        return await searchGoogleWithChromeFallback(parsed);
      },
    }),
    defineTool({
      name: 'browser_open_session',
      description:
        'Open a browser automation session inside the currently running local Google Chrome instance. By default this opens a new tab in the existing Chrome window instead of hijacking the ChatGPT tab.',
      inputSchema: z.object({
        initialUrl: z.string().optional(),
        headless: z.boolean().optional(),
        viewportWidth: z.number().int().min(320).max(4096).optional(),
        viewportHeight: z.number().int().min(240).max(4096).optional(),
        attachSelectedPage: z.boolean().default(false),
      }),
      annotations: {
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
      execute: async (input) => {
        const parsed = z
          .object({
            initialUrl: z.string().optional(),
            headless: z.boolean().optional(),
            viewportWidth: z.number().int().min(320).max(4096).optional(),
            viewportHeight: z.number().int().min(240).max(4096).optional(),
            attachSelectedPage: z.boolean().default(false),
          })
          .parse(input);

        return await browserSessionRegistry.openBrowserSession(parsed);
      },
    }),
    defineTool({
      name: 'browser_attach_selected_page',
      description:
        'Attach a browser session to the currently selected Chrome tab without opening a new tab.',
      annotations: {
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
      execute: async () => {
        return await browserSessionRegistry.attachSelectedPageSession();
      },
    }),
    defineTool({
      name: 'browser_approve_chatgpt_mcp_prompt',
      description:
        'Approve a visible Full Access MCP confirmation card on the current chatgpt.com page when the exact approval card is present.',
      annotations: {
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
      execute: async () => {
        return await browserSessionRegistry.approveChatGptMcpPrompt();
      },
    }),
    defineTool({
      name: 'browser_list_pages',
      description: 'List the open pages in the currently running local Chrome instance.',
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
      },
      execute: async () => {
        return {
          pages: await browserSessionRegistry.listBrowserPages(),
        };
      },
    }),
    defineTool({
      name: 'browser_navigate',
      description: 'Navigate an existing browser session to a URL.',
      inputSchema: z.object({
        sessionId: z.string(),
        url: z.string().url(),
      }),
      annotations: {
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
      execute: async (input) => {
        const parsed = z
          .object({
            sessionId: z.string(),
            url: z.string().url(),
          })
          .parse(input);

        return await browserSessionRegistry.navigateBrowserSession(
          parsed.sessionId,
          parsed.url,
        );
      },
    }),
    defineTool({
      name: 'browser_select_page',
      description: 'Switch an attached browser session to another already open Chrome page id.',
      inputSchema: z.object({
        sessionId: z.string(),
        pageId: z.number().int().min(1),
      }),
      annotations: {
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
      execute: async (input) => {
        const parsed = z
          .object({
            sessionId: z.string(),
            pageId: z.number().int().min(1),
          })
          .parse(input);

        return await browserSessionRegistry.selectBrowserPage(
          parsed.sessionId,
          parsed.pageId,
        );
      },
    }),
    defineTool({
      name: 'browser_snapshot',
      description: 'Capture URL, title, and a text preview from the current page.',
      inputSchema: z.object({
        sessionId: z.string(),
      }),
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
      },
      execute: async (input) => {
        const parsed = z.object({ sessionId: z.string() }).parse(input);
        return await browserSessionRegistry.snapshotBrowserSession(parsed.sessionId);
      },
    }),
    defineTool({
      name: 'browser_wait_for_text',
      description:
        'Monitor the current browser page until specific visible text appears or the timeout elapses.',
      inputSchema: z.object({
        sessionId: z.string(),
        text: z.string(),
        timeoutMs: z.number().int().min(100).max(300_000).default(15_000),
        pollIntervalMs: z.number().int().min(50).max(10_000).default(500),
      }),
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
      },
      execute: async (input) => {
        const parsed = z
          .object({
            sessionId: z.string(),
            text: z.string(),
            timeoutMs: z.number().int().min(100).max(300_000).default(15_000),
            pollIntervalMs: z.number().int().min(50).max(10_000).default(500),
          })
          .parse(input);

        return await browserSessionRegistry.waitForText(parsed);
      },
    }),
    defineTool({
      name: 'browser_click',
      description: 'Click an element in the current page using a CSS selector.',
      inputSchema: z.object({
        sessionId: z.string(),
        selector: z.string(),
      }),
      annotations: {
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
      execute: async (input) => {
        const parsed = z
          .object({
            sessionId: z.string(),
            selector: z.string(),
          })
          .parse(input);

        return await browserSessionRegistry.clickBrowserSession(
          parsed.sessionId,
          parsed.selector,
        );
      },
    }),
    defineTool({
      name: 'browser_fill',
      description: 'Fill an input field and optionally submit it.',
      inputSchema: z.object({
        sessionId: z.string(),
        selector: z.string(),
        value: z.string(),
        submit: z.boolean().default(false),
      }),
      annotations: {
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
      execute: async (input) => {
        const parsed = z
          .object({
            sessionId: z.string(),
            selector: z.string(),
            value: z.string(),
            submit: z.boolean().default(false),
          })
          .parse(input);

        return await browserSessionRegistry.fillBrowserSession(
          parsed.sessionId,
          parsed.selector,
          parsed.value,
          parsed.submit,
        );
      },
    }),
    defineTool({
      name: 'browser_press_key',
      description: 'Send a key press to the active browser page.',
      inputSchema: z.object({
        sessionId: z.string(),
        key: z.string(),
      }),
      annotations: {
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
      execute: async (input) => {
        const parsed = z
          .object({
            sessionId: z.string(),
            key: z.string(),
          })
          .parse(input);

        return await browserSessionRegistry.pressBrowserKey(
          parsed.sessionId,
          parsed.key,
        );
      },
    }),
    defineTool({
      name: 'browser_evaluate',
      description:
        'Evaluate arbitrary JavaScript inside the active page context and return the result.',
      inputSchema: z.object({
        sessionId: z.string(),
        expression: z.string(),
      }),
      annotations: {
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
      execute: async (input) => {
        const parsed = z
          .object({
            sessionId: z.string(),
            expression: z.string(),
          })
          .parse(input);

        return await browserSessionRegistry.evaluateBrowserSession(
          parsed.sessionId,
          parsed.expression,
        );
      },
    }),
    defineTool({
      name: 'browser_screenshot',
      description: 'Save a screenshot for the active browser page.',
      inputSchema: z.object({
        sessionId: z.string(),
        path: z.string().optional(),
        fullPage: z.boolean().default(true),
        type: z.enum(['png', 'jpeg']).default('png'),
      }),
      annotations: {
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
      execute: async (input) => {
        const parsed = z
          .object({
            sessionId: z.string(),
            path: z.string().optional(),
            fullPage: z.boolean().default(true),
            type: z.enum(['png', 'jpeg']).default('png'),
          })
          .parse(input);

        return await browserSessionRegistry.screenshotBrowserSession(parsed);
      },
    }),
    defineTool({
      name: 'browser_close_session',
      description: 'Close a browser session and release its persistent context.',
      inputSchema: z.object({
        sessionId: z.string(),
      }),
      annotations: {
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
      execute: async (input) => {
        const parsed = z.object({ sessionId: z.string() }).parse(input);
        return await browserSessionRegistry.closeBrowserSession(parsed.sessionId);
      },
    }),
    defineTool({
      name: 'playwright_open_session',
      description:
        'Open a separate Playwright browser session for reliable scripted automation without attaching to the current Chrome window.',
      inputSchema: z.object({
        initialUrl: z.string().optional(),
        headless: z.boolean().optional(),
        viewportWidth: z.number().int().min(320).max(4096).optional(),
        viewportHeight: z.number().int().min(240).max(4096).optional(),
      }),
      annotations: {
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
      execute: async (input) => {
        const parsed = z
          .object({
            initialUrl: z.string().optional(),
            headless: z.boolean().optional(),
            viewportWidth: z.number().int().min(320).max(4096).optional(),
            viewportHeight: z.number().int().min(240).max(4096).optional(),
          })
          .parse(input);

        return await browserSessionRegistry.openPlaywrightSession(parsed);
      },
    }),
    defineTool({
      name: 'playwright_navigate',
      description: 'Navigate an existing Playwright browser session to a URL.',
      inputSchema: z.object({
        sessionId: z.string(),
        url: z.string().url(),
      }),
      annotations: {
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
      execute: async (input) => {
        const parsed = z
          .object({
            sessionId: z.string(),
            url: z.string().url(),
          })
          .parse(input);

        return await browserSessionRegistry.navigateBrowserSession(
          parsed.sessionId,
          parsed.url,
        );
      },
    }),
    defineTool({
      name: 'playwright_snapshot',
      description:
        'Capture URL, title, and a text preview from the current Playwright page.',
      inputSchema: z.object({
        sessionId: z.string(),
      }),
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
      },
      execute: async (input) => {
        const parsed = z.object({ sessionId: z.string() }).parse(input);
        return await browserSessionRegistry.snapshotBrowserSession(parsed.sessionId);
      },
    }),
    defineTool({
      name: 'playwright_wait_for_text',
      description:
        'Wait in a Playwright browser session until specific visible text appears or the timeout elapses.',
      inputSchema: z.object({
        sessionId: z.string(),
        text: z.string(),
        timeoutMs: z.number().int().min(100).max(300_000).default(15_000),
        pollIntervalMs: z.number().int().min(50).max(10_000).default(500),
      }),
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
      },
      execute: async (input) => {
        const parsed = z
          .object({
            sessionId: z.string(),
            text: z.string(),
            timeoutMs: z.number().int().min(100).max(300_000).default(15_000),
            pollIntervalMs: z.number().int().min(50).max(10_000).default(500),
          })
          .parse(input);

        return await browserSessionRegistry.waitForText(parsed);
      },
    }),
    defineTool({
      name: 'playwright_click',
      description: 'Click an element in a Playwright page using a CSS selector.',
      inputSchema: z.object({
        sessionId: z.string(),
        selector: z.string(),
      }),
      annotations: {
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
      execute: async (input) => {
        const parsed = z
          .object({
            sessionId: z.string(),
            selector: z.string(),
          })
          .parse(input);

        return await browserSessionRegistry.clickBrowserSession(
          parsed.sessionId,
          parsed.selector,
        );
      },
    }),
    defineTool({
      name: 'playwright_fill',
      description: 'Fill an input field in a Playwright page and optionally submit it.',
      inputSchema: z.object({
        sessionId: z.string(),
        selector: z.string(),
        value: z.string(),
        submit: z.boolean().default(false),
      }),
      annotations: {
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
      execute: async (input) => {
        const parsed = z
          .object({
            sessionId: z.string(),
            selector: z.string(),
            value: z.string(),
            submit: z.boolean().default(false),
          })
          .parse(input);

        return await browserSessionRegistry.fillBrowserSession(
          parsed.sessionId,
          parsed.selector,
          parsed.value,
          parsed.submit,
        );
      },
    }),
    defineTool({
      name: 'playwright_press_key',
      description: 'Send a key press inside a Playwright page.',
      inputSchema: z.object({
        sessionId: z.string(),
        key: z.string(),
      }),
      annotations: {
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
      execute: async (input) => {
        const parsed = z
          .object({
            sessionId: z.string(),
            key: z.string(),
          })
          .parse(input);

        return await browserSessionRegistry.pressBrowserKey(
          parsed.sessionId,
          parsed.key,
        );
      },
    }),
    defineTool({
      name: 'playwright_evaluate',
      description:
        'Evaluate arbitrary JavaScript inside a Playwright page and return the result.',
      inputSchema: z.object({
        sessionId: z.string(),
        expression: z.string(),
      }),
      annotations: {
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
      execute: async (input) => {
        const parsed = z
          .object({
            sessionId: z.string(),
            expression: z.string(),
          })
          .parse(input);

        return await browserSessionRegistry.evaluateBrowserSession(
          parsed.sessionId,
          parsed.expression,
        );
      },
    }),
    defineTool({
      name: 'playwright_screenshot',
      description: 'Save a screenshot from the active Playwright page.',
      inputSchema: z.object({
        sessionId: z.string(),
        path: z.string().optional(),
        fullPage: z.boolean().default(true),
        type: z.enum(['png', 'jpeg']).default('png'),
      }),
      annotations: {
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
      execute: async (input) => {
        const parsed = z
          .object({
            sessionId: z.string(),
            path: z.string().optional(),
            fullPage: z.boolean().default(true),
            type: z.enum(['png', 'jpeg']).default('png'),
          })
          .parse(input);

        return await browserSessionRegistry.screenshotBrowserSession(parsed);
      },
    }),
    defineTool({
      name: 'playwright_close_session',
      description: 'Close a Playwright browser session and its browser context.',
      inputSchema: z.object({
        sessionId: z.string(),
      }),
      annotations: {
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
      execute: async (input) => {
        const parsed = z.object({ sessionId: z.string() }).parse(input);
        return await browserSessionRegistry.closeBrowserSession(parsed.sessionId);
      },
    }),
    defineTool({
      name: 'desktop_list_windows',
      description: 'List visible top-level desktop windows on Windows.',
      inputSchema: z.object({
        includeUntitled: z.boolean().default(false),
      }),
      annotations: {
        readOnlyHint: true,
        openWorldHint: false,
      },
      execute: async (input) => {
        const parsed = z.object({ includeUntitled: z.boolean().default(false) }).parse(input);
        return await windowsDesktopAutomation.listWindows(parsed.includeUntitled);
      },
    }),
    defineTool({
      name: 'desktop_get_foreground_window',
      description: 'Return the current foreground desktop window.',
      annotations: {
        readOnlyHint: true,
        openWorldHint: false,
      },
      execute: async () => {
        return await windowsDesktopAutomation.getForegroundWindow();
      },
    }),
    defineTool({
      name: 'desktop_activate_window',
      description: 'Bring a desktop window to the foreground by handle or title match.',
      inputSchema: z.object({
        handle: z.string().optional(),
        titleContains: z.string().optional(),
        index: z.number().int().min(0).default(0),
      }),
      annotations: {
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      },
      execute: async (input) => {
        const parsed = z
          .object({
            handle: z.string().optional(),
            titleContains: z.string().optional(),
            index: z.number().int().min(0).default(0),
          })
          .parse(input);
        return await windowsDesktopAutomation.activateWindow(parsed);
      },
    }),
    defineTool({
      name: 'desktop_type_and_submit',
      description:
        'Paste text into the active or selected desktop window and immediately submit it with Enter or custom SendKeys syntax in one server-side step.',
      inputSchema: z.object({
        text: z.string(),
        submitKeys: z.string().default('{ENTER}'),
        handle: z.string().optional(),
        titleContains: z.string().optional(),
        index: z.number().int().min(0).default(0),
        waitMs: z.number().int().min(0).max(10000).default(120),
        submitWaitMs: z.number().int().min(0).max(10000).default(180),
      }),
      annotations: {
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      },
      execute: async (input) => {
        const parsed = z
          .object({
            text: z.string(),
            submitKeys: z.string().default('{ENTER}'),
            handle: z.string().optional(),
            titleContains: z.string().optional(),
            index: z.number().int().min(0).default(0),
            waitMs: z.number().int().min(0).max(10000).default(120),
            submitWaitMs: z.number().int().min(0).max(10000).default(180),
          })
          .parse(input);
        return await windowsDesktopAutomation.typeTextAndSubmit(parsed);
      },
    }),
    defineTool({
      name: 'desktop_send_keys',
      description: 'Send raw SendKeys syntax to the active or selected desktop window.',
      inputSchema: z.object({
        keys: z.string(),
        handle: z.string().optional(),
        titleContains: z.string().optional(),
        index: z.number().int().min(0).default(0),
        waitMs: z.number().int().min(0).max(10000).default(120),
      }),
      annotations: {
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      },
      execute: async (input) => {
        const parsed = z
          .object({
            keys: z.string(),
            handle: z.string().optional(),
            titleContains: z.string().optional(),
            index: z.number().int().min(0).default(0),
            waitMs: z.number().int().min(0).max(10000).default(120),
          })
          .parse(input);
        return await windowsDesktopAutomation.sendKeys(parsed);
      },
    }),
    defineTool({
      name: 'desktop_type_text',
      description: 'Paste text into the active or selected desktop window.',
      inputSchema: z.object({
        text: z.string(),
        handle: z.string().optional(),
        titleContains: z.string().optional(),
        index: z.number().int().min(0).default(0),
        waitMs: z.number().int().min(0).max(10000).default(120),
      }),
      annotations: {
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      },
      execute: async (input) => {
        const parsed = z
          .object({
            text: z.string(),
            handle: z.string().optional(),
            titleContains: z.string().optional(),
            index: z.number().int().min(0).default(0),
            waitMs: z.number().int().min(0).max(10000).default(120),
          })
          .parse(input);
        return await windowsDesktopAutomation.typeText(parsed);
      },
    }),
    defineTool({
      name: 'desktop_click_screen',
      description: 'Click a screen coordinate on the Windows desktop.',
      inputSchema: z.object({
        x: z.number().int(),
        y: z.number().int(),
        button: z.enum(['left', 'right']).default('left'),
        doubleClick: z.boolean().default(false),
      }),
      annotations: {
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      },
      execute: async (input) => {
        const parsed = z
          .object({
            x: z.number().int(),
            y: z.number().int(),
            button: z.enum(['left', 'right']).default('left'),
            doubleClick: z.boolean().default(false),
          })
          .parse(input);
        return await windowsDesktopAutomation.clickScreen(parsed);
      },
    }),
    defineTool({
      name: 'desktop_move_cursor',
      description: 'Move the desktop cursor to a screen coordinate without clicking.',
      inputSchema: z.object({
        x: z.number().int(),
        y: z.number().int(),
      }),
      annotations: {
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      },
      execute: async (input) => {
        const parsed = z.object({ x: z.number().int(), y: z.number().int() }).parse(input);
        return await windowsDesktopAutomation.moveCursor(parsed);
      },
    }),
    defineTool({
      name: 'desktop_scroll_screen',
      description: 'Send a mouse wheel scroll at the current or provided cursor position.',
      inputSchema: z.object({
        delta: z.number().int().min(-12000).max(12000),
        x: z.number().int().optional(),
        y: z.number().int().optional(),
      }),
      annotations: {
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      },
      execute: async (input) => {
        const parsed = z
          .object({
            delta: z.number().int().min(-12000).max(12000),
            x: z.number().int().optional(),
            y: z.number().int().optional(),
          })
          .parse(input);
        return await windowsDesktopAutomation.scrollScreen(parsed);
      },
    }),
    defineTool({
      name: 'desktop_drag_cursor',
      description: 'Drag from one desktop screen coordinate to another.',
      inputSchema: z.object({
        startX: z.number().int(),
        startY: z.number().int(),
        endX: z.number().int(),
        endY: z.number().int(),
        button: z.enum(['left', 'right']).default('left'),
        steps: z.number().int().min(1).max(200).default(12),
        stepDelayMs: z.number().int().min(0).max(1000).default(16),
      }),
      annotations: {
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      },
      execute: async (input) => {
        const parsed = z
          .object({
            startX: z.number().int(),
            startY: z.number().int(),
            endX: z.number().int(),
            endY: z.number().int(),
            button: z.enum(['left', 'right']).default('left'),
            steps: z.number().int().min(1).max(200).default(12),
            stepDelayMs: z.number().int().min(0).max(1000).default(16),
          })
          .parse(input);
        return await windowsDesktopAutomation.dragCursor(parsed);
      },
    }),
    defineTool({
      name: 'desktop_get_cursor_position',
      description: 'Return the current desktop cursor position.',
      annotations: {
        readOnlyHint: true,
        openWorldHint: false,
      },
      execute: async () => {
        return await windowsDesktopAutomation.getCursorPosition();
      },
    }),
    defineTool({
      name: 'desktop_capture_screen',
      description: 'Save a screenshot of the full desktop to a workspace path.',
      inputSchema: z.object({
        path: z.string(),
      }),
      annotations: {
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      },
      execute: async (input) => {
        const parsed = z.object({ path: z.string() }).parse(input);
        return await windowsDesktopAutomation.captureScreen(parsed.path);
      },
    }),
    defineTool({
      name: 'desktop_inspect_elements',
      description:
        'Inspect the UI Automation element tree for the foreground window or a matched window.',
      inputSchema: z.object({
        handle: z.string().optional(),
        titleContains: z.string().optional(),
        index: z.number().int().min(0).default(0),
        maxDepth: z.number().int().min(0).max(8).default(3),
        maxNodes: z.number().int().min(1).max(500).default(120),
      }),
      annotations: {
        readOnlyHint: true,
        openWorldHint: false,
      },
      execute: async (input) => {
        const parsed = z
          .object({
            handle: z.string().optional(),
            titleContains: z.string().optional(),
            index: z.number().int().min(0).default(0),
            maxDepth: z.number().int().min(0).max(8).default(3),
            maxNodes: z.number().int().min(1).max(500).default(120),
          })
          .parse(input);
        return await windowsDesktopAutomation.inspectElements(parsed);
      },
    }),
    defineTool({
      name: 'desktop_approve_chrome_remote_debugging',
      description:
        'Find the Chrome remote debugging permission prompt on the connected local Windows PC and press the Allow button when it is visible.',
      annotations: {
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      },
      execute: async () => {
        return await windowsDesktopAutomation.approveChromeRemoteDebuggingPrompt();
      },
    }),
    defineTool({
      name: 'desktop_invoke_element',
      description:
        'Invoke a UI Automation element by automation id, name, or control type.',
      inputSchema: z.object({
        handle: z.string().optional(),
        titleContains: z.string().optional(),
        index: z.number().int().min(0).default(0),
        automationId: z.string().optional(),
        nameContains: z.string().optional(),
        controlType: z.string().optional(),
        elementIndex: z.number().int().min(0).default(0),
      }),
      annotations: {
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      },
      execute: async (input) => {
        const parsed = z
          .object({
            handle: z.string().optional(),
            titleContains: z.string().optional(),
            index: z.number().int().min(0).default(0),
            automationId: z.string().optional(),
            nameContains: z.string().optional(),
            controlType: z.string().optional(),
            elementIndex: z.number().int().min(0).default(0),
          })
          .parse(input);
        return await windowsDesktopAutomation.invokeElement(parsed);
      },
    }),
    defineTool({
      name: 'desktop_set_element_value',
      description:
        'Set text on a UI Automation element by value pattern or focused paste fallback.',
      inputSchema: z.object({
        handle: z.string().optional(),
        titleContains: z.string().optional(),
        index: z.number().int().min(0).default(0),
        automationId: z.string().optional(),
        nameContains: z.string().optional(),
        controlType: z.string().optional(),
        elementIndex: z.number().int().min(0).default(0),
        value: z.string(),
      }),
      annotations: {
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      },
      execute: async (input) => {
        const parsed = z
          .object({
            handle: z.string().optional(),
            titleContains: z.string().optional(),
            index: z.number().int().min(0).default(0),
            automationId: z.string().optional(),
            nameContains: z.string().optional(),
            controlType: z.string().optional(),
            elementIndex: z.number().int().min(0).default(0),
            value: z.string(),
          })
          .parse(input);
        return await windowsDesktopAutomation.setElementValue(parsed);
      },
    }),
    defineTool({
      name: 'system_wait',
      description: 'Pause for a requested amount of time without changing state.',
      inputSchema: z.object({
        delayMs: z.number().int().min(0).max(300_000),
      }),
      annotations: {
        readOnlyHint: true,
        openWorldHint: false,
      },
      execute: async (input) => {
        const parsed = z.object({ delayMs: z.number().int().min(0).max(300_000) }).parse(input);
        return await windowsSystemControl.wait(parsed.delayMs);
      },
    }),
    defineTool({
      name: 'system_read_clipboard',
      description: 'Read the current Windows clipboard text.',
      annotations: {
        readOnlyHint: true,
        openWorldHint: false,
      },
      execute: async () => {
        return await windowsSystemControl.readClipboard();
      },
    }),
    defineTool({
      name: 'system_write_clipboard',
      description: 'Write text into the Windows clipboard.',
      inputSchema: z.object({
        text: z.string(),
      }),
      annotations: {
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      },
      execute: async (input) => {
        const parsed = z.object({ text: z.string() }).parse(input);
        return await windowsSystemControl.writeClipboard(parsed.text);
      },
    }),
    defineTool({
      name: 'system_list_processes',
      description: 'List running Windows processes.',
      inputSchema: z.object({
        nameContains: z.string().optional(),
        maxResults: z.number().int().min(1).max(500).default(100),
      }),
      annotations: {
        readOnlyHint: true,
        openWorldHint: false,
      },
      execute: async (input) => {
        const parsed = z
          .object({
            nameContains: z.string().optional(),
            maxResults: z.number().int().min(1).max(500).default(100),
          })
          .parse(input);
        return {
          processes: await windowsSystemControl.listProcesses(parsed),
        };
      },
    }),
    defineTool({
      name: 'system_stop_process',
      description: 'Stop a running Windows process by process id.',
      inputSchema: z.object({
        processId: z.number().int().min(1),
        force: z.boolean().default(false),
      }),
      annotations: {
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      },
      execute: async (input) => {
        const parsed = z
          .object({
            processId: z.number().int().min(1),
            force: z.boolean().default(false),
          })
          .parse(input);
        return await windowsSystemControl.stopProcess(parsed.processId, parsed.force);
      },
    }),
    defineTool({
      name: 'system_launch_application',
      description: 'Launch an application or command on the local Windows PC.',
      inputSchema: z.object({
        command: z.string(),
        arguments: z.array(z.string()).default([]),
        cwd: z.string().optional(),
      }),
      annotations: {
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      },
      execute: async (input) => {
        const parsed = z
          .object({
            command: z.string(),
            arguments: z.array(z.string()).default([]),
            cwd: z.string().optional(),
          })
          .parse(input);
        return await windowsSystemControl.launchApplication(parsed);
      },
    }),
    defineTool({
      name: 'system_show_notification',
      description: 'Show a local Windows tray notification.',
      inputSchema: z.object({
        title: z.string(),
        message: z.string(),
        durationMs: z.number().int().min(1000).max(30000).default(3000),
      }),
      annotations: {
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      },
      execute: async (input) => {
        const parsed = z
          .object({
            title: z.string(),
            message: z.string(),
            durationMs: z.number().int().min(1000).max(30000).default(3000),
          })
          .parse(input);
        return await windowsSystemControl.showNotification(parsed);
      },
    }),
    defineTool({
      name: 'system_get_registry_value',
      description: 'Read a Windows registry key or a specific registry value.',
      inputSchema: z.object({
        keyPath: z.string(),
        valueName: z.string().optional(),
      }),
      annotations: {
        readOnlyHint: true,
        openWorldHint: false,
      },
      execute: async (input) => {
        const parsed = z
          .object({
            keyPath: z.string(),
            valueName: z.string().optional(),
          })
          .parse(input);
        return await windowsSystemControl.getRegistryValue(parsed);
      },
    }),
    defineTool({
      name: 'system_set_registry_value',
      description: 'Create or update a Windows registry value.',
      inputSchema: z.object({
        keyPath: z.string(),
        valueName: z.string(),
        value: z.union([z.string(), z.number(), z.boolean(), z.array(z.string())]),
        valueType: z
          .enum(['String', 'ExpandString', 'Binary', 'DWord', 'QWord', 'MultiString'])
          .optional(),
      }),
      annotations: {
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      },
      execute: async (input) => {
        const parsed = z
          .object({
            keyPath: z.string(),
            valueName: z.string(),
            value: z.union([z.string(), z.number(), z.boolean(), z.array(z.string())]),
            valueType: z
              .enum(['String', 'ExpandString', 'Binary', 'DWord', 'QWord', 'MultiString'])
              .optional(),
          })
          .parse(input);
        return await windowsSystemControl.setRegistryValue(parsed);
      },
    }),
    defineTool({
      name: 'system_delete_registry_value',
      description: 'Delete a Windows registry value.',
      inputSchema: z.object({
        keyPath: z.string(),
        valueName: z.string(),
      }),
      annotations: {
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      },
      execute: async (input) => {
        const parsed = z
          .object({
            keyPath: z.string(),
            valueName: z.string(),
          })
          .parse(input);
        return await windowsSystemControl.deleteRegistryValue(parsed);
      },
    }),
  ];

  const toolDefinitionMap = new Map(
    toolDefinitions.map((toolDefinition) => [toolDefinition.name, toolDefinition]),
  );

  return {
    toolDefinitions,
    getToolDefinition: (name) => toolDefinitionMap.get(name),
    executeToolCall: async (name, input) => {
      const toolDefinition = toolDefinitionMap.get(name);

      if (!toolDefinition) {
        throw new Error(`unknown tool: ${name}`);
      }

      if (!toolDefinition.inputSchema) {
        return await toolDefinition.execute(undefined);
      }

      const parsedInput = toolDefinition.inputSchema.parse(input);
      return await toolDefinition.execute(parsedInput);
    },
  };
}
