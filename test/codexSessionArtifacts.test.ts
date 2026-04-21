import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  describeCodexSessionArtifact,
  listCodexSessionArtifacts,
} from '../src/codexSessionArtifacts.js';

test('listCodexSessionArtifacts lists active and archived Codex session files', async () => {
  const temporaryCodexHome = await fs.mkdtemp(
    path.join(os.tmpdir(), 'full-access-mcp-codex-home-'),
  );

  try {
    const activeSessionPath = path.join(
      temporaryCodexHome,
      'sessions',
      '2026',
      '03',
      '20',
      'rollout-active.jsonl',
    );
    const archivedSessionPath = path.join(
      temporaryCodexHome,
      'archived_sessions',
      'rollout-archived.jsonl',
    );
    await fs.mkdir(path.dirname(activeSessionPath), { recursive: true });
    await fs.mkdir(path.dirname(archivedSessionPath), { recursive: true });
    await fs.writeFile(
      path.join(temporaryCodexHome, 'session_index.jsonl'),
      [
        JSON.stringify({
          id: 'session-active',
          thread_name: 'People finder review',
          updated_at: '2026-03-20T02:00:00.000Z',
        }),
        JSON.stringify({
          id: 'session-archived',
          thread_name: 'Old archived thread',
          updated_at: '2026-03-19T02:00:00.000Z',
        }),
      ].join('\n'),
      'utf8',
    );
    await fs.writeFile(
      activeSessionPath,
      [
        JSON.stringify({
          timestamp: '2026-03-20T01:00:00.000Z',
          type: 'session_meta',
          payload: {
            id: 'session-active',
            timestamp: '2026-03-20T01:00:00.000Z',
            cwd: 'C:\\Users\\USER\\Desktop\\사람 찾기',
            originator: 'Codex Desktop',
          },
        }),
      ].join('\n'),
      'utf8',
    );
    await fs.writeFile(
      archivedSessionPath,
      [
        JSON.stringify({
          timestamp: '2026-03-19T01:00:00.000Z',
          type: 'session_meta',
          payload: {
            id: 'session-archived',
            timestamp: '2026-03-19T01:00:00.000Z',
            cwd: 'C:\\Users\\USER\\Desktop\\GPT server',
            originator: 'Codex Desktop',
          },
        }),
      ].join('\n'),
      'utf8',
    );

    const listedArtifacts = await listCodexSessionArtifacts({
      codexHomePath: temporaryCodexHome,
      query: 'People finder',
      includeArchived: true,
      limit: 10,
    });

    assert.equal(listedArtifacts.artifacts.length, 1);
    assert.equal(listedArtifacts.artifacts[0]?.sessionId, 'session-active');
    assert.equal(listedArtifacts.artifacts[0]?.threadName, 'People finder review');
    assert.equal(listedArtifacts.artifacts[0]?.archived, false);
  } finally {
    await fs.rm(temporaryCodexHome, { recursive: true, force: true });
  }
});

test('describeCodexSessionArtifact summarizes session metadata and event previews', async () => {
  const temporaryCodexHome = await fs.mkdtemp(
    path.join(os.tmpdir(), 'full-access-mcp-codex-detail-'),
  );

  const originalCodexHome = process.env.CODEX_HOME;

  try {
    process.env.CODEX_HOME = temporaryCodexHome;

    const sessionPath = path.join(
      temporaryCodexHome,
      'sessions',
      '2026',
      '03',
      '20',
      'rollout-detail.jsonl',
    );
    await fs.mkdir(path.dirname(sessionPath), { recursive: true });
    await fs.writeFile(
      path.join(temporaryCodexHome, 'session_index.jsonl'),
      JSON.stringify({
        id: 'session-detail',
        thread_name: 'Detailed thread',
        updated_at: '2026-03-20T05:00:00.000Z',
      }),
      'utf8',
    );
    await fs.writeFile(
      sessionPath,
      [
        JSON.stringify({
          timestamp: '2026-03-20T04:00:00.000Z',
          type: 'session_meta',
          payload: {
            id: 'session-detail',
            timestamp: '2026-03-20T04:00:00.000Z',
            cwd: 'C:\\Users\\USER\\Desktop\\사람 찾기',
            originator: 'Codex Desktop',
            cli_version: '0.115.0',
            agent_nickname: 'Gauss',
            agent_role: 'explorer',
            model_provider: 'openai',
          },
        }),
        JSON.stringify({
          timestamp: '2026-03-20T04:01:00.000Z',
          type: 'event_msg',
          payload: {
            type: 'user_message',
            message: '사람 찾기 프로젝트를 다시 봐줘',
          },
        }),
        JSON.stringify({
          timestamp: '2026-03-20T04:02:00.000Z',
          type: 'response_item',
          payload: {
            type: 'message',
            role: 'assistant',
            content: [{ type: 'output_text', text: '리뷰를 진행하겠습니다.' }],
          },
        }),
      ].join('\n'),
      'utf8',
    );

    const artifactDescription = await describeCodexSessionArtifact({
      path: sessionPath,
      maxEvents: 5,
      maxPreviewChars: 120,
    });

    assert.equal(artifactDescription.sessionMeta.sessionId, 'session-detail');
    assert.equal(artifactDescription.sessionMeta.threadName, 'Detailed thread');
    assert.equal(artifactDescription.sessionMeta.agentNickname, 'Gauss');
    assert.equal(artifactDescription.eventTypeCounts.event_msg, 1);
    assert.equal(artifactDescription.eventTypeCounts.response_item, 1);
    assert.match(artifactDescription.events[0]?.preview ?? '', /사람 찾기 프로젝트/);
  } finally {
    if (originalCodexHome === undefined) {
      delete process.env.CODEX_HOME;
    } else {
      process.env.CODEX_HOME = originalCodexHome;
    }

    await fs.rm(temporaryCodexHome, { recursive: true, force: true });
  }
});
