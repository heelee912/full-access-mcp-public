import assert from 'node:assert/strict';
import test from 'node:test';

import {
  matchesChatGptMcpAppName,
  matchesChatGptMcpIgnoredAction,
  matchesChatGptMcpPrimaryAction,
  matchesChatGptMcpRejectAction,
} from '../src/chatGptMcpApproval.js';

test('matches Full Access MCP card labels', () => {
  assert.equal(matchesChatGptMcpAppName('Full Access MCP'), true);
  assert.equal(matchesChatGptMcpPrimaryAction('Write File'), true);
  assert.equal(matchesChatGptMcpPrimaryAction('Search Workspace'), true);
  assert.equal(matchesChatGptMcpPrimaryAction('Run Command'), true);
  assert.equal(matchesChatGptMcpRejectAction('Deny'), true);
  assert.equal(matchesChatGptMcpIgnoredAction('Details'), true);
});

test('does not confuse ignored or reject buttons with primary actions', () => {
  assert.equal(matchesChatGptMcpPrimaryAction('Details'), false);
  assert.equal(matchesChatGptMcpPrimaryAction('Deny'), false);
  assert.equal(matchesChatGptMcpRejectAction('Write File'), false);
});
