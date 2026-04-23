import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildChatGptMcpApprovalContract,
  matchesChatGptMcpAppName,
  matchesChatGptMcpContext,
  matchesChatGptMcpIgnoredAction,
  matchesChatGptMcpPrimaryAction,
  matchesChatGptMcpRejectAction,
} from '../src/chatGptMcpApproval.js';

test('matches Full Access MCP card labels', () => {
  assert.equal(matchesChatGptMcpAppName('Full Access MCP'), true);
  assert.equal(matchesChatGptMcpPrimaryAction('Write File'), true);
  assert.equal(matchesChatGptMcpPrimaryAction('Search Workspace'), true);
  assert.equal(matchesChatGptMcpPrimaryAction('Run Command'), true);
  assert.equal(matchesChatGptMcpPrimaryAction('List Entries'), true);
  assert.equal(matchesChatGptMcpPrimaryAction('Allow'), true);
  assert.equal(matchesChatGptMcpPrimaryAction('확인'), true);
  assert.equal(matchesChatGptMcpPrimaryAction('Continue'), true);
  assert.equal(matchesChatGptMcpPrimaryAction('Activate Window'), true);
  assert.equal(matchesChatGptMcpPrimaryAction('Open Session'), true);
  assert.equal(matchesChatGptMcpPrimaryAction('Access Files'), true);
  assert.equal(matchesChatGptMcpPrimaryAction('Make Directory'), true);
  assert.equal(matchesChatGptMcpRejectAction('Deny'), true);
  assert.equal(matchesChatGptMcpRejectAction('거절하기'), true);
  assert.equal(matchesChatGptMcpRejectAction('Do not connect'), true);
  assert.equal(matchesChatGptMcpIgnoredAction('Details'), true);
  assert.equal(matchesChatGptMcpPrimaryAction('Edit File'), false);
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
      'This will start a local Playwright browser session with full computer-wide access, including all local Windows files and paths outside workspace roots.',
    ),
    true,
  );
  assert.equal(
    matchesChatGptMcpContext(
      'This will allow the app full access to local files under C:\\Users\\USER\\Desktop\\GPT server\\snapshots, recursively, including paths outside workspace roots.',
    ),
    true,
  );
});

test('tolerates spacing noise in app and action labels', () => {
  assert.equal(matchesChatGptMcpAppName('Full   Access   MCP'), true);
  assert.equal(matchesChatGptMcpPrimaryAction('List    Entries'), true);
  assert.equal(matchesChatGptMcpPrimaryAction('Allow  '), true);
});

test('does not confuse ignored or reject buttons with primary actions', () => {
  assert.equal(matchesChatGptMcpPrimaryAction('Details'), false);
  assert.equal(matchesChatGptMcpPrimaryAction('Deny'), false);
  assert.equal(matchesChatGptMcpPrimaryAction('Click to scroll right'), false);
  assert.equal(matchesChatGptMcpPrimaryAction('Click to scroll left'), false);
  assert.equal(matchesChatGptMcpPrimaryAction('Full Access MCP, click to remove'), false);
  assert.equal(matchesChatGptMcpIgnoredAction('Full Access MCP, click to remove'), true);
  assert.equal(matchesChatGptMcpRejectAction('Write File'), false);
});

test('derives approval matcher patterns from published tool metadata', () => {
  const approvalContract = buildChatGptMcpApprovalContract([
    {
      name: 'local_browser_session',
      description:
        'Use the local Chrome connector on the connected local Windows PC for primary browser work.',
      annotations: {
        title: 'Local Browser',
      },
    },
    {
      name: 'local_playwright_session',
      description:
        'Use the local Playwright connector on the connected local Windows PC for browser automation work.',
      annotations: {
        title: 'Playwright Browser',
      },
    },
    {
      name: 'local_context_prepare',
      description:
        'Use the local context connector on the connected local Windows PC for project-scoped context work.',
      annotations: {
        title: 'Local Context',
      },
    },
    {
      name: 'desktop_capture_screen',
      description:
        'Use the local Windows desktop connector on the connected local Windows PC for UI work.',
      annotations: {
        title: 'Local Desktop',
      },
    },
  ]);

  assert.equal(
    matchesChatGptMcpContext(
      'This will start a local Playwright browser session with full computer-wide access, including all local Windows files and paths outside workspace roots.',
      approvalContract,
    ),
    true,
  );
  assert.equal(
    matchesChatGptMcpPrimaryAction('Local Browser Automation', approvalContract),
    true,
  );
  assert.equal(
    matchesChatGptMcpPrimaryAction('Open Session', approvalContract),
    true,
  );
  assert.equal(
    matchesChatGptMcpPrimaryAction('Open Browser Session', approvalContract),
    true,
  );
  assert.equal(
    matchesChatGptMcpPrimaryAction('Access Files', approvalContract),
    true,
  );
  assert.equal(
    matchesChatGptMcpPrimaryAction('Capture Screen', approvalContract),
    true,
  );
  assert.equal(
    matchesChatGptMcpPrimaryAction('Edit File', approvalContract),
    false,
  );
  assert.equal(
    matchesChatGptMcpPrimaryAction('Click to scroll right', approvalContract),
    false,
  );
});
