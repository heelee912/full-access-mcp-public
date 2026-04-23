import assert from 'node:assert/strict';
import test from 'node:test';

import { ChatGptMcpApprovalWatcher } from '../src/chatGptMcpApprovalWatcher.js';

function sleep(delayMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });
}

test('ChatGptMcpApprovalWatcher uses desktop approval even without an attached browser client', async () => {
  let desktopCalls = 0;
  let browserCalls = 0;

  const watcher = new ChatGptMcpApprovalWatcher(
    {
      hasAttachedBrowserClient: () => false,
      approveChatGptMcpPrompt: async () => {
        browserCalls += 1;
        return { foundPrompt: false, approved: false };
      },
    } as never,
    {
      approveChatGptMcpPrompt: async () => {
        desktopCalls += 1;
        return { foundPrompt: true, approved: true, buttonName: 'Run Command' };
      },
    } as never,
    true,
    10,
  );

  watcher.triggerFromRemoteDebuggingApproval();
  await sleep(40);
  await watcher.stop();

  assert.equal(desktopCalls, 1);
  assert.equal(browserCalls, 0);
});

test('ChatGptMcpApprovalWatcher falls back to browser approval after desktop miss', async () => {
  let desktopCalls = 0;
  let browserCalls = 0;

  const watcher = new ChatGptMcpApprovalWatcher(
    {
      hasAttachedBrowserClient: () => true,
      approveChatGptMcpPrompt: async () => {
        browserCalls += 1;
        return { foundPrompt: true, approved: true, buttonName: 'Run Command' };
      },
    } as never,
    {
      approveChatGptMcpPrompt: async () => {
        desktopCalls += 1;
        return { foundPrompt: false, approved: false };
      },
    } as never,
    true,
    10,
  );

  watcher.triggerFromRemoteDebuggingApproval();
  await sleep(40);
  await watcher.stop();

  assert.equal(desktopCalls, 1);
  assert.equal(browserCalls, 1);
});

test('ChatGptMcpApprovalWatcher falls back to browser approval after desktop false negative', async () => {
  let desktopCalls = 0;
  let browserCalls = 0;

  const watcher = new ChatGptMcpApprovalWatcher(
    {
      hasAttachedBrowserClient: () => true,
      approveChatGptMcpPrompt: async () => {
        browserCalls += 1;
        return { foundPrompt: true, approved: true, buttonName: 'Open Browser Session' };
      },
    } as never,
    {
      approveChatGptMcpPrompt: async () => {
        desktopCalls += 1;
        return { foundPrompt: true, approved: false };
      },
    } as never,
    true,
    10,
  );

  watcher.triggerFromRemoteDebuggingApproval();
  await sleep(40);
  await watcher.stop();

  assert.equal(desktopCalls, 1);
  assert.equal(browserCalls, 1);
});
