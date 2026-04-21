import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { WorkspaceFileAccess } from '../src/workspaceFileAccess.js';

test('WorkspaceFileAccess writes, reads, and replaces text within root', async () => {
  const temporaryRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), 'full-access-mcp-workspace-'),
  );

  try {
    const workspaceFileAccess = new WorkspaceFileAccess([temporaryRoot]);
    await workspaceFileAccess.makeDirectory('src');
    await workspaceFileAccess.writeText(
      'src/example.txt',
      'hello world\nhello codex\n',
    );

    const readResult = await workspaceFileAccess.readText('src/example.txt');
    assert.match(readResult.content, /hello world/);

    const replaceResult = await workspaceFileAccess.replaceText('src/example.txt', [
      {
        search: 'hello',
        replace: 'goodbye',
        expectedCount: 2,
      },
    ]);

    assert.equal(replaceResult.replacementCount, 2);

    const updatedResult = await workspaceFileAccess.readText('src/example.txt');
    assert.match(updatedResult.content, /goodbye world/);
  } finally {
    await fs.rm(temporaryRoot, { recursive: true, force: true });
  }
});

test('WorkspaceFileAccess blocks paths outside workspace roots', async () => {
  const workspaceFileAccess = new WorkspaceFileAccess([
    path.resolve('C:\\Users\\USER\\Desktop\\GPT server'),
  ]);

  assert.throws(() => {
    workspaceFileAccess.resolveWorkspacePath('..\\..\\Windows\\System32');
  }, /outside configured workspace roots/);
});

test('WorkspaceFileAccess allows absolute paths outside workspace roots in computer-wide mode', async () => {
  const workspaceFileAccess = new WorkspaceFileAccess(
    [path.resolve('C:\\Users\\USER\\Desktop\\GPT server')],
    true,
  );

  const resolvedPath = workspaceFileAccess.resolveWorkspacePath(
    'C:\\Users\\USER\\Desktop',
  );

  assert.equal(resolvedPath, path.resolve('C:\\Users\\USER\\Desktop'));
  assert.equal(workspaceFileAccess.isComputerWideAccessEnabled(), true);
});
