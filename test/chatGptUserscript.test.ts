import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createChatGptBootstrapPrompt,
  createChatGptInlineToolPrompt,
  createChatGptRecoveryPrompt,
  createChatGptUserscript,
} from '../src/chatGptUserscript.js';

test('createChatGptBootstrapPrompt uses the requested tool language', () => {
  const prompt = createChatGptBootstrapPrompt('full-access-tools');

  assert.match(prompt, /```full-access-tools/);
  assert.match(prompt, /server_describe/);
});

test('createChatGptUserscript embeds the localhost bridge config', () => {
  const userscript = createChatGptUserscript({
    bridgeBaseUrl: 'http://127.0.0.1:8787',
    bridgeConfigUrl: 'http://127.0.0.1:8787/bridge/client-config',
    toolLanguage: 'full-access-tools',
    toolPrompt: 'bootstrap',
    inlineToolPrompt: 'inline bootstrap',
    recoveryPrompt: 'recover',
    autoRun: true,
    autoSubmitResults: true,
    autoBootstrapConversation: false,
    autoRecoverRefusals: true,
  });

  assert.match(userscript, /@match\s+https:\/\/chatgpt\.com\/\*/);
  assert.match(userscript, /bridge\/client-config/);
  assert.match(userscript, /Run latest plan/);
  assert.match(userscript, /Insert bootstrap/);
  assert.match(userscript, /Recover access/);
  assert.match(userscript, /Lock bridge/);
});

test('createChatGptInlineToolPrompt marks the local bridge context', () => {
  const prompt = createChatGptInlineToolPrompt('full-access-tools');

  assert.match(prompt, /\[Local bridge context\]/);
  assert.match(prompt, /```full-access-tools/);
  assert.match(prompt, /server_describe/);
});

test('createChatGptRecoveryPrompt tells ChatGPT to stop generic refusal replies', () => {
  const prompt = createChatGptRecoveryPrompt('full-access-tools');

  assert.match(prompt, /Do not reply with generic statements/);
  assert.match(prompt, /Do not describe a plan/);
  assert.match(prompt, /server_describe/);
});
