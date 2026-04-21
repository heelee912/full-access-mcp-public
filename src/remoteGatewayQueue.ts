import { randomUUID } from 'node:crypto';

export interface RemoteToolCallTask {
  taskId: string;
  toolName: string;
  arguments: unknown;
  enqueuedAt: string;
}

export interface RemoteWorkstationSnapshot {
  workstationId: string;
  connected: boolean;
  lastSeenAt: string | null;
  pendingTaskCount: number;
  inflightTaskCount: number;
}

export type RemoteToolCallStatus = 'completed' | 'failed' | 'timed_out';

export interface RemoteToolCallTraceRecord {
  taskId: string;
  toolName: string;
  arguments: unknown;
  status: RemoteToolCallStatus;
  enqueuedAt: string;
  startedAt: string | null;
  finishedAt: string;
  durationMs: number | null;
  errorMessage: string | null;
}

interface PendingRemoteToolCall extends RemoteToolCallTask {
  enqueuedAtMs: number;
  startedAtMs: number | null;
  timeoutHandle?: NodeJS.Timeout;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}

export class RemoteGatewayQueue {
  private readonly pendingTasks: PendingRemoteToolCall[] = [];

  private readonly inflightTasks = new Map<string, PendingRemoteToolCall>();

  private readonly waitingPollResolvers = new Set<(task: RemoteToolCallTask | null) => void>();

  private readonly recentToolCalls: RemoteToolCallTraceRecord[] = [];

  private lastSeenAtMs: number | null = null;

  constructor(
    private readonly workstationId: string,
    private readonly toolCallTimeoutMs: number,
    private readonly pollTimeoutMs: number,
    private readonly staleAfterMs: number,
    private readonly recentToolCallLimit: number,
  ) {}

  private markAgentSeen(): void {
    this.lastSeenAtMs = Date.now();
  }

  private isWorkstationConnected(): boolean {
    return (
      this.lastSeenAtMs !== null && Date.now() - this.lastSeenAtMs <= this.staleAfterMs
    );
  }

  private dispatchNextTask(): void {
    if (this.pendingTasks.length === 0 || this.waitingPollResolvers.size === 0) {
      return;
    }

    const nextTask = this.pendingTasks.shift();
    const nextResolver = this.waitingPollResolvers.values().next().value;

    if (!nextTask || !nextResolver) {
      return;
    }

    this.waitingPollResolvers.delete(nextResolver);
    nextTask.startedAtMs = Date.now();
    this.inflightTasks.set(nextTask.taskId, nextTask);
    this.logTraceEvent(
      `started tool "${nextTask.toolName}" (${nextTask.taskId}) for workstation "${this.workstationId}"`,
    );
    nextResolver({
      taskId: nextTask.taskId,
      toolName: nextTask.toolName,
      arguments: nextTask.arguments,
      enqueuedAt: nextTask.enqueuedAt,
    });
  }

  enqueueToolCall(toolName: string, argumentsPayload: unknown): Promise<unknown> {
    const taskId = randomUUID();
    const enqueuedAtMs = Date.now();
    const enqueuedAt = new Date(enqueuedAtMs).toISOString();

    return awaitablePromise<unknown>((resolve, reject) => {
      const pendingTask: PendingRemoteToolCall = {
        taskId,
        toolName,
        arguments: argumentsPayload,
        enqueuedAt,
        enqueuedAtMs,
        startedAtMs: null,
        resolve,
        reject,
      };

      pendingTask.timeoutHandle = setTimeout(() => {
        this.removePendingTask(taskId);
        this.inflightTasks.delete(taskId);
        const timeoutMessage = `remote workstation "${this.workstationId}" did not complete tool call "${toolName}" within ${String(this.toolCallTimeoutMs)}ms`;
        this.recordToolCallTrace(pendingTask, 'timed_out', timeoutMessage);
        this.logTraceEvent(
          `timed out tool "${toolName}" (${taskId}) for workstation "${this.workstationId}"`,
        );
        reject(new Error(timeoutMessage));
      }, this.toolCallTimeoutMs);

      this.pendingTasks.push(pendingTask);
      this.logTraceEvent(
        `queued tool "${toolName}" (${taskId}) for workstation "${this.workstationId}"`,
      );
      this.dispatchNextTask();
    });
  }

  private logTraceEvent(message: string): void {
    console.log(`[remote-gateway] ${message}`);
  }

