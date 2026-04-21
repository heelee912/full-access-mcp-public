import { randomUUID } from 'node:crypto';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';

import { WorkspaceFileAccess } from './workspaceFileAccess.js';

interface CommandChunk {
  sequence: number;
  stream: 'stdout' | 'stderr' | 'system';
  text: string;
}

interface CommandSession {
  id: string;
  command: string;
  arguments: string[];
  cwd: string;
  shell: boolean;
  startedAt: string;
  updatedAtMs: number;
  nextSequence: number;
  earliestSequence: number;
  bufferedBytes: number;
  exitCode: number | null;
  signalCode: NodeJS.Signals | null;
  closed: boolean;
  childProcess: ChildProcessWithoutNullStreams;
  chunks: CommandChunk[];
}

interface StartedCommandSession {
  sessionId: string;
  pid: number | undefined;
  cwd: string;
  commandLine: string;
  startedAt: string;
}

interface CommandSessionSnapshot {
  sessionId: string;
  pid: number | undefined;
  cwd: string;
  commandLine: string;
  startedAt: string;
  exitCode: number | null;
  signalCode: NodeJS.Signals | null;
  closed: boolean;
  trimmedBeforeSequence: number;
  nextSequence: number;
  chunks: CommandChunk[];
}

function describeCommandLine(command: string, argumentsList: string[]): string {
  return [command, ...argumentsList].join(' ').trim();
}

async function terminateProcessTree(
  childProcess: ChildProcessWithoutNullStreams,
  force = false,
): Promise<void> {
  if (childProcess.exitCode !== null || childProcess.killed) {
    return;
  }

  if (process.platform === 'win32' && childProcess.pid) {
    await new Promise<void>((resolve) => {
      const killer = spawn('taskkill', [
        '/pid',
        String(childProcess.pid),
        '/t',
        force ? '/f' : '',
      ].filter(Boolean));

      killer.once('close', () => resolve());
      killer.once('error', () => resolve());
    });
    return;
  }

  childProcess.kill(force ? 'SIGKILL' : 'SIGTERM');
}

export class CommandSessionRegistry {
  private readonly sessions = new Map<string, CommandSession>();

  constructor(
    private readonly workspaceFileAccess: WorkspaceFileAccess,
    private readonly outputLimit: number,
    private readonly idleTtlMs: number,
  ) {}

  private pruneExpiredSessions(): void {
    const now = Date.now();

    for (const [sessionId, session] of this.sessions) {
      if (!session.closed) {
        continue;
      }

      if (now - session.updatedAtMs > this.idleTtlMs) {
        this.sessions.delete(sessionId);
      }
    }
  }

  private appendChunk(
    session: CommandSession,
    stream: CommandChunk['stream'],
    text: string,
  ): void {
    if (text.length === 0) {
      return;
    }

    const chunk: CommandChunk = {
      sequence: session.nextSequence,
      stream,
      text,
    };

    session.nextSequence += 1;
    session.updatedAtMs = Date.now();
    session.bufferedBytes += Buffer.byteLength(text);
    session.chunks.push(chunk);

    while (session.bufferedBytes > this.outputLimit && session.chunks.length > 0) {
      const removedChunk = session.chunks.shift()!;
      session.bufferedBytes -= Buffer.byteLength(removedChunk.text);
      session.earliestSequence = removedChunk.sequence + 1;
    }
  }

  private spawnChildProcess(options: {
    command: string;
    arguments?: string[];
    cwd?: string;
    shell?: boolean;
    environment?: Record<string, string>;
  }): {
    childProcess: ChildProcessWithoutNullStreams;
    cwd: string;
    shell: boolean;
    arguments: string[];
  } {
    const commandArguments = options.arguments ?? [];
    const shell = options.shell ?? commandArguments.length === 0;
    const cwd = this.workspaceFileAccess.resolveWorkspacePath(options.cwd || '.', false);

    const childProcess = spawn(options.command, commandArguments, {
      cwd,
      shell,
      env: {
        ...process.env,
        ...options.environment,
      },
      stdio: 'pipe',
    });

    return {
      childProcess,
      cwd,
      shell,
      arguments: commandArguments,
    };
  }

