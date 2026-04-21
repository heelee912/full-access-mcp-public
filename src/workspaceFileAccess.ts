import fs from 'node:fs/promises';
import path from 'node:path';

import {
  applyTextReplacements,
  type TextReplacement,
} from './textReplacement.js';

interface TextSearchMatch {
  path: string;
  line: number;
  column: number;
  preview: string;
}

interface ListedWorkspaceEntry {
  path: string;
  kind: 'file' | 'directory';
  sizeBytes?: number;
  depth: number;
}

function normalizeForComparison(value: string): string {
  const resolved = path.resolve(value);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function isPathWithinRoot(candidate: string, root: string): boolean {
  const normalizedCandidate = normalizeForComparison(candidate);
  const normalizedRoot = normalizeForComparison(root);

  if (normalizedCandidate === normalizedRoot) {
    return true;
  }

  const relativePath = path.relative(normalizedRoot, normalizedCandidate);
  return relativePath !== '' && !relativePath.startsWith('..') && !path.isAbsolute(relativePath);
}

function isProbablyBinary(content: Buffer): boolean {
  return content.includes(0);
}

export class WorkspaceFileAccess {
  constructor(
    private readonly workspaceRoots: string[],
    private readonly allowComputerWideAccess = false,
  ) {}

  listWorkspaceRoots(): string[] {
    return [...this.workspaceRoots];
  }

  isComputerWideAccessEnabled(): boolean {
    return this.allowComputerWideAccess;
  }

  resolveWorkspacePath(requestedPath: string, allowMissing = false): string {
    if (!requestedPath.trim()) {
      throw new Error('path is required');
    }

    const resolvedPath = path.isAbsolute(requestedPath)
      ? path.resolve(requestedPath)
      : path.resolve(this.workspaceRoots[0]!, requestedPath);

    if (
      !this.allowComputerWideAccess &&
      !this.workspaceRoots.some((root) => isPathWithinRoot(resolvedPath, root))
    ) {
      throw new Error(`path is outside configured workspace roots: ${requestedPath}`);
    }

    return resolvedPath;
  }

  private async assertExistingPath(requestedPath: string): Promise<string> {
    const resolvedPath = this.resolveWorkspacePath(requestedPath, false);
    await fs.access(resolvedPath);
    return resolvedPath;
  }

  async statPath(requestedPath: string): Promise<{
    path: string;
    kind: 'file' | 'directory';
    sizeBytes: number;
    modifiedAt: string;
  }> {
    const resolvedPath = await this.assertExistingPath(requestedPath);
    const stats = await fs.stat(resolvedPath);

    return {
      path: resolvedPath,
      kind: stats.isDirectory() ? 'directory' : 'file',
      sizeBytes: stats.size,
      modifiedAt: stats.mtime.toISOString(),
    };
  }

  async listEntries(
    requestedPath: string,
    maxDepth = 1,
    includeHidden = false,
  ): Promise<ListedWorkspaceEntry[]> {
    const resolvedPath = await this.assertExistingPath(requestedPath);
    const results: ListedWorkspaceEntry[] = [];

    const visit = async (currentPath: string, depth: number): Promise<void> => {
      const stats = await fs.stat(currentPath);
      const entryKind = stats.isDirectory() ? 'directory' : 'file';

      results.push({
        path: currentPath,
        kind: entryKind,
        sizeBytes: stats.isFile() ? stats.size : undefined,
        depth,
      });

      if (!stats.isDirectory() || depth >= maxDepth) {
        return;
      }

      const children = await fs.readdir(currentPath, { withFileTypes: true });

      for (const child of children.sort((left, right) =>
        left.name.localeCompare(right.name),
      )) {
        if (!includeHidden && child.name.startsWith('.')) {
          continue;
        }

        await visit(path.join(currentPath, child.name), depth + 1);
      }
    };

    await visit(resolvedPath, 0);
    return results;
  }

  async readText(
    requestedPath: string,
    startLine?: number,
    endLine?: number,
  ): Promise<{
    path: string;
    content: string;
    lineCount: number;
    returnedRange?: { startLine: number; endLine: number };
  }> {
    const resolvedPath = await this.assertExistingPath(requestedPath);
    const buffer = await fs.readFile(resolvedPath);

    if (isProbablyBinary(buffer)) {
      throw new Error(`binary file is not supported for text reading: ${resolvedPath}`);
    }

    const fullContent = buffer.toString('utf8');
    const lines = fullContent.split(/\r?\n/);

    if (startLine === undefined && endLine === undefined) {
      return {
        path: resolvedPath,
        content: fullContent,
        lineCount: lines.length,
      };
    }

    const normalizedStartLine = Math.max(1, startLine ?? 1);
    const normalizedEndLine = Math.max(
      normalizedStartLine,
      endLine ?? lines.length,
    );
    const slicedContent = lines
      .slice(normalizedStartLine - 1, normalizedEndLine)
      .join('\n');

    return {
      path: resolvedPath,
      content: slicedContent,
      lineCount: lines.length,
      returnedRange: {
        startLine: normalizedStartLine,
        endLine: Math.min(normalizedEndLine, lines.length),
      },
    };
  }

  async writeText(
    requestedPath: string,
    content: string,
    mode: 'overwrite' | 'append' = 'overwrite',
  ): Promise<{ path: string; bytesWritten: number; mode: 'overwrite' | 'append' }> {
    const resolvedPath = this.resolveWorkspacePath(requestedPath, true);
    await fs.mkdir(path.dirname(resolvedPath), { recursive: true });

    if (mode === 'append') {
      await fs.appendFile(resolvedPath, content, 'utf8');
    } else {
      await fs.writeFile(resolvedPath, content, 'utf8');
    }

    return {
      path: resolvedPath,
      bytesWritten: Buffer.byteLength(content),
      mode,
    };
  }

  async replaceText(
    requestedPath: string,
    replacements: TextReplacement[],
  ): Promise<{
    path: string;
    replacementCount: number;
    appliedReplacements: Array<{
      search: string;
      replace: string;
      replacementCount: number;
    }>;
  }> {
    const resolvedPath = await this.assertExistingPath(requestedPath);
    const originalContent = await fs.readFile(resolvedPath, 'utf8');
    const replacementResult = applyTextReplacements(originalContent, replacements);

    await fs.writeFile(resolvedPath, replacementResult.updatedText, 'utf8');

    return {
      path: resolvedPath,
      replacementCount: replacementResult.totalReplacementCount,
      appliedReplacements: replacementResult.appliedReplacements,
    };
  }

  async makeDirectory(
    requestedPath: string,
    recursive = true,
  ): Promise<{ path: string; recursive: boolean }> {
    const resolvedPath = this.resolveWorkspacePath(requestedPath, true);
    await fs.mkdir(resolvedPath, { recursive });

    return {
      path: resolvedPath,
      recursive,
    };
  }

  async copyPath(
    sourcePath: string,
    destinationPath: string,
    overwrite = false,
  ): Promise<{
    sourcePath: string;
    destinationPath: string;
    kind: 'file' | 'directory';
    overwritten: boolean;
  }> {
    const resolvedSourcePath = await this.assertExistingPath(sourcePath);
    const resolvedDestinationPath = this.resolveWorkspacePath(destinationPath, true);
    const sourceStats = await fs.stat(resolvedSourcePath);

    try {
      await fs.access(resolvedDestinationPath);
      if (!overwrite) {
        throw new Error(`destination path already exists: ${destinationPath}`);
      }
      await fs.rm(resolvedDestinationPath, { recursive: true, force: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    }

    await fs.mkdir(path.dirname(resolvedDestinationPath), { recursive: true });
    await fs.cp(resolvedSourcePath, resolvedDestinationPath, {
      recursive: sourceStats.isDirectory(),
      force: overwrite,
      errorOnExist: !overwrite,
    });

    return {
      sourcePath: resolvedSourcePath,
      destinationPath: resolvedDestinationPath,
      kind: sourceStats.isDirectory() ? 'directory' : 'file',
      overwritten: overwrite,
    };
  }

  async movePath(
    sourcePath: string,
    destinationPath: string,
    overwrite = false,
  ): Promise<{
    sourcePath: string;
    destinationPath: string;
    kind: 'file' | 'directory';
    overwritten: boolean;
  }> {
    const resolvedSourcePath = await this.assertExistingPath(sourcePath);
    const resolvedDestinationPath = this.resolveWorkspacePath(destinationPath, true);
    const sourceStats = await fs.stat(resolvedSourcePath);

    try {
      await fs.access(resolvedDestinationPath);
      if (!overwrite) {
        throw new Error(`destination path already exists: ${destinationPath}`);
      }
      await fs.rm(resolvedDestinationPath, { recursive: true, force: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    }

    await fs.mkdir(path.dirname(resolvedDestinationPath), { recursive: true });

    try {
      await fs.rename(resolvedSourcePath, resolvedDestinationPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EXDEV') {
        throw error;
      }

      await fs.cp(resolvedSourcePath, resolvedDestinationPath, {
        recursive: sourceStats.isDirectory(),
        force: overwrite,
        errorOnExist: !overwrite,
      });
      await fs.rm(resolvedSourcePath, { recursive: true, force: true });
    }

    return {
      sourcePath: resolvedSourcePath,
      destinationPath: resolvedDestinationPath,
      kind: sourceStats.isDirectory() ? 'directory' : 'file',
      overwritten: overwrite,
    };
  }

  async deletePath(
    requestedPath: string,
    recursive = true,
    force = false,
  ): Promise<{
    path: string;
    recursive: boolean;
    force: boolean;
  }> {
    const resolvedPath = await this.assertExistingPath(requestedPath);
    await fs.rm(resolvedPath, { recursive, force });

    return {
      path: resolvedPath,
      recursive,
      force,
    };
  }

  async searchText(options: {
    query: string;
    rootPath?: string;
    caseSensitive?: boolean;
    maxResults?: number;
    fileExtensions?: string[];
  }): Promise<TextSearchMatch[]> {
    const rootPath = await this.assertExistingPath(options.rootPath || '.');
    const caseSensitive = options.caseSensitive ?? false;
    const maxResults = options.maxResults ?? 50;
    const fileExtensions = new Set(
      (options.fileExtensions ?? []).map((entry) => entry.toLowerCase()),
    );
    const matches: TextSearchMatch[] = [];
    const skippedDirectories = new Set(['.git', 'node_modules', 'dist', '.full-access-mcp']);
    const normalizedQuery = caseSensitive
      ? options.query
      : options.query.toLowerCase();

    const visit = async (currentPath: string): Promise<void> => {
      if (matches.length >= maxResults) {
        return;
      }

      const stats = await fs.stat(currentPath);

      if (stats.isDirectory()) {
        const directoryName = path.basename(currentPath);
        if (skippedDirectories.has(directoryName)) {
          return;
        }

        const children = await fs.readdir(currentPath, { withFileTypes: true });
        for (const child of children) {
          await visit(path.join(currentPath, child.name));
          if (matches.length >= maxResults) {
            return;
          }
        }

        return;
      }

      if (stats.size > 1_000_000) {
        return;
      }

      if (fileExtensions.size > 0) {
        const extension = path.extname(currentPath).toLowerCase();
        if (!fileExtensions.has(extension)) {
          return;
        }
      }

      const buffer = await fs.readFile(currentPath);
      if (isProbablyBinary(buffer)) {
        return;
      }

      const content = buffer.toString('utf8');
      const lines = content.split(/\r?\n/);

      for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
        const haystack = caseSensitive ? lines[lineIndex]! : lines[lineIndex]!.toLowerCase();
        const columnIndex = haystack.indexOf(normalizedQuery);

        if (columnIndex === -1) {
          continue;
        }

        matches.push({
          path: currentPath,
          line: lineIndex + 1,
          column: columnIndex + 1,
          preview: lines[lineIndex]!.trim(),
        });

        if (matches.length >= maxResults) {
          return;
        }
      }
    };

    await visit(rootPath);
    return matches;
  }
}
