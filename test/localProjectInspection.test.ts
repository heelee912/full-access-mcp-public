import assert from 'node:assert/strict';
import test from 'node:test';

import {
  inferLocalProjectSmokeCommandCandidates,
  selectLocalProjectReviewCandidatePaths,
} from '../src/localProjectInspection.js';

test('selectLocalProjectReviewCandidatePaths prioritizes project documents and entry points', () => {
  const candidatePaths = selectLocalProjectReviewCandidatePaths(
    [
      {
        path: 'C:\\project\\README.md',
        kind: 'file',
        depth: 1,
      },
      {
        path: 'C:\\project\\package.json',
        kind: 'file',
        depth: 1,
      },
      {
        path: 'C:\\project\\src\\main.py',
        kind: 'file',
        depth: 2,
      },
      {
        path: 'C:\\project\\src\\feature.py',
        kind: 'file',
        depth: 2,
      },
      {
        path: 'C:\\project\\tests\\test_app.py',
        kind: 'file',
        depth: 2,
      },
    ],
    4,
  );

  assert.deepEqual(candidatePaths, [
    'C:\\project\\README.md',
    'C:\\project\\package.json',
    'C:\\project\\src\\main.py',
    'C:\\project\\tests\\test_app.py',
  ]);
});

test('inferLocalProjectSmokeCommandCandidates extracts package and README commands', () => {
  const smokeCandidates = inferLocalProjectSmokeCommandCandidates({
    projectRootPath: 'C:\\project',
    snippets: [
      {
        path: 'C:\\project\\package.json',
        lineCount: 8,
        content: JSON.stringify(
          {
            scripts: {
              test: 'vitest',
              smoke: 'node smoke.js',
            },
          },
          null,
          2,
        ),
      },
      {
        path: 'C:\\project\\README.md',
        lineCount: 6,
        content: [
          '# Demo',
          '',
          'uvicorn app.main:app --host 127.0.0.1 --port 8017',
          'pytest -q',
        ].join('\n'),
      },
    ],
  });

  assert.deepEqual(
    smokeCandidates.map((candidate) => candidate.commandLine),
    [
      'npm run smoke',
      'npm run test',
      'uvicorn app.main:app --host 127.0.0.1 --port 8017',
      'pytest -q',
    ],
  );
});
