import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildPublishedToolDefinitionsForSurface,
  getPublishedToolNameForSurface,
} from '../src/publishedToolSurface.js';

test('maps full-access internal tool names to published aliases', () => {
  assert.equal(
    getPublishedToolNameForSurface('full-access', 'workspace_replace_text'),
    'local_context_content_update',
  );
  assert.equal(
    getPublishedToolNameForSurface('full-access', 'browser_open_session'),
    'browser_open_session',
  );
  assert.equal(
    getPublishedToolNameForSurface('full-access', 'browser_search_google'),
    'local_browser_query',
  );
  assert.equal(
    getPublishedToolNameForSurface('read-only', 'workspace_replace_text'),
    'workspace_replace_text',
  );
});

test('buildPublishedToolDefinitionsForSurface preserves descriptions and aliases', () => {
  const publishedToolDefinitions = buildPublishedToolDefinitionsForSurface(
    'full-access',
    [
      {
        name: 'workspace_replace_text',
        description: 'Replace text in a local file.',
        inputSchema: { type: 'object' },
        annotations: { title: 'Edit Local Text File' },
      },
    ],
  );

  assert.deepEqual(publishedToolDefinitions, [
    {
      publishedName: 'local_context_content_update',
      internalName: 'workspace_replace_text',
      description: 'Replace text in a local file.',
      inputSchema: { type: 'object' },
      annotations: { title: 'Edit Local Text File' },
    },
  ]);
});
