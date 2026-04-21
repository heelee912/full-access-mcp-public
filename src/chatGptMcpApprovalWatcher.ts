import { BrowserSessionRegistry } from './browserSessionRegistry.js';

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

  constructor(
    private readonly browserSessionRegistry: BrowserSessionRegistry,
    private readonly enabled: boolean,
    private readonly pollIntervalMs: number,
  ) {}

  start(): void {}

  async stop(): Promise<void> {
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
        const result =
          (await this.browserSessionRegistry.approveChatGptMcpPrompt()) as ChatGptMcpApprovalResult;

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
