import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

interface SessionIndexRecord {
  id: string;
  thread_name?: string;
  updated_at?: string;
}

interface SessionMetaPayload {
  id?: string;
  timestamp?: string;
  cwd?: string;
  originator?: string;
  cli_version?: string;
  agent_nickname?: string;
  agent_role?: string;
  model_provider?: string;
  source?: unknown;
}

export interface CodexSessionArtifactSummary {
  path: string;
  archived: boolean;
  sessionId: string | null;
  threadName: string | null;
  startedAt: string | null;
  updatedAt: string | null;
  cwd: string | null;
  originator: string | null;
  cliVersion: string | null;
  agentNickname: string | null;
  agentRole: string | null;
}

export interface CodexSessionArtifactEventPreview {
  timestamp: string | null;
  type: string;
  preview: string;
}

export interface CodexSessionArtifactDescription {
  path: string;
  archived: boolean;
  totalLineCount: number;
  sessionMeta: {
    sessionId: string | null;
    threadName: string | null;
    startedAt: string | null;
    updatedAt: string | null;
    cwd: string | null;
    originator: string | null;
    cliVersion: string | null;
    agentNickname: string | null;
    agentRole: string | null;
    modelProvider: string | null;
    sourcePreview: string | null;
  };
  eventTypeCounts: Record<string, number>;
  events: CodexSessionArtifactEventPreview[];
}

function getDefaultCodexHomePath(): string {
  return process.env.CODEX_HOME?.trim() || path.join(os.homedir(), '.codex');
}

function normalizePath(value: string): string {
  return path.normalize(value).toLowerCase();
}

function stringifyPreview(value: unknown, maxLength: number): string {
  const rawPreview =
    typeof value === 'string' ? value : JSON.stringify(value, null, 2) ?? '';
  const normalizedPreview = rawPreview.replace(/\s+/g, ' ').trim();

  if (normalizedPreview.length <= maxLength) {
    return normalizedPreview;
  }

  return `${normalizedPreview.slice(0, maxLength - 1)}…`;
}

function parseJsonLine<T>(line: string): T | null {
  try {
    return JSON.parse(line) as T;
  } catch {
    return null;
  }
}

async function readOptionalText(filePath: string): Promise<string | null> {
  try {
    return await fs.readFile(filePath, 'utf8');
  } catch {
    return null;
  }
}

async function readSessionIndexRecords(
  codexHomePath: string,
): Promise<Map<string, SessionIndexRecord>> {
  const sessionIndexPath = path.join(codexHomePath, 'session_index.jsonl');
  const sessionIndexContent = await readOptionalText(sessionIndexPath);
  const recordMap = new Map<string, SessionIndexRecord>();

  if (!sessionIndexContent) {
    return recordMap;
  }

  for (const line of sessionIndexContent.split(/\r?\n/)) {
    if (!line.trim()) {
      continue;
    }

    const parsedRecord = parseJsonLine<SessionIndexRecord>(line);
    if (!parsedRecord?.id) {
      continue;
    }

    recordMap.set(parsedRecord.id, parsedRecord);
  }

  return recordMap;
}

async function collectJsonlFiles(rootPath: string): Promise<string[]> {
  const collectedPaths: string[] = [];

  async function visit(currentPath: string): Promise<void> {
    const stats = await fs.stat(currentPath);
    if (stats.isFile()) {
      if (currentPath.toLowerCase().endsWith('.jsonl')) {
        collectedPaths.push(currentPath);
      }

      return;
    }

    const children = await fs.readdir(currentPath, { withFileTypes: true });
    for (const child of children) {
      await visit(path.join(currentPath, child.name));
    }
  }

  try {
    await visit(rootPath);
  } catch {
    return [];
  }

  return collectedPaths;
}

