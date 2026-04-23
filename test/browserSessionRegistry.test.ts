import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildGoogleSearchUrl,
  extractGoogleSearchQuery,
  findReusableBrowserPage,
  isMissingChromePageError,
  shouldRetryChromeToolCallOnRecoverableConnectionError,
} from '../src/browserSessionRegistry.js';

test('buildGoogleSearchUrl encodes the query into a Google search URL', () => {
  assert.equal(
    buildGoogleSearchUrl('안녕 MCP'),
    'https://www.google.com/search?q=%EC%95%88%EB%85%95+MCP',
  );
});

test('findReusableBrowserPage prefers the selected page with the same normalized URL', () => {
  const reusablePage = findReusableBrowserPage(
    [
      {
        pageId: 1,
        url: 'https://www.google.com/search?q=%EA%B3%B0%EB%8F%8C%EC%9D%B4',
        selected: false,
      },
      {
        pageId: 2,
        url: 'https://www.google.com/search?q=%EA%B3%B0%EB%8F%8C%EC%9D%B4#fragment',
        selected: true,
      },
    ],
    'https://www.google.com/search?q=%EA%B3%B0%EB%8F%8C%EC%9D%B4',
  );

  assert.equal(reusablePage?.pageId, 2);
});

test('extractGoogleSearchQuery reads q from Google search and sorry URLs', () => {
  assert.equal(
    extractGoogleSearchQuery('https://www.google.com/search?q=%EA%B3%B0%EB%8F%8C%EC%9D%B4'),
    '곰돌이',
  );
  assert.equal(
    extractGoogleSearchQuery(
      'https://www.google.com/sorry/index?continue=https://www.google.com/search%3Fq%3D%25EA%25B3%25B0%25EB%258F%258C%25EC%259D%25B4',
    ),
    '곰돌이',
  );
});

test('findReusableBrowserPage reuses a Google sorry page for the same query', () => {
  const reusablePage = findReusableBrowserPage(
    [
      {
        pageId: 1,
        url: 'about:blank',
        selected: false,
      },
      {
        pageId: 2,
        url: 'https://www.google.com/sorry/index?continue=https://www.google.com/search%3Fq%3D%25EA%25B3%25B0%25EB%258F%258C%25EC%259D%25B4',
        selected: true,
      },
    ],
    'https://www.google.com/search?q=%EA%B3%B0%EB%8F%8C%EC%9D%B4',
  );

  assert.equal(reusablePage?.pageId, 2);
});

test('isMissingChromePageError matches stale page errors from Chrome DevTools MCP', () => {
  assert.equal(isMissingChromePageError(new Error('No page found')), true);
  assert.equal(isMissingChromePageError(new Error('unknown page 7')), true);
  assert.equal(
    isMissingChromePageError(new Error('unknown browser session: abc')),
    false,
  );
});

test('recoverable Chrome retry is opt-in for idempotent calls only', () => {
  assert.equal(
    shouldRetryChromeToolCallOnRecoverableConnectionError({}),
    false,
  );
  assert.equal(
    shouldRetryChromeToolCallOnRecoverableConnectionError({
      retryOnRecoverableConnectionError: false,
    }),
    false,
  );
  assert.equal(
    shouldRetryChromeToolCallOnRecoverableConnectionError({
      retryOnRecoverableConnectionError: true,
    }),
    true,
  );
});
