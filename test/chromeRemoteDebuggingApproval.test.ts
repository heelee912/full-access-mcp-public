import assert from 'node:assert/strict';
import test from 'node:test';

import {
  matchesChromeRemoteDebuggingAllowButton,
  matchesChromeRemoteDebuggingPrompt,
} from '../src/chromeRemoteDebuggingApproval.js';

test('matches Chrome remote debugging prompt in Korean and English', () => {
  assert.equal(
    matchesChromeRemoteDebuggingPrompt(
      '\uC6D0\uACA9 \uB514\uBC84\uAE45\uC744 \uD5C8\uC6A9\uD558\uC2DC\uACA0\uC2B5\uB2C8\uAE4C?',
    ),
    true,
  );
  assert.equal(
    matchesChromeRemoteDebuggingPrompt(
      'Do you want to allow remote debugging?',
    ),
    true,
  );
  assert.equal(
    matchesChromeRemoteDebuggingPrompt(
      'Allow remote debugging access for this session',
    ),
    true,
  );
  assert.equal(matchesChromeRemoteDebuggingPrompt('Connect developer tools'), false);
});

test('matches only exact allow buttons for Chrome remote debugging approval', () => {
  assert.equal(matchesChromeRemoteDebuggingAllowButton('\uD5C8\uC6A9'), true);
  assert.equal(matchesChromeRemoteDebuggingAllowButton('Allow'), true);
  assert.equal(matchesChromeRemoteDebuggingAllowButton('Cancel'), false);
  assert.equal(matchesChromeRemoteDebuggingAllowButton('Stop using'), false);
});
