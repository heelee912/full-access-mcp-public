import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import {
  chromium,
  type Browser,
  type BrowserContext,
  type Page,
} from 'playwright';

import {
  createDefaultChatGptMcpApprovalContract,
  type ChatGptMcpApprovalContract,
} from './chatGptMcpApproval.js';
import { WorkspaceFileAccess } from './workspaceFileAccess.js';

type BrowserSessionStrategy = 'devtools' | 'playwright';

interface BaseBrowserSession {
  id: string;
  startedAt: string;
  pageTitle: string;
  pageUrl: string;
  storagePath: string;
}

interface DevToolsBrowserSession extends BaseBrowserSession {
  strategy: 'devtools';
  pageId: number;
}

interface PlaywrightBrowserSession extends BaseBrowserSession {
  strategy: 'playwright';
  browser: Browser;
  context: BrowserContext;
  page: Page;
}

type BrowserSession = DevToolsBrowserSession | PlaywrightBrowserSession;

interface ChromeDevToolsTextContent {
  type?: string;
  text?: string;
}

interface ChromeDevToolsToolResult {
  content?: ChromeDevToolsTextContent[];
  isError?: boolean;
}

interface BrowserPageDescriptor {
  pageId: number;
  url: string;
  selected: boolean;
}

interface BrowserPageState {
  url: string;
  title: string;
  textPreview: string;
}

interface ChatGptMcpPromptApprovalResult {
  foundPrompt: boolean;
  approved: boolean;
  remembered: boolean;
  buttonName: string | null;
  rememberName: string | null;
  candidateButtons: string[];
  pageId: number | null;
  url: string | null;
  reason?: string;
}

type ChromeToolCallOptions = {
  retryOnRecoverableConnectionError?: boolean;
};

export function shouldRetryChromeToolCallOnRecoverableConnectionError(
  options: ChromeToolCallOptions,
): boolean {
  return options.retryOnRecoverableConnectionError === true;
}

function sleep(delayMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });
}

function extractTextContent(toolResult: ChromeDevToolsToolResult): string {
  return (toolResult.content ?? [])
    .filter((contentBlock) => contentBlock.type === 'text' && contentBlock.text)
    .map((contentBlock) => contentBlock.text ?? '')
    .join('\n')
    .trim();
}

function parseJsonCodeBlock<T>(text: string): T | undefined {
  const jsonBlockMatch = text.match(/```json\s*([\s\S]*?)\s*```/i);
  const jsonSource = jsonBlockMatch?.[1]?.trim();

  if (!jsonSource) {
    return undefined;
  }

  return JSON.parse(jsonSource) as T;
}

function parseBrowserPageList(
  toolResult: ChromeDevToolsToolResult,
): BrowserPageDescriptor[] {
  const text = extractTextContent(toolResult);

  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .flatMap((line) => {
      const match = line.match(/^(\d+):\s+(\S+?)(?:\s+\[selected\])?$/);

      if (!match) {
        return [];
      }

      const pageId = Number(match[1]);
      const url = match[2] ?? '';

      if (!Number.isFinite(pageId) || url === '') {
        return [];
      }

      return [
        {
          pageId,
          url,
          selected: line.includes('[selected]'),
        },
      ];
    });
}

function isUnknownBrowserSessionError(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.message.toLowerCase().includes('unknown browser session')
  );
}

export function isRecoverableChromeConnectionError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  return /could not connect to chrome|failed to fetch browser websocket url|connection closed|transport closed|econnrefused/i.test(
    error.message,
  );
}

export function isMissingChromePageError(error: unknown): boolean {
  return (
    error instanceof Error &&
    /(no page found|unknown page|page not found)/i.test(error.message)
  );
}

export function buildGoogleSearchUrl(query: string): string {
  const searchUrl = new URL('https://www.google.com/search');
  searchUrl.searchParams.set('q', query);
  return searchUrl.toString();
}

export function normalizeComparableBrowserUrl(url: string): string {
  const normalizedUrl = new URL(url);
  normalizedUrl.hash = '';
  return normalizedUrl.toString();
}

export function extractGoogleSearchQuery(url: string): string | undefined {
  const parsedUrl = new URL(url);
  const normalizedHostname = parsedUrl.hostname.toLowerCase();

  if (!normalizedHostname.startsWith('www.google.') && normalizedHostname !== 'google.com') {
    return undefined;
  }

  if (parsedUrl.pathname === '/search') {
    return parsedUrl.searchParams.get('q') ?? undefined;
  }

  if (parsedUrl.pathname === '/sorry/index') {
    const continuedUrl = parsedUrl.searchParams.get('continue');
    if (!continuedUrl) {
      return undefined;
    }

    const nestedUrl = new URL(continuedUrl);
    if (nestedUrl.pathname !== '/search') {
      return undefined;
    }

    return nestedUrl.searchParams.get('q') ?? undefined;
  }

  return undefined;
}

