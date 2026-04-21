import assert from 'node:assert/strict';
import test from 'node:test';

import { inferBrowserLaunchIntentFromCommand } from '../src/toolCatalog.js';

test('inferBrowserLaunchIntentFromCommand reroutes quoted Google searches with spaces', () => {
  const intent = inferBrowserLaunchIntentFromCommand({
    command: 'powershell.exe',
    arguments: [
      '-NoProfile',
      '-Command',
      "Start-Process chrome 'https://www.google.com/search?q=떡뽁이 먹고싶다'",
    ],
  });

  assert.deepEqual(intent, {
    kind: 'google-search',
    query: '떡뽁이 먹고싶다',
    url: 'https://www.google.com/search?q=%EB%96%A1%EB%BD%81%EC%9D%B4%20%EB%A8%B9%EA%B3%A0%EC%8B%B6%EB%8B%A4',
  });
});

test('inferBrowserLaunchIntentFromCommand reroutes generic browser URL launches', () => {
  const intent = inferBrowserLaunchIntentFromCommand({
    command: 'powershell.exe',
    arguments: [
      '-NoProfile',
      '-Command',
      "Start-Process chrome 'https://example.com/docs?q=hello world'",
    ],
  });

  assert.deepEqual(intent, {
    kind: 'open-url',
    url: 'https://example.com/docs?q=hello%20world',
  });
});

test('inferBrowserLaunchIntentFromCommand ignores non-browser shell commands', () => {
  const intent = inferBrowserLaunchIntentFromCommand({
    command: 'python',
    arguments: ['script.py', 'https://www.google.com/search?q=떡뽁이+먹고싶다'],
  });

  assert.equal(intent, undefined);
});
