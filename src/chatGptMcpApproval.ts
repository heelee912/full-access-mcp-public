const chatGptMcpAppNamePatterns = ['full access mcp'] as const;

const chatGptMcpContextPatterns = [
  'sharing data includes',
  'using tools comes with risks',
  'local workspace files will be modified',
  'this will execute',
  'this will open',
  'this will overwrite',
  'this will list',
  'this will search',
  'this will run',
  'this will read',
  'this will save',
  'this will create',
  'this will edit',
  'this will capture',
  'this will take',
  'save a screenshot',
  'list local workspace files',
  'list files and directories',
  'persistent chromium browser',
] as const;

const chatGptMcpPrimaryActionPatterns = [
  'allow',
  'approve',
  'list entries',
  'open browser session',
  'open local chrome session',
  'write file',
  'run command',
  'capture screen',
  'search workspace',
  'describe project',
  'read file',
  'read local file',
  'read local text file',
  'overwrite',
  'create local empty file',
  'create file',
  'edit file',
  'take screenshot',
  'capture screenshot',
  'replace text',
  'run local terminal command',
  'run local powershell script',
  'review local project',
  'read local project files',
  'search local workspace',
] as const;

const chatGptMcpRejectActionPatterns = [
  'deny',
  'cancel',
  'not now',
  '\uAC70\uBD80',
  '\uCDE8\uC18C',
  '\uC124\uC815\uC5D0\uC11C \uC0AC\uC6A9 \uC911\uC9C0',
] as const;

const chatGptMcpIgnoredActionPatterns = [
  'details',
  'learn more',
  '\uC790\uC138\uD788',
  '\uB354 \uC54C\uC544\uBCF4\uAE30',
] as const;

const chatGptMcpRememberOptionPatterns = [
  'remember',
  '\uAE30\uC5B5',
  '\uC774 \uB300\uD654',
  'this conversation',
] as const;

function normalizeUiText(text: string): string {
  return text.trim().replace(/\s+/g, ' ').toLowerCase();
}

function compactUiText(text: string): string {
  return normalizeUiText(text).replace(/[^\p{L}\p{N}]+/gu, '');
}

function matchesAnyPattern(text: string, patterns: readonly string[]): boolean {
  const normalizedText = normalizeUiText(text);
  const compactText = compactUiText(text);

  if (!normalizedText) {
    return false;
  }

  return patterns.some((pattern) => {
    const normalizedPattern = normalizeUiText(pattern);
    const compactPattern = compactUiText(pattern);
    return (
      normalizedText.includes(normalizedPattern) ||
      (compactPattern !== '' && compactText.includes(compactPattern))
    );
  });
}

export function matchesChatGptMcpPrimaryAction(text: string): boolean {
  return matchesAnyPattern(text, chatGptMcpPrimaryActionPatterns);
}

export function matchesChatGptMcpContext(text: string): boolean {
  return matchesAnyPattern(text, chatGptMcpContextPatterns);
}

export function matchesChatGptMcpRejectAction(text: string): boolean {
  return matchesAnyPattern(text, chatGptMcpRejectActionPatterns);
}

export function matchesChatGptMcpIgnoredAction(text: string): boolean {
  return matchesAnyPattern(text, chatGptMcpIgnoredActionPatterns);
}

export function matchesChatGptMcpAppName(text: string): boolean {
  return matchesAnyPattern(text, chatGptMcpAppNamePatterns);
}

export function getChatGptMcpAppNamePatterns(): string[] {
  return [...chatGptMcpAppNamePatterns];
}

export function getChatGptMcpContextPatterns(): string[] {
  return [...chatGptMcpContextPatterns];
}

export function getChatGptMcpPrimaryActionPatterns(): string[] {
  return [...chatGptMcpPrimaryActionPatterns];
}

export function getChatGptMcpRejectActionPatterns(): string[] {
  return [...chatGptMcpRejectActionPatterns];
}

export function getChatGptMcpIgnoredActionPatterns(): string[] {
  return [...chatGptMcpIgnoredActionPatterns];
}

export function getChatGptMcpRememberOptionPatterns(): string[] {
  return [...chatGptMcpRememberOptionPatterns];
}
