import assert from 'node:assert/strict';
import test from 'node:test';

import {
  matchesChatGptMcpContext,
  matchesChatGptMcpAppName,
  matchesChatGptMcpIgnoredAction,
  matchesChatGptMcpPrimaryAction,
  matchesChatGptMcpRejectAction,
  matchesChatGptMcpWindowTitleHint,
} from '../src/chatGptMcpApproval.js';

test('matches Full Access MCP card labels', () => {
  assert.equal(matchesChatGptMcpAppName('Full Access MCP'), true);
  assert.equal(matchesChatGptMcpPrimaryAction('Write File'), true);
  assert.equal(matchesChatGptMcpPrimaryAction('Search Workspace'), true);
  assert.equal(matchesChatGptMcpPrimaryAction('Run Command'), true);
  assert.equal(matchesChatGptMcpPrimaryAction('List Entries'), true);
  assert.equal(matchesChatGptMcpPrimaryAction('Open Browser Session'), true);
  assert.equal(matchesChatGptMcpPrimaryAction('Take Screenshot'), true);
  assert.equal(matchesChatGptMcpPrimaryAction('Capture Screen'), true);
  assert.equal(matchesChatGptMcpPrimaryAction('Allow'), true);
  assert.equal(matchesChatGptMcpRejectAction('Deny'), true);
  assert.equal(matchesChatGptMcpIgnoredAction('Details'), true);
});

test('matches current approval card context strings', () => {
  assert.equal(
    matchesChatGptMcpContext(
      'This will list files and directories on your local Windows PC. Sharing data includes: LocalAccess',
    ),
    true,
  );
  assert.equal(
    matchesChatGptMcpContext('This will overwrite C:\\Users\\USER\\Desktop\\foo.txt'),
    true,
  );
  assert.equal(
    matchesChatGptMcpContext(
      'This will execute a PowerShell command on your local Windows PC to open Chrome or a browser to search Google.',
    ),
    true,
  );
  assert.equal(
    matchesChatGptMcpContext(
      'This will open a persistent Chromium browser on your local Windows PC with full computer-wide access.',
    ),
    true,
  );
  assert.equal(
    matchesChatGptMcpContext(
      'This will save a screenshot of your entire Windows desktop, including all open windows.',
    ),
    true,
  );
});

test('tolerates spacing noise in app and action labels', () => {
  assert.equal(matchesChatGptMcpAppName('Full   Access   MCP'), true);
  assert.equal(matchesChatGptMcpWindowTitleHint('ChatGPT - Chrome'), true);
  assert.equal(matchesChatGptMcpWindowTitleHint('MCP 권한 요청 - Chrome'), true);
  assert.equal(matchesChatGptMcpPrimaryAction('List    Entries'), true);
  assert.equal(matchesChatGptMcpPrimaryAction('Allow  '), true);
});

test('does not confuse ignored or reject buttons with primary actions', () => {
  assert.equal(matchesChatGptMcpPrimaryAction('Details'), false);
  assert.equal(matchesChatGptMcpPrimaryAction('Deny'), false);
  assert.equal(matchesChatGptMcpRejectAction('Write File'), false);
});
