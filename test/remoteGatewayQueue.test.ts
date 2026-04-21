import assert from 'node:assert/strict';
import test from 'node:test';

import { RemoteGatewayQueue } from '../src/remoteGatewayQueue.js';

test('RemoteGatewayQueue dispatches a tool call and resolves the result', async () => {
  const queue = new RemoteGatewayQueue('workstation-a', 5_000, 100, 5_000, 10);

  try {
    const pendingResult = queue.enqueueToolCall('server_describe', {});
    const nextTask = await queue.pollNextTask();

    assert.ok(nextTask);
    assert.equal(nextTask.toolName, 'server_describe');

    queue.completeTask(nextTask.taskId, {
      workspaceRoots: ['C:\\workspace'],
    });

    const resolvedResult = await pendingResult;
    assert.deepEqual(resolvedResult, {
      workspaceRoots: ['C:\\workspace'],
    });
  } finally {
    await queue.close();
  }
});

test('RemoteGatewayQueue rejects failed tool calls', async () => {
  const queue = new RemoteGatewayQueue('workstation-a', 5_000, 100, 5_000, 10);

  try {
    const pendingResult = queue.enqueueToolCall('workspace_read_text', {
      path: 'README.md',
    });
    const nextTask = await queue.pollNextTask();

    assert.ok(nextTask);
    queue.failTask(nextTask.taskId, 'read failed');

    await assert.rejects(pendingResult, /read failed/);
  } finally {
    await queue.close();
  }
});

test('RemoteGatewayQueue returns null when no task arrives during the poll window', async () => {
  const queue = new RemoteGatewayQueue('workstation-a', 5_000, 10, 5_000, 10);

  try {
    const nextTask = await queue.pollNextTask();
    assert.equal(nextTask, null);
  } finally {
    await queue.close();
  }
});

test('RemoteGatewayQueue records recent completed and failed tool calls', async () => {
  const queue = new RemoteGatewayQueue('workstation-a', 5_000, 100, 5_000, 10);

  try {
    const completedResult = queue.enqueueToolCall('server_describe', {});
    const firstTask = await queue.pollNextTask();
    assert.ok(firstTask);
    queue.completeTask(firstTask.taskId, { ok: true });
    await completedResult;

    const failedResult = queue.enqueueToolCall('workspace_read_text', {
      path: 'README.md',
    });
    const secondTask = await queue.pollNextTask();
    assert.ok(secondTask);
    queue.failTask(secondTask.taskId, 'read failed');
    await assert.rejects(failedResult, /read failed/);

    const recentToolCalls = queue.getRecentToolCalls();
    assert.equal(recentToolCalls.length, 2);
    assert.equal(recentToolCalls[0]?.toolName, 'workspace_read_text');
    assert.equal(recentToolCalls[0]?.status, 'failed');
    assert.equal(recentToolCalls[0]?.errorMessage, 'read failed');
    assert.equal(recentToolCalls[1]?.toolName, 'server_describe');
    assert.equal(recentToolCalls[1]?.status, 'completed');
    assert.equal(typeof recentToolCalls[1]?.finishedAt, 'string');
  } finally {
    await queue.close();
  }
});
