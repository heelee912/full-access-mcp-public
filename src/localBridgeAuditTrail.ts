import { appendFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

export interface LocalBridgeAuditRecord {
  timestamp: string;
  method: string;
  pathname: string;
  clientId: string;
  remoteAddress: string;
  authorized: boolean;
  outcome: 'allowed' | 'blocked' | 'error';
  details?: Record<string, unknown>;
}

export class LocalBridgeAuditTrail {
  constructor(
    private readonly auditLogPath: string,
    private readonly enabled: boolean,
  ) {}

  async record(record: LocalBridgeAuditRecord): Promise<void> {
    if (!this.enabled) {
      return;
    }

    await mkdir(path.dirname(this.auditLogPath), { recursive: true });
    await appendFile(
      this.auditLogPath,
      `${JSON.stringify(record)}\n`,
      'utf8',
    );
  }

  describe(): { enabled: boolean; path: string } {
    return {
      enabled: this.enabled,
      path: this.auditLogPath,
    };
  }
}
