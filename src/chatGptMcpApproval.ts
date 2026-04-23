type ApprovalToolDefinition = {
  name: string;
  description: string;
  annotations?: {
    title?: string;
  };
};

export type ChatGptMcpApprovalContract = {
  appNamePatterns: string[];
  contextPatterns: string[];
  primaryActionPatterns: string[];
  rejectActionPatterns: string[];
  ignoredActionPatterns: string[];
  rememberOptionPatterns: string[];
};

const baseAppNamePatterns = ['full access mcp'] as const;

const baseContextPatterns = [
  'sharing data includes',
  'using tools comes with risks',
  'local workspace files will be modified',
  'this will execute',
  'this will overwrite',
  'this will list',
  'this will search',
  'this will run',
  'this will read',
  'this will create',
  'this will edit',
  'this will start',
  'this will allow',
  'full computer-wide access',
  'including all local windows files',
  'start a local playwright browser session',
  'access local files on your pc',
  'open full-access browser session',
  'capture full desktop screenshot',
  'full desktop screenshot',
  'list local workspace files',
  'list files and directories',
] as const;

const basePrimaryActionPatterns = [
  'allow',
  'approve',
  'confirm',
  'continue',
  'connect',
  'activate window',
  '확인',
  '계속',
  '계속하기',
  'open session',
  'access files',
  'make directory',
  'capture screen',
  'local browser automation',
  'list entries',
  'write file',
  'run command',
  'search workspace',
  'describe project',
  'read file',
  'read local file',
  'read local text file',
  'overwrite',
  'create local empty file',
  'create file',
  'edit file',
  'replace text',
  'run local terminal command',
  'run local powershell script',
  'review local project',
  'read local project files',
  'search local workspace',
] as const;

const baseRejectActionPatterns = [
  'deny',
  'cancel',
  'not now',
  '거부',
  '거절하기',
  '취소',
  'do not connect',
  '설정에서 사용 중지',
] as const;

const baseIgnoredActionPatterns = [
  'details',
  'learn more',
  '자세히',
  '더 알아보기',
  'click to remove',
  'remove',
] as const;

