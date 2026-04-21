import path from 'node:path';

import { BrowserSessionRegistry } from './browserSessionRegistry.js';
import { ChatGptMcpApprovalWatcher } from './chatGptMcpApprovalWatcher.js';
import { ChromeRemoteDebuggingApprovalWatcher } from './chromeRemoteDebuggingApprovalWatcher.js';
import { CommandSessionRegistry } from './commandSessionRegistry.js';
import { type FullAccessServerSettings } from './settings.js';
import { selectReadOnlyGatewayToolDefinitions } from './readOnlyGatewayToolCatalog.js';
import { createFullAccessToolCatalog } from './toolCatalog.js';
import { WindowsDesktopAutomation } from './windowsDesktopAutomation.js';
import { WindowsSystemControl } from './windowsSystemControl.js';
import { WorkspaceFileAccess } from './workspaceFileAccess.js';

export interface LocalWorkstationRuntime {
  settings: FullAccessServerSettings;
  workspaceFileAccess: WorkspaceFileAccess;
  commandSessionRegistry: CommandSessionRegistry;
  browserSessionRegistry: BrowserSessionRegistry;
  windowsDesktopAutomation: WindowsDesktopAutomation;
  windowsSystemControl: WindowsSystemControl;
  toolCatalog: ReturnType<typeof createFullAccessToolCatalog>;
  close: () => Promise<void>;
}

export function createLocalWorkstationRuntime(
  settings: FullAccessServerSettings,
): LocalWorkstationRuntime {
  const workspaceFileAccess = new WorkspaceFileAccess(
    settings.workspaceRoots,
    settings.allowComputerWideAccess,
  );
  const commandSessionRegistry = new CommandSessionRegistry(
    workspaceFileAccess,
    settings.commandOutputLimit,
    settings.processSessionIdleTtlMs,
  );
  const browserSessionRegistry = new BrowserSessionRegistry(
    workspaceFileAccess,
    settings.browserEnabled,
    settings.browserHeadless,
    settings.browserStorageRoot,
  );
  const windowsDesktopAutomation = new WindowsDesktopAutomation(workspaceFileAccess);
  const windowsSystemControl = new WindowsSystemControl(workspaceFileAccess);
  const chromeRemoteDebuggingApprovalWatcher =
    new ChromeRemoteDebuggingApprovalWatcher(
      windowsDesktopAutomation,
      settings.chromeRemoteDebuggingAutoAllowEnabled,
      settings.chromeRemoteDebuggingAutoAllowPollIntervalMs,
      () => {
        chatGptMcpApprovalWatcher.triggerFromRemoteDebuggingApproval();
      },
    );
  const chatGptMcpApprovalWatcher = new ChatGptMcpApprovalWatcher(
    browserSessionRegistry,
    settings.chatGptMcpAutoAllowEnabled,
    settings.chatGptMcpAutoAllowPollIntervalMs,
  );
  const toolCatalog = createFullAccessToolCatalog({
    settings,
    workspaceFileAccess,
    commandSessionRegistry,
    browserSessionRegistry,
    windowsDesktopAutomation,
    windowsSystemControl,
  });

  chromeRemoteDebuggingApprovalWatcher.start();
  return {
    settings,
    workspaceFileAccess,
    commandSessionRegistry,
    browserSessionRegistry,
    windowsDesktopAutomation,
    windowsSystemControl,
    toolCatalog,
    close: async () => {
      await Promise.all([
        commandSessionRegistry.closeAll(),
        browserSessionRegistry.closeAll(),
        chromeRemoteDebuggingApprovalWatcher.stop(),
        chatGptMcpApprovalWatcher.stop(),
      ]);
    },
  };
}

export function createFullAccessToolMetadataCatalog(
  cwd = process.cwd(),
): {
  toolDefinitions: ReturnType<typeof createFullAccessToolCatalog>['toolDefinitions'];
  close: () => Promise<void>;
} {
  const metadataSettings: FullAccessServerSettings = {
    host: '127.0.0.1',
    port: 0,
    authToken: undefined,
    corsOrigin: '*',
    httpRequestBodyLimitBytes: 32_768,
    workspaceRoots: [cwd],
    allowComputerWideAccess: false,
    commandOutputLimit: 8_192,
    processSessionIdleTtlMs: 1_000,
    localBridgeEnabled: false,
    localBridgeToken: undefined,
    localBridgeRequireLoopback: true,
    localBridgeRequireLocalHostHeader: true,
    localBridgeRejectWebOrigins: true,
    localBridgeAllowedClients: [],
    localBridgeStartLocked: true,
    localBridgeAuditLogEnabled: false,
    localBridgeAuditLogPath: path.resolve(cwd, '.full-access-mcp/metadata-audit.log'),
    browserEnabled: false,
    browserHeadless: true,
    browserStorageRoot: path.resolve(cwd, '.full-access-mcp/metadata-browser'),
    chromeRemoteDebuggingAutoAllowEnabled: false,
    chromeRemoteDebuggingAutoAllowPollIntervalMs: 5_000,
    chatGptMcpAutoAllowEnabled: false,
    chatGptMcpAutoAllowPollIntervalMs: 5_000,
  };
  const runtime = createLocalWorkstationRuntime(metadataSettings);

  return {
    toolDefinitions: runtime.toolCatalog.toolDefinitions,
    close: runtime.close,
  };
}

export function createReadOnlyToolMetadataCatalog(
  cwd = process.cwd(),
): {
  toolDefinitions: ReturnType<typeof createFullAccessToolCatalog>['toolDefinitions'];
  close: () => Promise<void>;
} {
  const fullAccessToolMetadataCatalog = createFullAccessToolMetadataCatalog(cwd);

  return {
    toolDefinitions: selectReadOnlyGatewayToolDefinitions(
      fullAccessToolMetadataCatalog.toolDefinitions,
    ),
    close: fullAccessToolMetadataCatalog.close,
  };
}