function buildComparableBrowserTargetKey(url: string): string {
  const googleSearchQuery = extractGoogleSearchQuery(url);
  if (googleSearchQuery) {
    return `google-search:${googleSearchQuery}`;
  }

  return normalizeComparableBrowserUrl(url);
}

export function findReusableBrowserPage(
  pages: BrowserPageDescriptor[],
  targetUrl: string,
): BrowserPageDescriptor | undefined {
  const normalizedTargetKey = buildComparableBrowserTargetKey(targetUrl);
  return (
    pages.find(
      (page) =>
        page.selected &&
        buildComparableBrowserTargetKey(page.url) === normalizedTargetKey,
    ) ??
    pages.find(
      (page) => buildComparableBrowserTargetKey(page.url) === normalizedTargetKey,
    )
  );
}

function buildChatGptMcpApprovalEvaluationScript(
  approvalContract: ChatGptMcpApprovalContract,
): string {
  const appNamePatterns = JSON.stringify(approvalContract.appNamePatterns);
  const contextPatterns = JSON.stringify(approvalContract.contextPatterns);
  const primaryActionPatterns = JSON.stringify(
    approvalContract.primaryActionPatterns,
  );
  const rejectActionPatterns = JSON.stringify(
    approvalContract.rejectActionPatterns,
  );
  const ignoredActionPatterns = JSON.stringify(
    approvalContract.ignoredActionPatterns,
  );
  const rememberOptionPatterns = JSON.stringify(
    approvalContract.rememberOptionPatterns,
  );

  return `() => {
    const appPatterns = ${appNamePatterns};
    const contextPatterns = ${contextPatterns};
    const primaryPatterns = ${primaryActionPatterns};
    const rejectPatterns = ${rejectActionPatterns};
    const ignoredPatterns = ${ignoredActionPatterns};
    const rememberPatterns = ${rememberOptionPatterns};
    const normalize = (value) => String(value ?? '').replace(/\\s+/g, ' ').trim();
    const normalizeLower = (value) => normalize(value).toLowerCase();
    const compact = (value) =>
      normalizeLower(value).replace(/[^\\p{L}\\p{N}]+/gu, '');
    const matchesAny = (value, patterns) => {
      const normalized = normalizeLower(value);
      const compactValue = compact(value);
      return (
        normalized !== '' &&
        patterns.some((pattern) => {
          const normalizedPattern = normalizeLower(pattern);
          const compactPattern = compact(pattern);
          return (
            normalized.includes(normalizedPattern) ||
            (compactPattern !== '' && compactValue.includes(compactPattern))
          );
        })
      );
    };
    const matchesAction = (value, patterns) => {
      const normalized = normalizeLower(value);
      const compactValue = compact(value);
      return (
        normalized !== '' &&
        patterns.some((pattern) => {
          const normalizedPattern = normalizeLower(pattern);
          const compactPattern = compact(pattern);
          return (
            normalized === normalizedPattern ||
            (compactPattern !== '' && compactValue === compactPattern)
          );
        })
      );
    };
    const isVisible = (element) => {
      if (!(element instanceof HTMLElement)) {
        return false;
      }
      const style = globalThis.getComputedStyle(element);
      if (style.visibility === 'hidden' || style.display === 'none') {
        return false;
      }
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    };
    const getButtonLabel = (element) =>
      normalize(
        element.getAttribute('aria-label') ||
          element.getAttribute('title') ||
          element.innerText ||
          element.textContent,
      );
    const hasPrimaryButtonClass = (element) =>
      /(?:^|\\s)btn-primary(?:\\s|$)/i.test(element.className || '');
    const hasSecondaryButtonClass = (element) =>
      /(?:^|\\s)btn-secondary(?:\\s|$)/i.test(element.className || '');
    const hasAppMarker = (element, text) => {
      if (matchesAny(text, appPatterns)) {
        return true;
      }
      return [...element.querySelectorAll('img[alt]')].some((image) =>
        matchesAny(image.getAttribute('alt') || '', appPatterns),
      );
    };
    const result = {
      foundPrompt: false,
      approved: false,
      remembered: false,
      buttonName: null,
      rememberName: null,
      candidateButtons: [],
      url: location.href,
    };
    if (!/chatgpt\\.com$/i.test(location.hostname) && !/chatgpt\\.com/i.test(location.href)) {
      return { ...result, reason: 'not-chatgpt' };
    }
    const containerCandidates = [...document.querySelectorAll('div,section,article,[role="dialog"]')]
      .filter(isVisible)
      .map((element) => {
        const text = normalize(element.innerText || element.textContent);
        if (!hasAppMarker(element, text)) {
          return null;
        }
        const hasContext = matchesAny(text, contextPatterns);
        if (!hasContext) {
          return null;
        }
        const buttons = [...element.querySelectorAll('button,[role="button"]')]
          .filter(isVisible)
          .map((button) => ({
            element: button,
            label: getButtonLabel(button),
          }))
          .filter((button) => button.label !== '');
        const positiveButtons = buttons.filter(
          (button) =>
            !matchesAny(button.label, ignoredPatterns) &&
            !matchesAction(button.label, rejectPatterns) &&
            !matchesAny(button.label, appPatterns) &&
            (matchesAction(button.label, primaryPatterns) ||
              hasPrimaryButtonClass(button.element)),
        );
        const rejectButtons = buttons.filter((button) =>
          matchesAction(button.label, rejectPatterns) ||
          hasSecondaryButtonClass(button.element),
        );
        if (positiveButtons.length === 0 || rejectButtons.length === 0) {
          return null;
        }
        return {
          element,
          text,
          buttons,
          positiveButtons,
          rejectButtons,
          textLength: text.length,
        };
      })
      .filter(Boolean)
      .sort((left, right) => left.textLength - right.textLength);
    if (containerCandidates.length === 0) {
      return { ...result, reason: 'no-mcp-card' };
    }
    const selected = containerCandidates[0];
    result.foundPrompt = true;
    result.candidateButtons = selected.buttons.map((button) => button.label);
    const rememberTarget = [...selected.element.querySelectorAll('label,button,[role="checkbox"],input[type="checkbox"]')]
      .find((element) => isVisible(element) && matchesAny(getButtonLabel(element), rememberPatterns));
    if (rememberTarget instanceof HTMLElement) {
      rememberTarget.click();
      result.remembered = true;
      result.rememberName = getButtonLabel(rememberTarget);
    }
    const selectedButton =
      selected.positiveButtons.find((button) =>
        hasPrimaryButtonClass(button.element),
      ) ?? selected.positiveButtons[selected.positiveButtons.length - 1];
    if (selectedButton && selectedButton.element instanceof HTMLElement) {
      selectedButton.element.click();
      result.approved = true;
      result.buttonName = selectedButton.label;
    }
    return result;
  }`;
}

