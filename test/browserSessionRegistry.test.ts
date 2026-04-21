import assert from 'node:assert/strict';
import test from 'node:test';

import { buildGoogleSearchUrl } from '../src/browserSessionRegistry.js';

test('buildGoogleSearchUrl encodes the query into a Google search URL', () => {
  assert.equal(
    buildGoogleSearchUrl('안녕 MCP'),
    'https://www.google.com/search?q=%EC%95%88%EB%85%95+MCP',
  );
});