async function readSessionMetaPayload(
  sessionPath: string,
): Promise<SessionMetaPayload | null> {
  const sessionContent = await readOptionalText(sessionPath);
  if (!sessionContent) {
    return null;
  }

  const firstNonEmptyLine = sessionContent
    .split(/\r?\n/)
    .find((line) => line.trim().length > 0);
  const parsedFirstLine = firstNonEmptyLine
    ? parseJsonLine<{ type?: string; payload?: SessionMetaPayload }>(firstNonEmptyLine)
    : null;

  if (parsedFirstLine?.type !== 'session_meta') {
    return null;
  }

  return parsedFirstLine.payload ?? null;
}

function matchesFilter(value: string | null, filter: string | undefined): boolean {
  if (!filter?.trim()) {
    return true;
  }

  if (!value) {
    return false;
  }

  return value.toLowerCase().includes(filter.trim().toLowerCase());
}

export async function listCodexSessionArtifacts(options: {
  codexHomePath?: string;
  query?: string;
  cwdContains?: string;
  includeArchived?: boolean;
  limit?: number;
}): Promise<{
  codexHomePath: string;
  artifacts: CodexSessionArtifactSummary[];
}> {
  const codexHomePath = options.codexHomePath ?? getDefaultCodexHomePath();
  const includeArchived = options.includeArchived ?? true;
  const limit = Math.max(1, Math.min(options.limit ?? 10, 50));
  const sessionIndexRecords = await readSessionIndexRecords(codexHomePath);
  const activeSessionRoot = path.join(codexHomePath, 'sessions');
  const archivedSessionRoot = path.join(codexHomePath, 'archived_sessions');
  const sessionPaths = [
    ...(await collectJsonlFiles(activeSessionRoot)).map((sessionPath) => ({
      path: sessionPath,
      archived: false,
    })),
    ...(includeArchived
      ? (await collectJsonlFiles(archivedSessionRoot)).map((sessionPath) => ({
          path: sessionPath,
          archived: true,
        }))
      : []),
  ];

  const artifacts: CodexSessionArtifactSummary[] = [];

  for (const sessionArtifact of sessionPaths) {
    const sessionMetaPayload = await readSessionMetaPayload(sessionArtifact.path);
    const sessionId =
      sessionMetaPayload?.id ??
      path.basename(sessionArtifact.path).replace(/\.jsonl$/i, '');
    const indexedRecord = sessionId ? sessionIndexRecords.get(sessionId) : undefined;

    const summary: CodexSessionArtifactSummary = {
      path: sessionArtifact.path,
      archived: sessionArtifact.archived,
      sessionId: sessionMetaPayload?.id ?? sessionId ?? null,
      threadName: indexedRecord?.thread_name ?? null,
      startedAt: sessionMetaPayload?.timestamp ?? null,
      updatedAt: indexedRecord?.updated_at ?? null,
      cwd: sessionMetaPayload?.cwd ?? null,
      originator: sessionMetaPayload?.originator ?? null,
      cliVersion: sessionMetaPayload?.cli_version ?? null,
      agentNickname: sessionMetaPayload?.agent_nickname ?? null,
      agentRole: sessionMetaPayload?.agent_role ?? null,
    };

    if (
      !matchesFilter(summary.cwd, options.cwdContains) ||
      !matchesFilter(
        [
          summary.sessionId,
          summary.threadName,
          summary.cwd,
          summary.originator,
          summary.agentNickname,
          summary.agentRole,
          summary.path,
        ]
          .filter(Boolean)
          .join(' '),
        options.query,
      )
    ) {
      continue;
    }

    artifacts.push(summary);
  }

  artifacts.sort((leftArtifact, rightArtifact) => {
    const leftTimestamp = leftArtifact.startedAt ?? leftArtifact.updatedAt ?? '';
    const rightTimestamp = rightArtifact.startedAt ?? rightArtifact.updatedAt ?? '';
    return rightTimestamp.localeCompare(leftTimestamp);
  });

  return {
    codexHomePath,
    artifacts: artifacts.slice(0, limit),
  };
}

