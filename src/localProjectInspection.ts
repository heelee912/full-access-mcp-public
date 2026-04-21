import path from 'node:path';

export interface LocalProjectListedEntry {
  path: string;
  kind: 'file' | 'directory';
  sizeBytes?: number;
  depth: number;
}

export interface LocalProjectSnippet {
  path: string;
  lineCount: number;
  content: string;
}

export interface LocalProjectSmokeCommandCandidate {
  commandLine: string;
  cwd: string;
  reason: string;
  confidence: 'high' | 'medium' | 'low';
}

const reviewPriorityFileNames = [
  'README.md',
  'README',
  'package.json',
  'pyproject.toml',
  'requirements.txt',
  'go.mod',
  'Cargo.toml',
  'pom.xml',
  'build.gradle',
  'build.gradle.kts',
  'app.py',
  'main.py',
  'server.py',
  'app.ts',
  'main.ts',
  'server.ts',
  'index.ts',
  'app.js',
  'main.js',
  'server.js',
  'index.js',
];

const sourceCodeExtensions = new Set([
  '.py',
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.go',
  '.rs',
  '.java',
  '.kt',
  '.cs',
]);

const sourceDirectoryNames = new Set(['src', 'app', 'server', 'api', 'tests', 'test']);

function normalizePathForSelection(value: string): string {
  return path.normalize(value).toLowerCase();
}

function pushUnique<T>(collection: T[], value: T): void {
  if (!collection.includes(value)) {
    collection.push(value);
  }
}

function parsePackageScripts(
  packageJsonSnippet: LocalProjectSnippet,
  projectRootPath: string,
): LocalProjectSmokeCommandCandidate[] {
  const candidates: LocalProjectSmokeCommandCandidate[] = [];

  try {
    const parsedPackageJson = JSON.parse(packageJsonSnippet.content);
    const scripts = parsedPackageJson?.scripts;

    if (!scripts || typeof scripts !== 'object') {
      return candidates;
    }

    const preferredScriptOrder: Array<{
      scriptName: string;
      confidence: LocalProjectSmokeCommandCandidate['confidence'];
    }> = [
      { scriptName: 'smoke', confidence: 'high' },
      { scriptName: 'test', confidence: 'high' },
      { scriptName: 'check', confidence: 'medium' },
      { scriptName: 'dev', confidence: 'low' },
      { scriptName: 'start', confidence: 'low' },
    ];

    for (const { scriptName, confidence } of preferredScriptOrder) {
      if (typeof scripts[scriptName] !== 'string') {
        continue;
      }

      candidates.push({
        commandLine: `npm run ${scriptName}`,
        cwd: projectRootPath,
        reason: `package.json scripts.${scriptName}`,
        confidence,
      });
    }
  } catch {
    return candidates;
  }

  return candidates;
}

function extractReadmeCommandCandidates(
  readmeSnippet: LocalProjectSnippet,
  projectRootPath: string,
): LocalProjectSmokeCommandCandidate[] {
  const candidates: LocalProjectSmokeCommandCandidate[] = [];
  const lines = readmeSnippet.content.split(/\r?\n/);
  const seenCommandLines = new Set<string>();

  for (const rawLine of lines) {
    const line = rawLine.trim();

    if (line === '' || line.startsWith('#') || line.startsWith('```')) {
      continue;
    }

    if (
      !/^(uvicorn|pytest|python(\s+-m)?|npm|pnpm|yarn|bun|node)\b/i.test(line)
    ) {
      continue;
    }

    const normalizedCommandLine = line.replace(/\s+/g, ' ').trim();

    if (seenCommandLines.has(normalizedCommandLine)) {
      continue;
    }

    seenCommandLines.add(normalizedCommandLine);
    candidates.push({
      commandLine: normalizedCommandLine,
      cwd: projectRootPath,
      reason: `README command: ${normalizedCommandLine}`,
      confidence: /^(uvicorn|pytest|python(\s+-m)?\s+pytest|npm run test|pnpm test|yarn test|bun test)\b/i.test(
        normalizedCommandLine,
      )
        ? 'high'
        : 'medium',
    });

    if (candidates.length >= 8) {
      break;
    }
  }

  return candidates;
}

export function selectLocalProjectReviewCandidatePaths(
  listedEntries: LocalProjectListedEntry[],
  maxCandidateFiles: number,
): string[] {
  const reviewPaths: string[] = [];

  const sortedEntries = [...listedEntries].sort((leftEntry, rightEntry) => {
    if (leftEntry.depth !== rightEntry.depth) {
      return leftEntry.depth - rightEntry.depth;
    }

    return leftEntry.path.localeCompare(rightEntry.path);
  });

  for (const priorityFileName of reviewPriorityFileNames) {
    const matchedEntry = sortedEntries
      .filter(
        (entry) =>
          entry.kind === 'file' &&
          path.basename(entry.path).toLowerCase() === priorityFileName.toLowerCase(),
      )
      .sort((leftEntry, rightEntry) => {
        if (leftEntry.depth !== rightEntry.depth) {
          return leftEntry.depth - rightEntry.depth;
        }

        return leftEntry.path.localeCompare(rightEntry.path);
      })[0];

    if (matchedEntry) {
      pushUnique(reviewPaths, matchedEntry.path);
    }
  }

  for (const entry of sortedEntries) {
    if (reviewPaths.length >= maxCandidateFiles) {
      break;
    }

    if (entry.kind !== 'file') {
      continue;
    }

    const fileName = path.basename(entry.path).toLowerCase();
    if (!/(test|spec)/.test(fileName)) {
      continue;
    }

    pushUnique(reviewPaths, entry.path);
  }

  for (const entry of sortedEntries) {
    if (reviewPaths.length >= maxCandidateFiles) {
      break;
    }

    if (entry.kind !== 'file') {
      continue;
    }

    const fileExtension = path.extname(entry.path).toLowerCase();
    if (!sourceCodeExtensions.has(fileExtension)) {
      continue;
    }

    const parentDirectoryName = path.basename(path.dirname(entry.path)).toLowerCase();
    const fileName = path.basename(entry.path).toLowerCase();
    const looksLikeEntryPoint =
      /^((main|app|server|index)(\.[^.]+)+)$/.test(fileName) ||
      fileName.includes('router') ||
      fileName.includes('api') ||
      fileName.includes('test') ||
      fileName.includes('spec');

    if (!looksLikeEntryPoint && !sourceDirectoryNames.has(parentDirectoryName)) {
      continue;
    }

    pushUnique(reviewPaths, entry.path);
  }

  return reviewPaths.slice(0, maxCandidateFiles);
}

export function inferLocalProjectSmokeCommandCandidates(options: {
  projectRootPath: string;
  snippets: LocalProjectSnippet[];
}): LocalProjectSmokeCommandCandidate[] {
  const candidates: LocalProjectSmokeCommandCandidate[] = [];
  const seenKeys = new Set<string>();

  for (const snippet of options.snippets) {
    const fileName = path.basename(snippet.path).toLowerCase();
    const inferredCandidates =
      fileName === 'package.json'
        ? parsePackageScripts(snippet, options.projectRootPath)
        : fileName.startsWith('readme')
          ? extractReadmeCommandCandidates(snippet, options.projectRootPath)
          : [];

    for (const candidate of inferredCandidates) {
      const candidateKey = normalizePathForSelection(
        `${candidate.cwd}::${candidate.commandLine}`,
      );

      if (seenKeys.has(candidateKey)) {
        continue;
      }

      seenKeys.add(candidateKey);
      candidates.push(candidate);
    }
  }

  return candidates;
}
