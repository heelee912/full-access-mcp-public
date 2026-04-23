import { BrowserSessionRegistry } from './browserSessionRegistry.js';
import { WindowsDesktopAutomation } from './windowsDesktopAutomation.js';

type ChatGptMcpApprovalResult = {
  foundPrompt?: boolean;
  approved?: boolean;
  remembered?: boolean;
  buttonName?: string | null;
  pageId?: number | null;
  url?: string | null;
  reason?: string;
};

function sleep(delayMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });
}

export class ChatGptMcpApprovalWatcher {
  private approvalRunInFlight = false;
  private lastErrorSignature: string | undefined;
  private pollTimer: ReturnType<typeof setInterval> | undefined;

  constructor(
    private readonly browserSessionRegistry: BrowserSessionRegistry,
    private readonly windowsDesktopAutomation: WindowsDesktopAutomation,
    private readonly enabled: boolean,
    private readonly pollIntervalMs: number,
  ) {}

  start(): void {
    if (!this.enabled || this.pollTimer) {
      return;
    }

    console.info(
      `arming ChatGPT MCP approval watcher (interval=${String(this.pollIntervalMs)}ms)`,
    );

    this.pollTimer = setInterval(() => {
      if (!this.enabled || this.approvalRunInFlight) {
        return;
      }

      void this.runApprovalSequence();
    }, this.pollIntervalMs);
  }

  async stop(): Promise<void> {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = undefined;
    }

    while (this.approvalRunInFlight) {
      await sleep(25);
    }
  }

  triggerFromRemoteDebuggingApproval(): void {
    if (!this.enabled || this.approvalRunInFlight) {
      return;
    }

    void this.runApprovalSequence();
  }

  private async runApprovalSequence(): Promise<void> {
    if (this.approvalRunInFlight) {
      return;
    }

    this.approvalRunInFlight = true;

    try {
      for (let attempt = 0; attempt < 12; attempt += 1) {
        const desktopResult =
          (await this.windowsDesktopAutomation.approveChatGptMcpPrompt()) as ChatGptMcpApprovalResult;
        let result = desktopResult;

        if (!desktopResult.approved && this.browserSessionRegistry.hasAttachedBrowserClient()) {
          const browserResult =
            (await this.browserSessionRegistry.approveChatGptMcpPrompt()) as ChatGptMcpApprovalResult;

          result = browserResult.approved
            ? browserResult
            : {
                ...browserResult,
                foundPrompt: Boolean(desktopResult.foundPrompt || browserResult.foundPrompt),
                remembered: Boolean(desktopResult.remembered || browserResult.remembered),
                buttonName: browserResult.buttonName ?? desktopResult.buttonName,
                pageId: browserResult.pageId ?? desktopResult.pageId,
                url: browserResult.url ?? desktopResult.url,
                reason: browserResult.reason ?? desktopResult.reason,
              };
        }

        this.lastErrorSignature = undefined;

        if (result.approved) {
          console.info(
            `auto-approved ChatGPT MCP prompt on page ${String(result.pageId ?? 'unknown')} using "${result.buttonName ?? 'unknown'}"`,
          );
          return;
        }

        if (result.foundPrompt) {
          await sleep(this.pollIntervalMs);
          continue;
        }

        if (result.reason === 'no-chatgpt-page' || result.reason === 'not-chatgpt') {
          await sleep(this.pollIntervalMs);
          continue;
        }

        return;
      }
    } catch (error) {
      const errorSignature =
        error instanceof Error ? error.message : String(error);

      if (errorSignature !== this.lastErrorSignature) {
        console.error('failed to auto-approve ChatGPT MCP prompt', error);
        this.lastErrorSignature = errorSignature;
      }
    } finally {
      this.approvalRunInFlight = false;
    }
  }
}
