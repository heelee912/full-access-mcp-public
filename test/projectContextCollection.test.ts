import assert from 'node:assert/strict';
import test from 'node:test';

import { selectProjectContextCandidateFiles } from '../src/projectContextCollection.js';

test('selectProjectContextCandidateFiles prioritizes key project files and skips generated output', () => {
  const candidates = selectProjectContextCandidateFiles(
    [
      {
        path: 'C:\\workspace\\README.md',
        kind: 'file',
        sizeBytes: 200,
        depth: 1,
      },
      {
        path: 'C:\\workspace\\requirements.txt',
        kind: 'file',
        sizeBytes: 80,
        depth: 1,
      },
      {
        path: 'C:\\workspace\\app\\main.py',
        kind: 'file',
        sizeBytes: 900,
        depth: 2,
      },
      {
        path: 'C:\\workspace\\app\\static\\app.js',
        kind: 'file',
        sizeBytes: 1_200,
        depth: 3,
      },
      {
        path: 'C:\\workspace\\app\\static\\index.html',
        kind: 'file',
        sizeBytes: 1_100,
        depth: 3,
      },
      {
        path: 'C:\\workspace\\tmp_12345.html',
        kind: 'file',
        sizeBytes: 2_000,
        depth: 1,
      },
      {
        path: 'C:\\workspace\\output\\live_page.html',
        kind: 'file',
        sizeBytes: 2_000,
        depth: 2,
      },
    ],
    8,
  );

  const candidatePaths = candidates.map((candidate) => candidate.path);
  assert.deepEqual(candidatePaths, [
    'C:\\workspace\\README.md',
    'C:\\workspace\\requirements.txt',
    'C:\\workspace\\app\\main.py',
    'C:\\workspace\\app\\static\\app.js',
    'C:\\workspace\\app\\static\\index.html',
  ]);
});