  async runCommand(options: {
    command: string;
    arguments?: string[];
    cwd?: string;
    shell?: boolean;
    timeoutMs?: number;
    environment?: Record<string, string>;
  }): Promise<{
    commandLine: string;
    cwd: string;
    stdout: string;
    stderr: string;
    exitCode: number | null;
    signalCode: NodeJS.Signals | null;
    timedOut: boolean;
  }> {
    const { childProcess, cwd, arguments: commandArguments } = this.spawnChildProcess(
      options,
    );

    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const appendOutput = (
      currentValue: string,
      nextChunk: Buffer,
    ): string => {
      const combined = currentValue + nextChunk.toString('utf8');
      if (Buffer.byteLength(combined) <= this.outputLimit) {
        return combined;
      }

      const overflow = Buffer.byteLength(combined) - this.outputLimit;
      return combined.slice(overflow);
    };

    childProcess.stdout.on('data', (chunk) => {
      stdout = appendOutput(stdout, chunk as Buffer);
    });
    childProcess.stderr.on('data', (chunk) => {
      stderr = appendOutput(stderr, chunk as Buffer);
    });

    const timeoutMs = options.timeoutMs ?? 120_000;
    let timeoutHandle: NodeJS.Timeout | undefined;

    if (timeoutMs > 0) {
      timeoutHandle = setTimeout(() => {
        timedOut = true;
        void terminateProcessTree(childProcess, true);
      }, timeoutMs);
    }

    return await new Promise((resolve, reject) => {
      childProcess.once('error', (error) => {
        if (timeoutHandle) {
          clearTimeout(timeoutHandle);
        }
        reject(error);
      });

      childProcess.once('close', (exitCode, signalCode) => {
        if (timeoutHandle) {
          clearTimeout(timeoutHandle);
        }

        resolve({
          commandLine: describeCommandLine(options.command, commandArguments),
          cwd,
          stdout,
          stderr,
          exitCode,
          signalCode,
          timedOut,
        });
      });
    });
  }

  async runInlineScript(options: {
    runtime: 'powershell' | 'python' | 'node';
    script: string;
    cwd?: string;
    timeoutMs?: number;
    environment?: Record<string, string>;
  }): Promise<{
    runtime: 'powershell' | 'python' | 'node';
    commandLine: string;
    cwd: string;
    stdout: string;
    stderr: string;
    exitCode: number | null;
    signalCode: NodeJS.Signals | null;
    timedOut: boolean;
  }> {
    const runtimeCommand =
      options.runtime === 'powershell'
        ? {
            command: 'powershell',
            arguments: [
              '-NoProfile',
              '-NonInteractive',
              '-ExecutionPolicy',
              'Bypass',
              '-Command',
              options.script,
            ],
          }
        : options.runtime === 'python'
          ? {
              command: 'python',
              arguments: ['-c', options.script],
            }
          : {
              command: process.execPath,
              arguments: ['--input-type=module', '--eval', options.script],
            };

    const commandResult = await this.runCommand({
      command: runtimeCommand.command,
      arguments: runtimeCommand.arguments,
      cwd: options.cwd,
      shell: false,
      timeoutMs: options.timeoutMs,
      environment: options.environment,
    });

    return {
      runtime: options.runtime,
      ...commandResult,
    };
  }

