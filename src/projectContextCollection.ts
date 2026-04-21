import path from 'node:path';

import { type LocalProjectListedEntry } from './localProjectInspection.js';

export interface ProjectContextCandidateFile {
  path: string;
  reason: string;
}

const priorityFileNames = [
  'README.md',
  'README',
  'requirements.txt',
  'pyproject.toml',
  'package.json',
  'tsconfig.json',
  'go.mod',
  'Cargo.toml',
  'pom.xml',
  'build.gradle',
  'build.gradle.kts',
  'main.py',
  'app.py',
  'server.py',
  'settings.py',
  'schema.py',
  'storage.py',
  'pipeline.py',
  'evaluator.py',
  'main.ts',
  'app.ts',
  'index.ts',
  'settings.ts',
  'schema.ts',
  'storage.ts',
  'pipeline.ts',
  'evaluator.ts',
  'main.js',
  'app.js',
  'index.js',
  'index.html',
  'app.css',
  'main.css',
];

const preferredDirectoryNames = new Set([
  'src',
  'app',
  'server',
  'api',
  'static',
  'public',
  'web',
  'client',
  'ui',
  'frontend',
  'tests',
  'test',
  'docs',
  'scripts',
  'config',
  'configs',
  'deploy',
]);

const ignoredDirectoryNames = new Set([
  '.git',
  '.idea',
  '.next',
  '.nuxt',
  '.venv',
  '.yarn',
  '__pycache__',
  'build',
  'coverage',
  'dist',
  'logs',
  'node_modules',
  'output',
  'tmp',
  'temp',
  'var',
  'venv',
]);

const preferredTextExtensions = new Set([
  '.bat',
  '.cjs',
  '.cmd',
  '.conf',
  '.css',
  '.csv',
  '.env',
  '.go',
  '.graphql',
  '.htm',
  '.html',
  '.ini',
  '.java',
  '.js',
  '.json',
  '.jsx',
  '.kt',
  '.less',
  '.md',
  '.mjs',
  '.properties',
  '.ps1',
  '.py',
  '.rb',
  '.rs',
  '.sass',
  '.scss',
  '.service',
  '.sh',
  '.sql',
  '.svg',
  '.toml',
  '.ts',
  '.tsx',
  '.txt',
  '.xml',
  '.yaml',
  '.yml',
]);

function normalizePath(value: string): string {
  return path.normalize(value).toLowerCase();
}

function includesIgnoredDirectorySegment(filePath: string): boolean {
  const segments = normalizePath(filePath).split(path.sep).filter(Boolean);
  return segments.some((segment) => ignoredDirectoryNames.has(segment));
}

function hasAllowedExtension(filePath: string): boolean {
  const extension = path.extname(filePath).toLowerCase();

  if (extension === '') {
    return ['dockerfile', 'makefile', 'readme'].includes(
      path.basename(filePath).toLowerCase(),
    );
  }

  return preferredTextExtensions.has(extension);
}

function looksGenerated(filePath: string): boolean {
  const lowerCaseFileName = path.basename(filePath).toLowerCase();

  return (
    lowerCaseFileName.startsWith('tmp_') ||
    lowerCaseFileName.startsWith('temp_') ||
    lowerCaseFileName.endsWith('.min.js') ||
    lowerCaseFileName.endsWith('.min.css')
  );
}

function pathDepth(filePath: string): number {
  return path.normalize(filePath).split(path.sep).filter(Boolean).length;
}

function buildReason(filePath: string): string {
  const baseName = path.basename(filePath).toLowerCase();
  const parentName = path.basename(path.dirname(filePath)).toLowerCase();

  if (priorityFileNames.some((candidate) => candidate.toLowerCase() === baseName)) {
    return `priority file: ${path.basename(filePath)}`;
  }

  if (preferredDirectoryNames.has(parentName)) {
    return `preferred directory: ${parentName}`;
  }

  if (/(test|spec)/.test(baseName)) {
    return `test file: ${path.basename(filePath)}`;
  }

  return `text file: ${path.basename(filePath)}`;
}

function pushUniqueCandidate(
  collection: ProjectContextCandidateFile[],
  seenPaths: Set<string>,
  value: ProjectContextCandidateFile,
): void {
  const normalizedPath = normalizePath(value.path);

  if (seenPaths.has(normalizedPath)) {
    return;
  }

  seenPaths.add(normalizedPath);
  collection.push(value);
}

function listFilesByPriority(listedEntries: LocalProjectListedEntry[]): LocalProjectListedEntry[] {
  return [...listedEntries]
    .filter((entry) => entry.kind === 'file')
    .sort((leftEntry, rightEntry) => {
      if (leftEntry.depth !== rightEntry.depth) {
        return leftEntry.depth - rightEntry.depth;
      }

      return leftEntry.path.localeCompare(rightEntry.path);
    });
}

function isCandidateFile(entry: LocalProjectListedEntry): boolean {
  if (includesIgnoredDirectorySegment(entry.path) || looksGenerated(entry.path)) {
    return false;
  }

  if (entry.sizeBytes !== undefined && entry.sizeBytes > 512_000) {
    return false;
  }

  return hasAllowedExtension(entry.path);
}

export function selectProjectContextCandidateFiles(
  listedEntries: LocalProjectListedEntry[],
  maxCandidateFiles: number,
): ProjectContextCandidateFile[] {
  const selectedCandidates: ProjectContextCandidateFile[] = [];
  const seenPaths = new Set<string>();
  const filesByPriority = listFilesByPriority(listedEntries).filter(isCandidateFile);

  for (const priorityFileName of priorityFileNames) {
    const matchedEntry = filesByPriority.find(
      (entry) => path.basename(entry.path).toLowerCase() === priorityFileName.toLowerCase(),
    );

    if (!matchedEntry) {
      continue;
    }

    pushUniqueCandidate(selectedCandidates, seenPaths, {
      path: matchedEntry.path,
      reason: `priority file: ${priorityFileName}`,
    });

    if (selectedCandidates.length >= maxCandidateFiles) {
      return selectedCandidates;
    }
  }

  for (const entry of filesByPriority) {
    const parentName = path.basename(path.dirname(entry.path)).toLowerCase();
    if (!preferredDirectoryNames.has(parentName)) {
      continue;
    }

    pushUniqueCandidate(selectedCandidates, seenPaths, {
      path: entry.path,
      reason: buildReason(entry.path),
    });

    if (selectedCandidates.length >= maxCandidateFiles) {
      return selectedCandidates;
    }
  }

  for (const entry of filesByPriority) {
    pushUniqueCandidate(selectedCandidates, seenPaths, {
      path: entry.path,
      reason: buildReason(entry.path),
    });

    if (selectedCandidates.length >= maxCandidateFiles) {
      return selectedCandidates;
    }
  }

  return selectedCandidates;
}

export function sortProjectContextPaths(paths: string[]): string[] {
  return [...paths].sort((leftPath, rightPath) => {
    const leftDepth = pathDepth(leftPath);
    const rightDepth = pathDepth(rightPath);

    if (leftDepth !== rightDepth) {
      return leftDepth - rightDepth;
    }

    return leftPath.localeCompare(rightPath);
  });
}