  private recordToolCallTrace(
    task: PendingRemoteToolCall,
    status: RemoteToolCallStatus,
    errorMessage: string | null = null,
  ): void {
    const finishedAtMs = Date.now();
    const finishedAt = new Date(finishedAtMs).toISOString();

    this.recentToolCalls.unshift({
      taskId: task.taskId,
      toolName: task.toolName,
      arguments: task.arguments,
      status,
      enqueuedAt: task.enqueuedAt,
      startedAt: task.startedAtMs ? new Date(task.startedAtMs).toISOString() : null,
      finishedAt,
      durationMs:
        task.startedAtMs === null ? null : finishedAtMs - task.startedAtMs,
      errorMessage,
    });

    if (this.recentToolCalls.length > this.recentToolCallLimit) {
      this.recentToolCalls.length = this.recentToolCallLimit;
    }
  }

  private removePendingTask(taskId: string): void {
    const taskIndex = this.pendingTasks.findIndex((task) => task.taskId === taskId);
    if (taskIndex !== -1) {
      const [removedTask] = this.pendingTasks.splice(taskIndex, 1);
      if (removedTask?.timeoutHandle) {
        clearTimeout(removedTask.timeoutHandle);
      }
    }
  }

  async pollNextTask(): Promise<RemoteToolCallTask | null> {
    this.markAgentSeen();

    if (this.pendingTasks.length > 0) {
      const task = this.pendingTasks.shift();
      if (!task) {
        return null;
      }

      task.startedAtMs = Date.now();
      this.inflightTasks.set(task.taskId, task);
      this.logTraceEvent(
        `started tool "${task.toolName}" (${task.taskId}) for workstation "${this.workstationId}"`,
      );
      return {
        taskId: task.taskId,
        toolName: task.toolName,
        arguments: task.arguments,
        enqueuedAt: task.enqueuedAt,
      };
    }

    return await new Promise<RemoteToolCallTask | null>((resolve) => {
      const resolver = (task: RemoteToolCallTask | null) => resolve(task);
      this.waitingPollResolvers.add(resolver);

      setTimeout(() => {
        if (this.waitingPollResolvers.delete(resolver)) {
          resolve(null);
        }
      }, this.pollTimeoutMs);
    });
  }

  completeTask(taskId: string, result: unknown): void {
    const task = this.inflightTasks.get(taskId);
    if (!task) {
      throw new Error(`unknown remote task: ${taskId}`);
    }

    if (task.timeoutHandle) {
      clearTimeout(task.timeoutHandle);
    }

    this.inflightTasks.delete(taskId);
    this.recordToolCallTrace(task, 'completed');
    this.logTraceEvent(
      `completed tool "${task.toolName}" (${task.taskId}) for workstation "${this.workstationId}"`,
    );
    task.resolve(result);
  }

  failTask(taskId: string, errorMessage: string): void {
    const task = this.inflightTasks.get(taskId);
    if (!task) {
      throw new Error(`unknown remote task: ${taskId}`);
    }

    if (task.timeoutHandle) {
      clearTimeout(task.timeoutHandle);
    }

    this.inflightTasks.delete(taskId);
    this.recordToolCallTrace(task, 'failed', errorMessage);
    this.logTraceEvent(
      `failed tool "${task.toolName}" (${task.taskId}) for workstation "${this.workstationId}": ${errorMessage}`,
    );
    task.reject(new Error(errorMessage));
  }

  getRecentToolCalls(): RemoteToolCallTraceRecord[] {
    return this.recentToolCalls.map((record) => ({
      ...record,
      arguments: record.arguments,
    }));
  }

  getWorkstationSnapshot(): RemoteWorkstationSnapshot {
    return {
      workstationId: this.workstationId,
      connected: this.isWorkstationConnected(),
      lastSeenAt: this.lastSeenAtMs ? new Date(this.lastSeenAtMs).toISOString() : null,
      pendingTaskCount: this.pendingTasks.length,
      inflightTaskCount: this.inflightTasks.size,
    };
  }

  async close(): Promise<void> {
    for (const resolve of this.waitingPollResolvers) {
      resolve(null);
    }
    this.waitingPollResolvers.clear();

    for (const task of this.pendingTasks) {
      if (task.timeoutHandle) {
        clearTimeout(task.timeoutHandle);
      }
      task.reject(new Error('remote gateway is shutting down'));
    }

    for (const task of this.inflightTasks.values()) {
      if (task.timeoutHandle) {
        clearTimeout(task.timeoutHandle);
      }
      task.reject(new Error('remote gateway is shutting down'));
    }

    this.pendingTasks.length = 0;
    this.inflightTasks.clear();
  }
}

function awaitablePromise<T>(
  executor: (
    resolve: (value: T | PromiseLike<T>) => void,
    reject: (reason?: unknown) => void,
  ) => void,
): Promise<T> {
  return new Promise<T>(executor);
}