export class BrowserSessionRegistry {
  private readonly sessions = new Map<string, BrowserSession>();
  private browserClient: Client | undefined;
  private browserTransport: StdioClientTransport | undefined;
  private browserClientPromise: Promise<Client> | undefined;
  private browserCallQueue: Promise<void> = Promise.resolve();
  private chatGptMcpApprovalContract: ChatGptMcpApprovalContract =
    createDefaultChatGptMcpApprovalContract();

  constructor(
    private readonly workspaceFileAccess: WorkspaceFileAccess,
    private readonly enabled: boolean,
    private readonly defaultHeadless: boolean,
    private readonly storageRoot: string,
  ) {}

  setChatGptMcpApprovalContract(
    approvalContract: ChatGptMcpApprovalContract,
  ): void {
    this.chatGptMcpApprovalContract = approvalContract;
  }

  private ensureBrowserEnabled(): void {
    if (!this.enabled) {
      throw new Error('browser tools are disabled by configuration');
    }
  }

  private getBrowserSession(sessionId: string): BrowserSession {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`unknown browser session: ${sessionId}`);
    }

    return session;
  }

  private getDevToolsSession(sessionId: string): DevToolsBrowserSession {
    const session = this.getBrowserSession(sessionId);
    if (session.strategy !== 'devtools') {
      throw new Error(`session ${sessionId} is not a Chrome DevTools session`);
    }

    return session;
  }

  private getPlaywrightSession(sessionId: string): PlaywrightBrowserSession {
    const session = this.getBrowserSession(sessionId);
    if (session.strategy !== 'playwright') {
      throw new Error(`session ${sessionId} is not a Playwright session`);
    }

    return session;
  }

  private async ensureBrowserClient(): Promise<Client> {
    this.ensureBrowserEnabled();

    if (this.browserClient) {
      return this.browserClient;
    }

    if (this.browserClientPromise) {
      return await this.browserClientPromise;
    }

    this.browserClientPromise = (async () => {
      const browserWrapperPath = path.join(
        process.cwd(),
        '.tools',
        'start-chrome-devtools-mcp.cjs',
      );
      const transport = new StdioClientTransport({
        command: 'node.exe',
        args: [browserWrapperPath],
        stderr: 'pipe',
        cwd: process.cwd(),
      });

      if (transport.stderr) {
        transport.stderr.on('data', (chunk) => {
          const message = chunk.toString('utf8').trim();
          if (message) {
            console.error(`[chrome-devtools-mcp] ${message}`);
          }
        });
      }

      const client = new Client(
        {
          name: 'full-access-browser-session-registry',
          version: '0.1.0',
        },
        {
          capabilities: {},
        },
      );

      await client.connect(transport);

      this.browserTransport = transport;
      this.browserClient = client;

      return client;
    })();

    try {
      return await this.browserClientPromise;
    } finally {
      this.browserClientPromise = undefined;
    }
  }

  private async resetBrowserClient(): Promise<void> {
    const transport = this.browserTransport;
    this.browserClient = undefined;
    this.browserTransport = undefined;
    this.browserClientPromise = undefined;

    if (!transport) {
      return;
    }

    await Promise.race([transport.close(), sleep(1_000)]).catch(() => {});
  }

  private async callChromeTool(
    name: string,
    argumentsValue: Record<string, unknown>,
    options: ChromeToolCallOptions = {},
  ): Promise<ChromeDevToolsToolResult> {
    let lastError: unknown;

    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        return await this.enqueueChromeCall(async () => {
          const client = await this.ensureBrowserClient();
          const toolResult = (await client.callTool({
            name,
            arguments: argumentsValue,
          })) as ChromeDevToolsToolResult;

          if (toolResult.isError) {
            const errorText =
              extractTextContent(toolResult) ||
              `Chrome DevTools MCP tool failed: ${name}`;
            throw new Error(errorText);
          }

          return toolResult;
        });
      } catch (error) {
        lastError = error;

        if (
          attempt === 0 &&
          shouldRetryChromeToolCallOnRecoverableConnectionError(options) &&
          isRecoverableChromeConnectionError(error)
        ) {
          await this.resetBrowserClient();
          continue;
        }

        throw error;
      }
    }

    throw lastError instanceof Error
      ? lastError
      : new Error(`Chrome DevTools MCP tool failed: ${name}`);
  }

  private async enqueueChromeCall<T>(operation: () => Promise<T>): Promise<T> {
    const nextOperation = this.browserCallQueue.then(operation, operation);

    this.browserCallQueue = nextOperation.then(
      () => undefined,
      () => undefined,
    );

    return await nextOperation;
  }

  private async listPages(): Promise<BrowserPageDescriptor[]> {
    const toolResult = await this.callChromeTool(
      'list_pages',
      {},
      { retryOnRecoverableConnectionError: true },
    );
    const pages = parseBrowserPageList(toolResult);

    if (pages.length === 0) {
      throw new Error(
        'Chrome DevTools MCP did not report any open browser pages.',
      );
    }

    return pages;
  }

  private async selectPage(pageId: number): Promise<void> {
    await this.callChromeTool(
      'select_page',
      { pageId },
      { retryOnRecoverableConnectionError: true },
    );
  }

  private async captureDevToolsPageState(pageId: number): Promise<BrowserPageState> {
    await this.selectPage(pageId);

    const toolResult = await this.callChromeTool('evaluate_script', {
      function:
        '() => ({ title: document.title, url: location.href, textPreview: (document.body?.innerText || "").slice(0, 4000) })',
    }, { retryOnRecoverableConnectionError: true });

    const parsed = parseJsonCodeBlock<BrowserPageState>(
      extractTextContent(toolResult),
    );

    if (!parsed) {
      throw new Error(
        'Chrome DevTools MCP did not return a JSON page snapshot.',
      );
    }

    return parsed;
  }

  private async capturePlaywrightPageState(page: Page): Promise<BrowserPageState> {
    await page.waitForLoadState('domcontentloaded').catch(() => {});
    const evaluatedState = await page
      .evaluate(() => ({
        title: document.title,
        url: location.href,
        textPreview: (document.body?.innerText || '').slice(0, 4000),
      }))
      .catch(async () => ({
        title: await page.title().catch(() => ''),
        url: page.url(),
        textPreview: '',
      }));

    return {
      url: evaluatedState.url,
      title: evaluatedState.title,
      textPreview: evaluatedState.textPreview,
    };
  }

  private updateBrowserSession(
    sessionId: string,
    pageState: BrowserPageState,
  ): BrowserSession {
    const session = this.getBrowserSession(sessionId);
    const nextSession: BrowserSession = {
      ...session,
      pageTitle: pageState.title,
      pageUrl: pageState.url,
    };

    this.sessions.set(sessionId, nextSession);
    return nextSession;
  }

  private async rebindDevToolsSessionToActivePage(
    sessionId: string,
  ): Promise<DevToolsBrowserSession> {
    const session = this.getDevToolsSession(sessionId);
    const pages = await this.listPages();
    const selectedPage = pages.find((page) => page.selected) ?? pages[0];

    if (!selectedPage) {
      throw new Error('No existing Chrome page is available to rebind.');
    }

    const pageState = await this.captureDevToolsPageState(selectedPage.pageId);
    const reboundSession: DevToolsBrowserSession = {
      ...session,
      pageId: selectedPage.pageId,
      pageTitle: pageState.title,
      pageUrl: pageState.url,
    };
    this.sessions.set(sessionId, reboundSession);
    return reboundSession;
  }

  private async runWithRecoveredDevToolsSession<T>(
    sessionId: string,
    operation: (session: DevToolsBrowserSession) => Promise<T>,
  ): Promise<T> {
    let session = this.getDevToolsSession(sessionId);

    try {
      return await operation(session);
    } catch (error) {
      if (!isMissingChromePageError(error)) {
        throw error;
      }

      session = await this.rebindDevToolsSessionToActivePage(sessionId);
      return await operation(session);
    }
  }

  async listBrowserPages(): Promise<BrowserPageDescriptor[]> {
    return await this.listPages();
  }

  async approveChatGptMcpPrompt(): Promise<ChatGptMcpPromptApprovalResult> {
    this.ensureBrowserEnabled();

    const pages = await this.listPages();
    const selectedPage = pages.find((page) => page.selected) ?? null;
    const chatGptPages = [
      ...pages.filter((page) => page.selected && page.url.includes('chatgpt.com')),
      ...pages.filter((page) => !page.selected && page.url.includes('chatgpt.com')),
    ];

    if (chatGptPages.length === 0) {
      return {
        foundPrompt: false,
        approved: false,
        remembered: false,
        buttonName: null,
        rememberName: null,
        candidateButtons: [],
        pageId: null,
        url: selectedPage?.url ?? null,
        reason: 'no-chatgpt-page',
      };
    }

    let lastResult: ChatGptMcpPromptApprovalResult = {
      foundPrompt: false,
      approved: false,
      remembered: false,
      buttonName: null,
      rememberName: null,
      candidateButtons: [],
      pageId: chatGptPages[0]?.pageId ?? null,
      url: chatGptPages[0]?.url ?? null,
      reason: 'no-mcp-card',
    };

    for (const chatGptPage of chatGptPages) {
      await this.selectPage(chatGptPage.pageId);

      const toolResult = await this.callChromeTool('evaluate_script', {
        function: buildChatGptMcpApprovalEvaluationScript(
          this.chatGptMcpApprovalContract,
        ),
      });
      const parsed = parseJsonCodeBlock<ChatGptMcpPromptApprovalResult>(
        extractTextContent(toolResult),
      );

      if (!parsed) {
        throw new Error(
          'Chrome DevTools MCP did not return a JSON ChatGPT approval result.',
        );
      }

      lastResult = {
        foundPrompt: parsed.foundPrompt,
        approved: parsed.approved,
        remembered: parsed.remembered,
        buttonName: parsed.buttonName ?? null,
        rememberName: parsed.rememberName ?? null,
        candidateButtons: parsed.candidateButtons ?? [],
        pageId: chatGptPage.pageId,
        url: parsed.url ?? chatGptPage.url,
        reason: parsed.reason,
      };

      if (lastResult.foundPrompt || lastResult.approved) {
        return lastResult;
      }
    }

    return lastResult;
  }

  async openBrowserSession(options: {
    initialUrl?: string;
    headless?: boolean;
    viewportWidth?: number;
    viewportHeight?: number;
    attachSelectedPage?: boolean;
  }): Promise<{
    sessionId: string;
    startedAt: string;
    url: string;
    storagePath: string;
    strategy: BrowserSessionStrategy;
  }> {
    this.ensureBrowserEnabled();

    if (options.headless === true || this.defaultHeadless) {
      console.warn(
        'browser_open_session requested headless mode, but Chrome DevTools MCP attaches to the visible local Chrome session.',
      );
    }

    let selectedPage: BrowserPageDescriptor | undefined;

    if (options.attachSelectedPage) {
      const pages = await this.listPages();
      selectedPage = pages.find((page) => page.selected) ?? pages[0];
    } else {
      const pages = await this.listPages();
      selectedPage = options.initialUrl
        ? findReusableBrowserPage(pages, options.initialUrl)
        : undefined;

      if (!selectedPage) {
        await this.callChromeTool('new_page', {
          url: options.initialUrl ?? 'about:blank',
        });
        const refreshedPages = await this.listPages();
        selectedPage =
          refreshedPages.find((page) => page.selected) ?? refreshedPages[0];
      }
    }

    if (!selectedPage) {
      throw new Error('No existing Chrome page is available to attach.');
    }

    if (options.attachSelectedPage && options.initialUrl) {
      await this.selectPage(selectedPage.pageId);
      await this.callChromeTool('navigate_page', {
        type: 'url',
        url: options.initialUrl,
      });
    }

    const pageState = await this.captureDevToolsPageState(selectedPage.pageId);
    const sessionId = randomUUID();
    const startedAt = new Date().toISOString();
    const storagePath = path.join(this.storageRoot, 'attached-current-chrome');

    this.sessions.set(sessionId, {
      strategy: 'devtools',
      id: sessionId,
      startedAt,
      pageId: selectedPage.pageId,
      pageTitle: pageState.title,
      pageUrl: pageState.url,
      storagePath,
    });

    return {
      sessionId,
      startedAt,
      url: pageState.url,
      storagePath,
      strategy: 'devtools',
    };
  }

  async openPlaywrightSession(options: {
    initialUrl?: string;
    headless?: boolean;
    viewportWidth?: number;
    viewportHeight?: number;
  }): Promise<{
    sessionId: string;
    startedAt: string;
    url: string;
    storagePath: string;
    strategy: BrowserSessionStrategy;
  }> {
    this.ensureBrowserEnabled();

    const sessionId = randomUUID();
    const startedAt = new Date().toISOString();
    const storagePath = path.join(this.storageRoot, 'playwright', sessionId);
    await fs.mkdir(storagePath, { recursive: true });

    const viewport =
      options.viewportWidth && options.viewportHeight
        ? {
            width: options.viewportWidth,
            height: options.viewportHeight,
          }
        : undefined;

    const browser = await chromium.launch({
      headless: options.headless ?? this.defaultHeadless,
    });

    try {
      const context = await browser.newContext({ viewport });
      const page = await context.newPage();

      if (options.initialUrl) {
        await page.goto(options.initialUrl, {
          waitUntil: 'domcontentloaded',
        });
      }

      const pageState = await this.capturePlaywrightPageState(page);

      this.sessions.set(sessionId, {
        strategy: 'playwright',
        id: sessionId,
        startedAt,
        browser,
        context,
        page,
        pageTitle: pageState.title,
        pageUrl: pageState.url,
        storagePath,
      });

      return {
        sessionId,
        startedAt,
        url: pageState.url,
        storagePath,
        strategy: 'playwright',
      };
    } catch (error) {
      await browser.close().catch(() => {});
      throw error;
    }
  }

  async navigateBrowserSession(
    sessionId: string,
    url: string,
  ): Promise<{ sessionId: string; url: string; title: string }> {
    const session = this.getBrowserSession(sessionId);

    if (session.strategy === 'devtools') {
      return await this.runWithRecoveredDevToolsSession(
        sessionId,
        async (activeSession) => {
          await this.selectPage(activeSession.pageId);
          await this.callChromeTool('navigate_page', {
            type: 'url',
            url,
          });

          const pageState = await this.captureDevToolsPageState(
            activeSession.pageId,
          );
          this.updateBrowserSession(sessionId, pageState);

          return {
            sessionId,
            url: pageState.url,
            title: pageState.title,
          };
        },
      );
    }

    await session.page.goto(url, {
      waitUntil: 'domcontentloaded',
    });
    const pageState = await this.capturePlaywrightPageState(session.page);
    this.updateBrowserSession(sessionId, pageState);

    return {
      sessionId,
      url: pageState.url,
      title: pageState.title,
    };
  }

  async snapshotBrowserSession(sessionId: string): Promise<{
    sessionId: string;
    url: string;
    title: string;
    textPreview: string;
  }> {
    const session = this.getBrowserSession(sessionId);
    const pageState =
      session.strategy === 'devtools'
        ? await this.runWithRecoveredDevToolsSession(
            sessionId,
            async (activeSession) =>
              await this.captureDevToolsPageState(activeSession.pageId),
          )
        : await this.capturePlaywrightPageState(session.page);

    this.updateBrowserSession(sessionId, pageState);

    return {
      sessionId,
      url: pageState.url,
      title: pageState.title,
      textPreview: pageState.textPreview,
    };
  }

  async clickBrowserSession(
    sessionId: string,
    selector: string,
  ): Promise<{ sessionId: string; selector: string; url: string }> {
    const session = this.getBrowserSession(sessionId);

    if (session.strategy === 'devtools') {
      return await this.runWithRecoveredDevToolsSession(
        sessionId,
        async (activeSession) => {
          await this.selectPage(activeSession.pageId);

          const toolResult = await this.callChromeTool('evaluate_script', {
            function: `() => {
              const target = document.querySelector(${JSON.stringify(selector)});
              if (!(target instanceof Element)) {
                throw new Error('No element matched selector: ${selector.replaceAll("'", "\\'")}');
              }
              target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, composed: true }));
              if (typeof target.click === 'function') {
                target.click();
              }
              return { url: location.href };
            }`,
          });

          const parsed = parseJsonCodeBlock<{ url?: string }>(
            extractTextContent(toolResult),
          );
          const nextUrl = parsed?.url ?? activeSession.pageUrl;
          this.sessions.set(sessionId, {
            ...activeSession,
            pageUrl: nextUrl,
          });

          return {
            sessionId,
            selector,
            url: nextUrl,
          };
        },
      );
    }

    await session.page.locator(selector).first().click();
    await session.page.waitForLoadState('domcontentloaded').catch(() => {});
    const pageState = await this.capturePlaywrightPageState(session.page);
    this.updateBrowserSession(sessionId, pageState);

    return {
      sessionId,
      selector,
      url: pageState.url,
    };
  }

  async fillBrowserSession(
    sessionId: string,
    selector: string,
    value: string,
    submit = false,
  ): Promise<{ sessionId: string; selector: string; submitted: boolean }> {
    const session = this.getBrowserSession(sessionId);

    if (session.strategy === 'devtools') {
      return await this.runWithRecoveredDevToolsSession(
        sessionId,
        async (activeSession) => {
          await this.selectPage(activeSession.pageId);

          await this.callChromeTool('evaluate_script', {
            function: `() => {
              const target = document.querySelector(${JSON.stringify(selector)});
              if (!(target instanceof HTMLElement)) {
                throw new Error('No element matched selector: ${selector.replaceAll("'", "\\'")}');
              }
              target.focus();
              if ('value' in target) {
                target.value = ${JSON.stringify(value)};
              } else {
                target.textContent = ${JSON.stringify(value)};
              }
              target.dispatchEvent(new Event('input', { bubbles: true }));
              target.dispatchEvent(new Event('change', { bubbles: true }));
              if (${submit ? 'true' : 'false'}) {
                const form = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement
                  ? target.form
                  : target.closest('form');
                form?.requestSubmit?.();
              }
              return { ok: true };
            }`,
          });

          return {
            sessionId,
            selector,
            submitted: submit,
          };
        },
      );
    }

    const locator = session.page.locator(selector).first();
    await locator.fill(value);
    if (submit) {
      await locator.press('Enter');
      await session.page.waitForLoadState('domcontentloaded').catch(() => {});
    }

    return {
      sessionId,
      selector,
      submitted: submit,
    };
  }

  async pressBrowserKey(
    sessionId: string,
    key: string,
  ): Promise<{ sessionId: string; key: string }> {
    const session = this.getBrowserSession(sessionId);

    if (session.strategy === 'devtools') {
      return await this.runWithRecoveredDevToolsSession(
        sessionId,
        async (activeSession) => {
          await this.selectPage(activeSession.pageId);
          await this.callChromeTool('press_key', { key });

          return {
            sessionId,
            key,
          };
        },
      );
    } else {
      await session.page.keyboard.press(key);
      await session.page.waitForLoadState('domcontentloaded').catch(() => {});
    }

    return {
      sessionId,
      key,
    };
  }

  async evaluateBrowserSession(
    sessionId: string,
    expression: string,
  ): Promise<{ sessionId: string; result: unknown }> {
    const session = this.getBrowserSession(sessionId);

    if (session.strategy === 'devtools') {
      return await this.runWithRecoveredDevToolsSession(
        sessionId,
        async (activeSession) => {
          await this.selectPage(activeSession.pageId);

          const toolResult = await this.callChromeTool('evaluate_script', {
            function: `() => ({ result: globalThis.eval(${JSON.stringify(expression)}) })`,
          });
          const parsed = parseJsonCodeBlock<{ result?: unknown }>(
            extractTextContent(toolResult),
          );

          return {
            sessionId,
            result: parsed?.result,
          };
        },
      );
    }

    return {
      sessionId,
      result: await session.page.evaluate(
        (scriptSource) => globalThis.eval(scriptSource),
        expression,
      ),
    };
  }

  async screenshotBrowserSession(options: {
    sessionId: string;
    path?: string;
    fullPage?: boolean;
    type?: 'png' | 'jpeg';
  }): Promise<{ sessionId: string; path: string }> {
    const session = this.getBrowserSession(options.sessionId);
    const targetPath = options.path
      ? this.workspaceFileAccess.resolveWorkspacePath(options.path, true)
      : path.join(
          this.storageRoot,
          `${options.sessionId}-${Date.now()}.${options.type ?? 'png'}`,
        );

    await fs.mkdir(path.dirname(targetPath), { recursive: true });

    if (session.strategy === 'devtools') {
      await this.runWithRecoveredDevToolsSession(
        options.sessionId,
        async (activeSession) => {
          await this.selectPage(activeSession.pageId);
          // Screenshots write to a concrete file path, so replaying them on
          // transport errors can overwrite the caller's target with a later frame.
          await this.callChromeTool('take_screenshot', {
            filePath: targetPath,
            fullPage: options.fullPage ?? true,
            format: options.type ?? 'png',
          });
        },
      );
    } else {
      await session.page.screenshot({
        path: targetPath,
        fullPage: options.fullPage ?? true,
        type: options.type ?? 'png',
      });
    }

    return {
      sessionId: options.sessionId,
      path: targetPath,
    };
  }

  async closeBrowserSession(
    sessionId: string,
  ): Promise<{ sessionId: string; closed: true }> {
    const session = this.getBrowserSession(sessionId);

    if (session.strategy === 'playwright') {
      await session.context.close().catch(() => {});
      await session.browser.close().catch(() => {});
    }

    this.sessions.delete(sessionId);

    return {
      sessionId,
      closed: true,
    };
  }

  listBrowserSessions(): Array<{
    sessionId: string;
    startedAt: string;
    url: string;
    storagePath: string;
    strategy: BrowserSessionStrategy;
  }> {
    return [...this.sessions.values()].map((session) => ({
      sessionId: session.id,
      startedAt: session.startedAt,
      url: session.pageUrl,
      storagePath: session.storagePath,
      strategy: session.strategy,
    }));
  }

  hasAttachedBrowserClient(): boolean {
    return Boolean(this.browserClient || this.browserClientPromise);
  }

  async closeAll(): Promise<void> {
    const activeSessions = [...this.sessions.values()];
    this.sessions.clear();

    await Promise.all(
      activeSessions
        .filter(
          (session): session is PlaywrightBrowserSession =>
            session.strategy === 'playwright',
        )
        .map(async (session) => {
          await session.context.close().catch(() => {});
          await session.browser.close().catch(() => {});
        }),
    );

    const transport = this.browserTransport;
    this.browserClient = undefined;
    this.browserTransport = undefined;
    this.browserClientPromise = undefined;

    if (!transport) {
      return;
    }

    await Promise.race([transport.close(), sleep(1_000)]);
  }

  async attachSelectedPageSession(): Promise<{
    sessionId: string;
    startedAt: string;
    url: string;
    storagePath: string;
    strategy: BrowserSessionStrategy;
  }> {
    return await this.openBrowserSession({ attachSelectedPage: true });
  }

  async selectBrowserPage(
    sessionId: string,
    pageId: number,
  ): Promise<{ sessionId: string; pageId: number; url: string; title: string }> {
    const session = this.getDevToolsSession(sessionId);
    const pages = await this.listPages();
    const selectedPage = pages.find((page) => page.pageId === pageId);

    if (!selectedPage) {
      throw new Error(`unknown Chrome page id: ${String(pageId)}`);
    }

    const pageState = await this.captureDevToolsPageState(pageId);

    this.sessions.set(sessionId, {
      ...session,
      pageId,
      pageTitle: pageState.title,
      pageUrl: pageState.url,
    });

    return {
      sessionId,
      pageId,
      url: pageState.url,
      title: pageState.title,
    };
  }

  async waitForText(options: {
    sessionId: string;
    text: string;
    timeoutMs?: number;
    pollIntervalMs?: number;
  }): Promise<{
    sessionId: string;
    found: boolean;
    url: string;
    title: string;
    waitedMs: number;
  }> {
    const timeoutMs = options.timeoutMs ?? 15_000;
    const pollIntervalMs = options.pollIntervalMs ?? 500;
    const startedAtMs = Date.now();
    const session = this.getBrowserSession(options.sessionId);

    if (session.strategy === 'playwright') {
      const found = await session.page
        .waitForFunction(
          (expectedText) =>
            (document.body?.innerText || '').includes(expectedText),
          options.text,
          { timeout: timeoutMs },
        )
        .then(() => true)
        .catch(() => false);

      const snapshot = await this.snapshotBrowserSession(options.sessionId);
      return {
        sessionId: options.sessionId,
        found,
        url: snapshot.url,
        title: snapshot.title,
        waitedMs: Date.now() - startedAtMs,
      };
    }

    while (true) {
      const snapshot = await this.snapshotBrowserSession(options.sessionId);
      if (snapshot.textPreview.includes(options.text)) {
        return {
          sessionId: options.sessionId,
          found: true,
          url: snapshot.url,
          title: snapshot.title,
          waitedMs: Date.now() - startedAtMs,
        };
      }

      if (Date.now() - startedAtMs >= timeoutMs) {
        return {
          sessionId: options.sessionId,
          found: false,
          url: snapshot.url,
          title: snapshot.title,
          waitedMs: Date.now() - startedAtMs,
        };
      }

      await sleep(pollIntervalMs);
    }
  }

  async openUrlInCurrentChrome(options: {
    url: string;
    attachSelectedPage?: boolean;
    retryCount?: number;
  }): Promise<{
    sessionId: string;
    startedAt: string;
    url: string;
    title: string;
    textPreview: string;
    storagePath: string;
    strategy: BrowserSessionStrategy;
  }> {
    const retryCount = Math.max(0, options.retryCount ?? 1);
    let lastError: unknown;

    for (let attempt = 0; attempt <= retryCount; attempt += 1) {
      let openedSession:
        | Awaited<ReturnType<BrowserSessionRegistry['openBrowserSession']>>
        | undefined;

      try {
        openedSession = await this.openBrowserSession({
          initialUrl: options.url,
          attachSelectedPage: options.attachSelectedPage ?? false,
        });
        const snapshot = await this.snapshotBrowserSession(openedSession.sessionId);

        return {
          ...openedSession,
          url: snapshot.url,
          title: snapshot.title,
          textPreview: snapshot.textPreview,
        };
      } catch (error) {
        lastError = error;

        if (openedSession) {
          await this.closeBrowserSession(openedSession.sessionId).catch(() => {});
        }

        if (!isUnknownBrowserSessionError(error) || attempt >= retryCount) {
          throw error;
        }
      }
    }

    throw lastError instanceof Error
      ? lastError
      : new Error('failed to open URL in current Chrome');
  }

  async searchGoogleInCurrentChrome(options: {
    query: string;
    attachSelectedPage?: boolean;
    retryCount?: number;
  }): Promise<{
    query: string;
    searchUrl: string;
    sessionId: string;
    startedAt: string;
    url: string;
    title: string;
    textPreview: string;
    storagePath: string;
    strategy: BrowserSessionStrategy;
  }> {
    const searchUrl = buildGoogleSearchUrl(options.query);
    const openedSession = await this.openUrlInCurrentChrome({
      url: searchUrl,
      attachSelectedPage: options.attachSelectedPage,
      retryCount: options.retryCount,
    });

    return {
      query: options.query,
      searchUrl,
      ...openedSession,
    };
  }
}
