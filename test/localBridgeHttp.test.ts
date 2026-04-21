import assert from 'node:assert/strict';
import test from 'node:test';

import {
  isAllowedBridgeClient,
  isLocalBridgeHostHeader,
  isLoopbackAddress,
  isRejectedWebOrigin,
} from '../src/localBridgeHttp.js';

test('isLoopbackAddress accepts localhost variants', () => {
  assert.equal(isLoopbackAddress('127.0.0.1'), true);
  assert.equal(isLoopbackAddress('::1'), true);
  assert.equal(isLoopbackAddress('::ffff:127.0.0.1'), true);
});

test('isLoopbackAddress rejects non-local addresses', () => {
  assert.equal(isLoopbackAddress('192.168.0.8'), false);
  assert.equal(isLoopbackAddress(undefined), false);
});

test('isRejectedWebOrigin only rejects http and https pages', () => {
  assert.equal(isRejectedWebOrigin('https://chatgpt.com'), true);
  assert.equal(isRejectedWebOrigin('http://localhost:3000'), true);
  assert.equal(isRejectedWebOrigin('chrome-extension://example-id'), false);
  assert.equal(isRejectedWebOrigin(undefined), false);
});

test('isAllowedBridgeClient only accepts configured client ids', () => {
  const allowedClients = ['tampermonkey-userscript', 'codex-shell'];

  assert.equal(
    isAllowedBridgeClient('tampermonkey-userscript', allowedClients),
    true,
  );
  assert.equal(isAllowedBridgeClient('unknown-client', allowedClients), false);
  assert.equal(isAllowedBridgeClient(undefined, allowedClients), false);
});

test('isLocalBridgeHostHeader only accepts localhost host headers', () => {
  assert.equal(isLocalBridgeHostHeader('127.0.0.1:8787'), true);
  assert.equal(isLocalBridgeHostHeader('localhost:8787'), true);
  assert.equal(isLocalBridgeHostHeader('butler-royal-wesley-jackie.trycloudflare.com'), false);
  assert.equal(isLocalBridgeHostHeader(undefined), false);
});