  startCommandSession(options: {
    command: string;
    arguments?: string[];
    cwd?: string;
    shell?: boolean;
    environment?: Record<string, string>;
  }): StartedCommandSession {
    this.pruneExpiredSessions();

    const {
      childProcess,
      cwd,
      shell,
      arguments: commandArguments,
    } = this.spawnChildProcess(options);
    const sessionId = randomUUID();
    const startedAt = new Date().toISOString();

    const session: CommandSession = {
      id: sessionId,
      command: options.command,
      arguments: commandArguments,
      cwd,
      shell,
      startedAt,
      updatedAtMs: Date.now(),
      nextSequence: 1,
      earliestSequence: 1,
      bufferedBytes: 0,
      exitCode: null,
      signalCode: null,
      closed: false,
      childProcess,
      chunks: [],
    };

    childProcess.stdout.on('data', (chunk) => {
      this.appendChunk(session, 'stdout', chunk.toString('utf8'));
    });

    childProcess.stderr.on('data', (chunk) => {
      this.appendChunk(session, 'stderr', chunk.toString('utf8'));
    });

    childProcess.once('error', (error) => {
      this.appendChunk(session, 'system', `process error: ${String(error)}\n`);
    });

    childProcess.once('close', (exitCode, signalCode) => {
      session.closed = true;
      session.exitCode = exitCode;
      session.signalCode = signalCode;
      session.updatedAtMs = Date.now();
      this.appendChunk(
        session,
        'system',
        `process closed with exitCode=${String(exitCode)} signal=${String(signalCode)}\n`,
      );
    });

    this.sessions.set(sessionId, session);

    return {
      sessionId,
      pid: childProcess.pid,
      cwd,
      commandLine: describeCommandLine(options.command, commandArguments),
      startedAt,
    };
  }

  private getCommandSession(sessionId: string): CommandSession {
    this.pruneExpiredSessions();
    const session = this.sessions.get(sessionId);

    if (!session) {
      throw new Error(`unknown command session: ${sessionId}`);
    }

    return session;
  }

  readCommandSession(sessionId: string, afterSequence = 0): CommandSessionSnapshot {
    const session = this.getCommandSession(sessionId);

    const effectiveAfterSequence =
      afterSequence < session.earliestSequence ? session.earliestSequence - 1 : afterSequence;

    return {
      sessionId,
      pid: session.childProcess.pid,
      cwd: session.cwd,
      commandLine: describeCommandLine(session.command, session.arguments),
      startedAt: session.startedAt,
      exitCode: session.exitCode,
      signalCode: session.signalCode,
      closed: session.closed,
      trimmedBeforeSequence: session.earliestSequence - 1,
      nextSequence: session.nextSequence,
      chunks: session.chunks.filter(
        (chunk) => chunk.sequence > effectiveAfterSequence,
      ),
    };
  }

  writeCommandSession(
    sessionId: string,
    input: string,
    appendNewline = false,
  ): { sessionId: string; bytesWritten: number } {
    const session = this.getCommandSession(sessionId);

    if (session.closed) {
      throw new Error(`command session is already closed: ${sessionId}`);
    }

    const payload = appendNewline ? `${input}\n` : input;
    session.childProcess.stdin.write(payload);

    return {
      sessionId,
      bytesWritten: Buffer.byteLength(payload),
    };
  }

  async stopCommandSession(
    sessionId: string,
    force = false,
  ): Promise<{ sessionId: string; force: boolean }> {
    const session = this.getCommandSession(sessionId);
    await terminateProcessTree(session.childProcess, force);

    return {
      sessionId,
      force,
    };
  }

  listCommandSessions(): Array<{
    sessionId: string;
    commandLine: string;
    cwd: string;
    startedAt: string;
    closed: boolean;
  }> {
    this.pruneExpiredSessions();

    return [...this.sessions.values()].map((session) => ({
      sessionId: session.id,
      commandLine: describeCommandLine(session.command, session.arguments),
      cwd: session.cwd,
      startedAt: session.startedAt,
      closed: session.closed,
    }));
  }

  async closeAll(): Promise<void> {
    const sessions = [...this.sessions.values()];
    await Promise.all(
      sessions.map(async (session) => {
        if (!session.closed) {
          await terminateProcessTree(session.childProcess, true);
        }
      }),
    );
  }
}
