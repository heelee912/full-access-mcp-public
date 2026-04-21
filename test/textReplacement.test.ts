import assert from 'node:assert/strict';
import test from 'node:test';

import { applyTextReplacements } from '../src/textReplacement.js';

test('applyTextReplacements replaces all literal matches', () => {
  const result = applyTextReplacements('alpha beta alpha', [
    {
      search: 'alpha',
      replace: 'omega',
      expectedCount: 2,
    },
  ]);

  assert.equal(result.updatedText, 'omega beta omega');
  assert.equal(result.totalReplacementCount, 2);
});

test('applyTextReplacements rejects missing matches', () => {
  assert.throws(() => {
    applyTextReplacements('alpha beta', [
      {
        search: 'gamma',
        replace: 'delta',
      },
    ]);
  }, /no matches found/);
});
