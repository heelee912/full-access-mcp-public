import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createFullAccessProjectReviewPrompt,
  createFullAccessTaskPrompt,
} from '../src/remoteGatewayMcpServer.js';

test('createFullAccessTaskPrompt uses published full-access tool aliases', () => {
  const prompt = createFullAccessTaskPrompt('Inspect browser results');

  assert.match(prompt, /\blocal_terminal_session\b/);
  assert.match(prompt, /\blocal_system_session\b/);
  assert.doesNotMatch(prompt, /\bcommand_run\b/);
  assert.doesNotMatch(prompt, /\bsystem_launch_application\b/);
});

test('createFullAccessProjectReviewPrompt uses published write and terminal aliases', () => {
  const prompt = createFullAccessProjectReviewPrompt(
    'C:\\workspace',
    'Review and patch the project',
  );

  assert.match(prompt, /\blocal_context_content_apply\b/);
  assert.match(prompt, /\blocal_context_content_update\b/);
  assert.match(prompt, /\blocal_terminal_session\b/);
  assert.match(prompt, /\blocal_terminal_channel\b/);
  assert.doesNotMatch(prompt, /\bworkspace_write_text\b/);
  assert.doesNotMatch(prompt, /\bworkspace_replace_text\b/);
  assert.doesNotMatch(prompt, /\bcommand_run\b/);
  assert.doesNotMatch(prompt, /\bcommand_start_session\b/);
});