function buildEventPreview(
  parsedLine: Record<string, unknown>,
  maxPreviewChars: number,
): string {
  const payload = parsedLine.payload;

  if (parsedLine.type === 'event_msg' && typeof payload === 'object' && payload) {
    const message = (payload as { message?: unknown }).message;
    if (typeof message === 'string' && message.trim()) {
      return stringifyPreview(message, maxPreviewChars);
    }
  }

  if (parsedLine.type === 'response_item' && typeof payload === 'object' && payload) {
    const payloadRecord = payload as { type?: unknown; content?: unknown; role?: unknown };
    if (payloadRecord.type === 'message' && Array.isArray(payloadRecord.content)) {
      const firstText = payloadRecord.content.find((item) => {
        if (!item || typeof item !== 'object') {
          return false;
        }

        const typedItem = item as { text?: unknown; type?: unknown };
        return typeof typedItem.text === 'string' && typedItem.text.trim() !== '';
      }) as { text?: string } | undefined;

      if (firstText?.text) {
        return stringifyPreview(firstText.text, maxPreviewChars);
      }
    }
  }

  return stringifyPreview(payload, maxPreviewChars);
}

export async function describeCodexSessionArtifact(options: {
  path: string;
  maxEvents?: number;
  maxPreviewChars?: number;
}): Promise<CodexSessionArtifactDescription> {
  const maxEvents = Math.max(1, Math.min(options.maxEvents ?? 12, 60));
  const maxPreviewChars = Math.max(80, Math.min(options.maxPreviewChars ?? 280, 1_200));
  const resolvedPath = path.resolve(options.path);
  const sessionContent = await fs.readFile(resolvedPath, 'utf8');
  const sessionLines = sessionContent.split(/\r?\n/).filter((line) => line.trim() !== '');
  const sessionMetaLine = sessionLines
    .map((line) => parseJsonLine<Record<string, unknown>>(line))
    .find((parsedLine) => parsedLine?.type === 'session_meta') as
    | { payload?: SessionMetaPayload }
    | undefined;
  const sessionMetaPayload = sessionMetaLine?.payload ?? null;
  const sessionIndexRecords = await readSessionIndexRecords(getDefaultCodexHomePath());
  const indexedRecord =
    sessionMetaPayload?.id ? sessionIndexRecords.get(sessionMetaPayload.id) : undefined;
  const eventTypeCounts: Record<string, number> = {};
  const eventPreviews: CodexSessionArtifactEventPreview[] = [];

  for (const sessionLine of sessionLines) {
    const parsedLine = parseJsonLine<Record<string, unknown>>(sessionLine);
    if (!parsedLine || typeof parsedLine.type !== 'string') {
      continue;
    }

    eventTypeCounts[parsedLine.type] = (eventTypeCounts[parsedLine.type] ?? 0) + 1;

    if (parsedLine.type === 'session_meta' || eventPreviews.length >= maxEvents) {
      continue;
    }

    eventPreviews.push({
      timestamp:
        typeof parsedLine.timestamp === 'string' ? parsedLine.timestamp : null,
      type: parsedLine.type,
      preview: buildEventPreview(parsedLine, maxPreviewChars),
    });
  }

  return {
    path: resolvedPath,
    archived: normalizePath(resolvedPath).includes(
      `${path.sep}archived_sessions${path.sep}`,
    ),
    totalLineCount: sessionLines.length,
    sessionMeta: {
      sessionId: sessionMetaPayload?.id ?? null,
      threadName: indexedRecord?.thread_name ?? null,
      startedAt: sessionMetaPayload?.timestamp ?? null,
      updatedAt: indexedRecord?.updated_at ?? null,
      cwd: sessionMetaPayload?.cwd ?? null,
      originator: sessionMetaPayload?.originator ?? null,
      cliVersion: sessionMetaPayload?.cli_version ?? null,
      agentNickname: sessionMetaPayload?.agent_nickname ?? null,
      agentRole: sessionMetaPayload?.agent_role ?? null,
      modelProvider: sessionMetaPayload?.model_provider ?? null,
      sourcePreview:
        sessionMetaPayload?.source === undefined
          ? null
          : stringifyPreview(sessionMetaPayload.source, maxPreviewChars),
    },
    eventTypeCounts,
    events: eventPreviews,
  };
}
