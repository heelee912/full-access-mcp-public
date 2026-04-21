import assert from 'node:assert/strict';
import test from 'node:test';

import { escapeSendKeysText } from '../src/windowsDesktopAutomation.js';

test('escapeSendKeysText escapes SendKeys control characters', () => {
  assert.equal(
    escapeSendKeysText('a+b^(c){d}[e]~%'),
    'a{+}b{^}{(}c{)}{{}d{}}{[}e{]}{~}{%}',
  );
});