const baseRememberOptionPatterns = [
  'remember',
  '기억',
  '이 대화',
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

function matchesAnyActionPattern(text: string, patterns: readonly string[]): boolean {
  const normalizedText = normalizeUiText(text);
  const compactText = compactUiText(text);

  if (!normalizedText) {
    return false;
  }

  return patterns.some((pattern) => {
    const normalizedPattern = normalizeUiText(pattern);
    const compactPattern = compactUiText(pattern);
    return (
      normalizedText === normalizedPattern ||
      (compactPattern !== '' && compactText === compactPattern)
    );
  });
}

function uniquePatterns(patterns: Iterable<string>): string[] {
  const normalizedToPattern = new Map<string, string>();

  for (const pattern of patterns) {
    const normalizedPattern = normalizeUiText(pattern);
    if (!normalizedPattern) {
      continue;
    }

    if (!normalizedToPattern.has(normalizedPattern)) {
      normalizedToPattern.set(normalizedPattern, pattern.trim());
    }
  }

  return [...normalizedToPattern.values()];
}

function deriveContextPatterns(toolDefinition: ApprovalToolDefinition): string[] {
  const patterns = new Set<string>();
  patterns.add(toolDefinition.description);

  const title = toolDefinition.annotations?.title?.trim();
  if (title) {
    patterns.add(title);
  }

  const normalizedToolName = toolDefinition.name;

  if (
    normalizedToolName.includes('open_session') ||
    normalizedToolName.includes('navigate') ||
    normalizedToolName.startsWith('browser_') ||
    normalizedToolName.startsWith('playwright_')
  ) {
    patterns.add('browser automation');
    patterns.add('local browser automation');
    patterns.add('browser session');
  }

  if (
    normalizedToolName.includes('make_directory') ||
    normalizedToolName.includes('write_text') ||
    normalizedToolName.includes('replace_text') ||
    normalizedToolName.includes('create_empty_file') ||
    normalizedToolName.includes('copy_path') ||
    normalizedToolName.includes('move_path') ||
    normalizedToolName.includes('delete_path')
  ) {
    patterns.add('access local files on your pc');
    patterns.add('local files');
    patterns.add('workspace files');
  }

  if (normalizedToolName.includes('capture_screen')) {
    patterns.add('capture full desktop screenshot');
    patterns.add('full desktop screenshot');
  }

  return [...patterns];
}

function derivePrimaryActionPatterns(toolDefinition: ApprovalToolDefinition): string[] {
  const patterns = new Set<string>();

  if (toolDefinition.name.includes('open_session')) {
    patterns.add('open session');
  }

  if (toolDefinition.name === 'browser_open_session') {
    patterns.add('open browser session');
  }

  if (
    toolDefinition.name.includes('open_session') ||
    toolDefinition.name.includes('navigate') ||
    toolDefinition.name.startsWith('browser_') ||
    toolDefinition.name.startsWith('playwright_')
  ) {
    patterns.add('local browser automation');
  }

  if (
    toolDefinition.name.includes('make_directory') ||
    toolDefinition.name.includes('write_text') ||
    toolDefinition.name.includes('replace_text') ||
    toolDefinition.name.includes('create_empty_file') ||
    toolDefinition.name.includes('copy_path') ||
    toolDefinition.name.includes('move_path') ||
    toolDefinition.name.includes('delete_path')
  ) {
    patterns.add('access files');
  }

  if (toolDefinition.name.includes('make_directory')) {
    patterns.add('make directory');
    patterns.add('create folder');
  }

  if (toolDefinition.name.includes('write_text')) {
    patterns.add('write file');
  }

  if (toolDefinition.name.includes('replace_text')) {
    patterns.add('replace text');
    patterns.add('edit file');
  }

  if (toolDefinition.name.includes('create_empty_file')) {
    patterns.add('create file');
  }

  if (toolDefinition.name.includes('capture_screen')) {
    patterns.add('capture screen');
  }

  if (toolDefinition.name.includes('run') && toolDefinition.name.startsWith('command_')) {
    patterns.add('run command');
  }

  if (toolDefinition.name.includes('search_text')) {
    patterns.add('search workspace');
    patterns.add('search local workspace');
  }

  if (toolDefinition.name.includes('describe_project')) {
    patterns.add('describe project');
  }

  if (toolDefinition.name.includes('review_project')) {
    patterns.add('review local project');
  }

  if (toolDefinition.name.includes('read_text')) {
    patterns.add('read file');
    patterns.add('read local text file');
  }

  if (toolDefinition.name.includes('list_entries')) {
    patterns.add('list entries');
  }

  return [...patterns];
}

export function createDefaultChatGptMcpApprovalContract(): ChatGptMcpApprovalContract {
  return {
    appNamePatterns: [...baseAppNamePatterns],
    contextPatterns: [...baseContextPatterns],
    primaryActionPatterns: [...basePrimaryActionPatterns],
    rejectActionPatterns: [...baseRejectActionPatterns],
    ignoredActionPatterns: [...baseIgnoredActionPatterns],
    rememberOptionPatterns: [...baseRememberOptionPatterns],
  };
}

export function buildChatGptMcpApprovalContract(
  toolDefinitions: ApprovalToolDefinition[],
): ChatGptMcpApprovalContract {
  const defaultContract = createDefaultChatGptMcpApprovalContract();

  return {
    appNamePatterns: defaultContract.appNamePatterns,
    contextPatterns: uniquePatterns([
      ...defaultContract.contextPatterns,
      ...toolDefinitions.flatMap((toolDefinition) =>
        deriveContextPatterns(toolDefinition),
      ),
    ]),
    primaryActionPatterns: uniquePatterns([
      ...defaultContract.primaryActionPatterns,
      ...toolDefinitions.flatMap((toolDefinition) =>
        derivePrimaryActionPatterns(toolDefinition),
      ),
    ]),
    rejectActionPatterns: defaultContract.rejectActionPatterns,
    ignoredActionPatterns: defaultContract.ignoredActionPatterns,
    rememberOptionPatterns: defaultContract.rememberOptionPatterns,
  };
}

export function matchesChatGptMcpPrimaryAction(
  text: string,
  contract: ChatGptMcpApprovalContract = createDefaultChatGptMcpApprovalContract(),
): boolean {
  return matchesAnyActionPattern(text, contract.primaryActionPatterns);
}

export function matchesChatGptMcpContext(
  text: string,
  contract: ChatGptMcpApprovalContract = createDefaultChatGptMcpApprovalContract(),
): boolean {
  return matchesAnyPattern(text, contract.contextPatterns);
}

export function matchesChatGptMcpRejectAction(
  text: string,
  contract: ChatGptMcpApprovalContract = createDefaultChatGptMcpApprovalContract(),
): boolean {
  return matchesAnyActionPattern(text, contract.rejectActionPatterns);
}

export function matchesChatGptMcpIgnoredAction(
  text: string,
  contract: ChatGptMcpApprovalContract = createDefaultChatGptMcpApprovalContract(),
): boolean {
  return matchesAnyPattern(text, contract.ignoredActionPatterns);
}

export function matchesChatGptMcpAppName(
  text: string,
  contract: ChatGptMcpApprovalContract = createDefaultChatGptMcpApprovalContract(),
): boolean {
  return matchesAnyPattern(text, contract.appNamePatterns);
}
