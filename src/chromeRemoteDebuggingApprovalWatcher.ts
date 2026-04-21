import { WindowsDesktopAutomation } from './windowsDesktopAutomation.js';

type ChromeRemoteDebuggingApprovalResult = {
  foundPrompt?: boolean;
  approved?: boolean;
  buttonName?: string | null;
  window?: {
    title?: string;
    processId?: number;
  } | null;
};

function sleep(delayMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });
}

export class ChromeRemoteDebuggingApprovalWatcher {
  private intervalHandle: NodeJS.Timeout | undefined;
  private pollInFlight = false;

  constructor(
    private readonly windowsDesktopAutomation: WindowsDesktopAutomation,
    private readonly enabled: boolean,
    private readonly pollIntervalMs: number,
    private readonly onApproved?: () => void,
  ) {}

  start(): void {
    if (!this.enabled || this.intervalHandle) {
      return;
    }

    this.intervalHandle = setInterval(() => {
      void this.poll();
    }, this.pollIntervalMs);
    this.intervalHandle.unref?.();
    void this.poll();
  }

  async stop(): Promise<void> {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = undefined;
    }

    while (this.pollInFlight) {
      await sleep(25);
    }
  }

  private async poll(): Promise<void> {
    if (this.pollInFlight) {
      return;
    }

    this.pollInFlight = true;

    try {
      const result =
        (await this.windowsDesktopAutomation.approveChromeRemoteDebuggingPrompt()) as ChromeRemoteDebuggingApprovalResult;

      if (result.approved) {
        const windowTitle = result.window?.title || 'Chrome';
        const buttonName = result.buttonName || 'Allow';
        console.info(
          `auto-approved Chrome remote debugging prompt in "${windowTitle}" using "${buttonName}"`,
        );
        this.onApproved?.();
      }
    } catch (error) {
      console.error('failed to auto-approve Chrome remote debugging prompt', error);
    } finally {
      this.pollInFlight = false;
    }
  }
}
