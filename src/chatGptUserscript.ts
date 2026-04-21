const LOCAL_BRIDGE_CONTEXT_MARKER = '[Local bridge context]';
const FULL_ACCESS_TOOL_RESULTS_MARKER = '[Full Access Tool Results]';

export interface ChatGptUserscriptClientConfig {
  bridgeBaseUrl: string;
  bridgeConfigUrl: string;
  toolLanguage: string;
  toolPrompt: string;
  inlineToolPrompt: string;
  recoveryPrompt: string;
  autoRun: boolean;
  autoSubmitResults: boolean;
  autoBootstrapConversation: boolean;
  autoRecoverRefusals: boolean;
  bridgeLocked?: boolean;
}

export function createChatGptBootstrapPrompt(toolLanguage: string): string {
  return [
    'If local tools are needed, reply with only the following fenced block and no extra prose.',
    'Do not use built-in bash, container, browserless, or Google tools for this conversation.',
    '',
    `\`\`\`${toolLanguage}`,
    '{',
    '  "calls": [',
    '    {',
    '      "toolName": "server_describe",',
    '      "arguments": {}',
    '    }',
    '  ],',
    '  "stopOnError": true',
    '}',
    '```',
    '',
    'When tool results arrive, continue from those results.',
  ].join('\n');
}

export function createChatGptInlineToolPrompt(toolLanguage: string): string {
  return [
    LOCAL_BRIDGE_CONTEXT_MARKER,
    'A localhost Full Access Bridge is available in this conversation.',
    'If local files, folders, terminal commands, browser automation, desktop UI, apps, or screen access are relevant, do not describe a plan first.',
    'Do not use built-in bash, container, browserless, or Google tools for this conversation.',
    'Reply with only the following fenced block and no extra prose.',
    '',
    `\`\`\`${toolLanguage}`,
    '{',
    '  "calls": [',
    '    {',
    '      "toolName": "server_describe",',
    '      "arguments": {}',
    '    }',
    '  ],',
    '  "stopOnError": true',
    '}',
    '```',
    '',
    'When tool results arrive, continue from those results.',
  ].join('\n');
}

export function createChatGptRecoveryPrompt(toolLanguage: string): string {
  return [
    'Use the local Full Access Bridge for this conversation.',
    'Do not reply with generic statements about lacking access to the computer, files, apps, browser, or screen.',
    'Do not describe a plan like "I will first inspect the project" when local tools are relevant.',
    'Do not use built-in bash, container, browserless, or Google tools for this conversation.',
    `If local tools are needed, reply with only a \`\`\`${toolLanguage} fenced block.`,
    'Start by using server_describe when you need to confirm the available local tools.',
    'Then continue from the returned tool results.',
  ].join('\n');
}

function serializeForJavaScript(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

export function createChatGptUserscript(
  clientConfig: ChatGptUserscriptClientConfig,
): string {
  const serializedClientConfig = serializeForJavaScript(clientConfig);

  return `// ==UserScript==
// @name         ChatGPT Full Access Bridge
// @namespace    local.full.access.bridge
// @version      0.5.2
// @description  Connect chatgpt.com to a localhost full-access tool bridge.
// @match        https://chatgpt.com/*
// @grant        GM_xmlhttpRequest
// @connect      127.0.0.1
// @connect      localhost
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  const staticClientConfig = ${serializedClientConfig};
  const settingsStorageKey = 'full-access-userscript-settings';
  const localBridgeContextMarker = ${JSON.stringify(LOCAL_BRIDGE_CONTEXT_MARKER)};
  const toolResultsMarker = ${JSON.stringify(FULL_ACCESS_TOOL_RESULTS_MARKER)};
  const capabilityRefusalPattern =
    /i can't directly control|i can'?t directly access|i can'?t access files|i can'?t access apps|i can'?t access .*screen|unless .* grant permission|lack direct access|do not have direct access/i;
  const planningWithoutToolsPattern =
    /i(?:\\s+will|'ll)\\s+first|let me first|after\\s+(?:checking|inspecting)|currently\\s+(?:checking|looking)|i'?m going to first|here'?s\\s+the\\s+plan|package\\.json|readme|\\uD604\\uC7AC\\s+\\uC791\\uC5C5\\s+\\uC704\\uCE58|\\uD655\\uC778\\uD55C\\s+\\uB4A4|\\uC77D\\uACE0\\s+.*\\s+\\uC815\\uB9AC\\uD558\\uACA0\\uC2B5\\uB2C8\\uB2E4|\\uCC3E\\uACE0\\s+\\uC788\\uC2B5\\uB2C8\\uB2E4/i;
  const builtInToolsPattern =
    /pro thinking|quick answer|bash -lc|command -v server_describe|which server_describe|find \\/ -maxdepth|path=\\/opt\\/apply_patch\\/bin|server_describe is not installed|container tools|gmail and calendar|google services|assessing available tools|checking for available local tools|executing server description command/i;
  const likelyLocalToolsPattern =
    /file|files|folder|folders|directory|directories|workspace|package\\.json|readme|terminal|command|shell|run|npm|pnpm|yarn|test|build|browser|chrome|window|windows|screen|desktop|app|application|open|click|type|edit|write|read|search|list|git|repo|repository|\\uD30C\\uC77C|\\uD3F4\\uB354|\\uB514\\uB809\\uD130\\uB9AC|\\uC6CC\\uD06C\\uC2A4\\uD398\\uC774\\uC2A4|\\uD130\\uBBF8\\uB110|\\uBA85\\uB839|\\uC2E4\\uD589|\\uBE0C\\uB77C\\uC6B0\\uC800|\\uD06C\\uB86C|\\uCC3D|\\uD654\\uBA74|\\uB370\\uC2A4\\uD06C\\uD1B1|\\uC571|\\uC5F4\\uC5B4|\\uD074\\uB9AD|\\uC218\\uC815|\\uC4F0\\uAE30|\\uC77D\\uAE30|\\uAC80\\uC0C9|\\uBAA9\\uB85D/i;
  const processedToolPlans = new Set();
  const processedCapabilityRefusals = new Set();
  const processedPlanningReplies = new Set();
  const processedBuiltInToolReplies = new Set();
  let overlayRoot = null;
  let overlayStatus = null;
  let awaitingToolReply = false;
  let autoBootstrapInFlight = false;
  let toolPlanExecutionInFlight = false;
  let latestEffectiveSettings = {
    bridgeBaseUrl: staticClientConfig.bridgeBaseUrl,
    bridgeToken: '',
    toolLanguage: staticClientConfig.toolLanguage,
    toolPrompt: staticClientConfig.toolPrompt,
    inlineToolPrompt: staticClientConfig.inlineToolPrompt,
    recoveryPrompt: staticClientConfig.recoveryPrompt,
    autoRun: staticClientConfig.autoRun,
    autoSubmitResults: staticClientConfig.autoSubmitResults,
    autoBootstrapConversation: staticClientConfig.autoBootstrapConversation,
    autoRecoverRefusals: staticClientConfig.autoRecoverRefusals,
    bridgeLocked: Boolean(staticClientConfig.bridgeLocked),
  };

  function setOverlayStatus(text) {
    if (overlayStatus) {
      overlayStatus.textContent = text;
    }
  }

  function hashText(text) {
    let hash = 0;
    for (let index = 0; index < text.length; index += 1) {
      hash = (hash * 31 + text.charCodeAt(index)) >>> 0;
    }
    return String(hash);
  }

  function normalizeBridgeBaseUrl(rawValue) {
    const normalizedValue = String(rawValue || staticClientConfig.bridgeBaseUrl).trim();
    const parsedUrl = new URL(normalizedValue);
    const hostname = parsedUrl.hostname.toLowerCase();

    if (!['127.0.0.1', 'localhost', '::1'].includes(hostname)) {
      throw new Error('Bridge URL must point to localhost.');
    }

    parsedUrl.pathname = '';
    parsedUrl.search = '';
    parsedUrl.hash = '';
    return parsedUrl.toString().replace(/\\/$/, '');
  }

  function readStoredSettings() {
    try {
      const rawValue = window.localStorage.getItem(settingsStorageKey);
      if (!rawValue) {
        return {};
      }

      const parsedValue = JSON.parse(rawValue);
      return typeof parsedValue === 'object' && parsedValue ? parsedValue : {};
    } catch (error) {
      console.warn('full-access userscript settings parse failed', error);
      return {};
    }
  }

  function writeStoredSettings(settings) {
    window.localStorage.setItem(settingsStorageKey, JSON.stringify(settings));
  }

  function requestJson(url, options) {
    const requestOptions = options || {};

    if (typeof GM_xmlhttpRequest === 'function') {
      return new Promise((resolve, reject) => {
        GM_xmlhttpRequest({
          method: requestOptions.method || 'GET',
          url,
          headers: requestOptions.headers || {},
          data: requestOptions.body,
          onload: (response) => {
            try {
              const payload = response.responseText
                ? JSON.parse(response.responseText)
                : {};

              if (response.status < 200 || response.status >= 300) {
                reject(
                  new Error(
                    payload && payload.error
                      ? payload.error
                      : 'Request failed with status ' + String(response.status),
                  ),
                );
                return;
              }

              resolve(payload);
            } catch (error) {
              reject(error);
            }
          },
          onerror: () => reject(new Error('GM_xmlhttpRequest failed.')),
        });
      });
    }

    return fetch(url, {
      method: requestOptions.method || 'GET',
      headers: requestOptions.headers || {},
      body: requestOptions.body,
    }).then(async (response) => {
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload && payload.error ? payload.error : 'Request failed.');
      }
      return payload;
    });
  }

  async function loadEffectiveSettings() {
    const storedSettings = readStoredSettings();
    const bridgeBaseUrl = normalizeBridgeBaseUrl(
      storedSettings.bridgeBaseUrl || staticClientConfig.bridgeBaseUrl,
    );
    const remoteConfig = await requestJson(staticClientConfig.bridgeConfigUrl, {
      headers: {
        'X-Full-Access-Client': 'tampermonkey-userscript',
      },
    });

    latestEffectiveSettings = {
      bridgeBaseUrl: normalizeBridgeBaseUrl(
        remoteConfig.bridgeBaseUrl || bridgeBaseUrl,
      ),
      bridgeToken: String(remoteConfig.bridgeToken || storedSettings.bridgeToken || ''),
      toolLanguage: String(
        remoteConfig.toolLanguage || storedSettings.toolLanguage || staticClientConfig.toolLanguage,
      ),
      toolPrompt: String(
        remoteConfig.toolPrompt || storedSettings.toolPrompt || staticClientConfig.toolPrompt,
      ),
      inlineToolPrompt: String(
        remoteConfig.inlineToolPrompt ||
          storedSettings.inlineToolPrompt ||
          staticClientConfig.inlineToolPrompt,
      ),
      recoveryPrompt: String(
        remoteConfig.recoveryPrompt || storedSettings.recoveryPrompt || staticClientConfig.recoveryPrompt,
      ),
      autoRun:
        typeof storedSettings.autoRun === 'boolean'
          ? storedSettings.autoRun
          : Boolean(remoteConfig.autoRun ?? staticClientConfig.autoRun),
      autoSubmitResults:
        typeof storedSettings.autoSubmitResults === 'boolean'
          ? storedSettings.autoSubmitResults
          : Boolean(remoteConfig.autoSubmitResults ?? staticClientConfig.autoSubmitResults),
      autoBootstrapConversation: Boolean(
        remoteConfig.autoBootstrapConversation ?? staticClientConfig.autoBootstrapConversation,
      ),
      autoRecoverRefusals:
        typeof storedSettings.autoRecoverRefusals === 'boolean'
          ? storedSettings.autoRecoverRefusals
          : Boolean(
              remoteConfig.autoRecoverRefusals ?? staticClientConfig.autoRecoverRefusals,
            ),
      bridgeLocked:
        typeof remoteConfig.bridgeLocked === 'boolean'
          ? remoteConfig.bridgeLocked
          : Boolean(storedSettings.bridgeLocked ?? staticClientConfig.bridgeLocked),
    };

    writeStoredSettings(latestEffectiveSettings);
    return latestEffectiveSettings;
  }

  async function bridgeFetch(pathname, options) {
    const requestOptions = options || {};
    const headers = Object.assign(
      {
        'Content-Type': 'application/json',
        'X-Full-Access-Client': 'tampermonkey-userscript',
      },
      requestOptions.headers || {},
    );

    if (latestEffectiveSettings.bridgeToken) {
      headers.Authorization = 'Bearer ' + latestEffectiveSettings.bridgeToken;
    }

    return await requestJson(
      latestEffectiveSettings.bridgeBaseUrl + pathname,
      {
        method: requestOptions.method || 'GET',
        headers,
        body: requestOptions.body,
      },
    );
  }

  function getAssistantMessages() {
    return Array.from(document.querySelectorAll('[data-message-author-role="assistant"]'));
  }

  function getUserMessages() {
    return Array.from(document.querySelectorAll('[data-message-author-role="user"]'));
  }

  function getAllConversationMessages() {
    return Array.from(
      document.querySelectorAll(
        '[data-message-author-role="assistant"], [data-message-author-role="user"]',
      ),
    );
  }

  function findComposerElement() {
    return (
      document.querySelector('#prompt-textarea') ||
      document.querySelector('textarea') ||
      document.querySelector('div[contenteditable="true"][id*="prompt"]') ||
      document.querySelector('div[contenteditable="true"]')
    );
  }

  function getComposerText(composer) {
    if (composer instanceof HTMLTextAreaElement || composer instanceof HTMLInputElement) {
      return composer.value || '';
    }

    if (composer && composer.isContentEditable) {
      return composer.textContent || '';
    }

    return '';
  }

  function setComposerText(text) {
    const composer = findComposerElement();
    if (!composer) {
      throw new Error('ChatGPT composer not found.');
    }

    composer.focus();

    if (composer instanceof HTMLTextAreaElement || composer instanceof HTMLInputElement) {
      composer.value = text;
      composer.dispatchEvent(new Event('input', { bubbles: true }));
      composer.dispatchEvent(new Event('change', { bubbles: true }));
      return;
    }

    if (composer.isContentEditable) {
      composer.textContent = '';
      composer.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, data: text }));
      document.execCommand('insertText', false, text);

      if ((composer.textContent || '').trim() !== text.trim()) {
        composer.textContent = text;
        composer.dispatchEvent(new Event('input', { bubbles: true }));
      }
      return;
    }

    throw new Error('Unsupported ChatGPT composer element.');
  }

  function isSendButtonElement(element) {
    if (!(element instanceof HTMLButtonElement)) {
      return false;
    }

    const label = [
      element.getAttribute('aria-label') || '',
      element.getAttribute('data-testid') || '',
      element.textContent || '',
    ].join(' ');

    return /send|submit|prompt|message/i.test(label);
  }

  function clickSendButton() {
    const button = Array.from(document.querySelectorAll('button')).find((candidate) =>
      isSendButtonElement(candidate),
    );

    if (!button) {
      throw new Error('Send button not found.');
    }

    button.click();
  }

  function messageIncludesBridgePayload(messageText) {
    return (
      messageText.includes(localBridgeContextMarker) ||
      messageText.includes(toolResultsMarker) ||
      messageText.includes(latestEffectiveSettings.toolLanguage) ||
      messageText.includes('Use the local Full Access Bridge for this conversation.')
    );
  }

  function conversationHasToolContext() {
    return getAllConversationMessages().some((messageElement) =>
      messageIncludesBridgePayload(messageElement.textContent || ''),
    );
  }

  function requestLikelyNeedsLocalTools(requestText) {
    return likelyLocalToolsPattern.test(requestText);
  }

  function sanitizeVisibleUserMessages() {
    for (const messageElement of getUserMessages()) {
      const messageText = messageElement.textContent || '';
      const markerIndex = messageText.indexOf(localBridgeContextMarker);

      if (markerIndex < 0) {
        continue;
      }

      const visibleText = messageText.slice(0, markerIndex).trimEnd();
      const targetNode =
        Array.from(messageElement.querySelectorAll('p, div')).find((candidate) =>
          (candidate.textContent || '').includes(localBridgeContextMarker),
        ) || messageElement;

      if ((targetNode.textContent || '') !== visibleText) {
        targetNode.textContent = visibleText;
      }
    }
  }

  function findLatestCapabilityRefusal() {
    const assistantMessages = getAssistantMessages().reverse();

    for (const messageElement of assistantMessages) {
      const messageText = (messageElement.textContent || '').trim();
      if (!messageText) {
        continue;
      }

      const refusalHash = hashText(messageText);
      if (processedCapabilityRefusals.has(refusalHash)) {
        continue;
      }

      if (!capabilityRefusalPattern.test(messageText)) {
        continue;
      }

      return {
        refusalHash,
        messageText,
      };
    }

    return null;
  }

  function findLatestPlanningReplyWithoutTools() {
    const assistantMessages = getAssistantMessages().reverse();

    for (const messageElement of assistantMessages) {
      const messageText = (messageElement.textContent || '').trim();
      if (!messageText) {
        continue;
      }

      const planningHash = hashText(messageText);
      if (processedPlanningReplies.has(planningHash)) {
        continue;
      }

      if (messageIncludesBridgePayload(messageText)) {
        continue;
      }

      if (!planningWithoutToolsPattern.test(messageText)) {
        continue;
      }

      return {
        planningHash,
        messageText,
      };
    }

    return null;
  }

  function findLatestBuiltInToolReply() {
    const assistantMessages = getAssistantMessages().reverse();

    for (const messageElement of assistantMessages) {
      const messageText = (messageElement.textContent || '').trim();
      if (!messageText) {
        continue;
      }

      const builtInToolHash = hashText(messageText);
      if (processedBuiltInToolReplies.has(builtInToolHash)) {
        continue;
      }

      if (messageIncludesBridgePayload(messageText)) {
        continue;
      }

      if (!builtInToolsPattern.test(messageText)) {
        continue;
      }

      return {
        builtInToolHash,
        messageText,
      };
    }

    return null;
  }

  function parseToolPlanJson(rawText) {
    const trimmedText = String(rawText || '').trim();
    if (!trimmedText) {
      return null;
    }

    try {
      const parsedValue = JSON.parse(trimmedText);
      if (parsedValue && Array.isArray(parsedValue.calls)) {
        return parsedValue;
      }
    } catch (error) {
      // Ignore JSON parse failures here and keep trying fallbacks.
    }

    return null;
  }

  function parseToolPlanFromMessage(messageElement) {
    const codeBlocks = Array.from(messageElement.querySelectorAll('pre code'));

    for (const codeBlock of codeBlocks) {
      const className = codeBlock.className || '';
      const dataLanguage = codeBlock.getAttribute('data-language') || '';
      const rawText = codeBlock.textContent || '';
      const matchesLanguage =
        className.includes('language-' + latestEffectiveSettings.toolLanguage) ||
        dataLanguage === latestEffectiveSettings.toolLanguage;
      const parsedPlan = parseToolPlanJson(rawText);

      if (!matchesLanguage && !parsedPlan) {
        continue;
      }

      const planHash = hashText(rawText);

      if (processedToolPlans.has(planHash)) {
        continue;
      }

      if (!parsedPlan) {
        throw new Error('Tool plan JSON is missing a calls array.');
      }

      return {
        planHash,
        toolPlan: parsedPlan,
      };
    }

    const rawMessageText = (messageElement.textContent || '').trim();
    const objectStartIndex = rawMessageText.indexOf('{');
    const objectEndIndex = rawMessageText.lastIndexOf('}');

    if (objectStartIndex >= 0 && objectEndIndex > objectStartIndex) {
      const rawCandidate = rawMessageText.slice(objectStartIndex, objectEndIndex + 1);
      const parsedPlan = parseToolPlanJson(rawCandidate);

      if (parsedPlan) {
        const planHash = hashText(rawCandidate);
        if (!processedToolPlans.has(planHash)) {
          return {
            planHash,
            toolPlan: parsedPlan,
          };
        }
      }
    }

    return null;
  }

  async function executeToolPlan(toolPlan, planHash) {
    setOverlayStatus('Running local tools...');
    awaitingToolReply = false;

    const payload = await bridgeFetch('/bridge/batch', {
      method: 'POST',
      body: JSON.stringify({
        calls: toolPlan.calls,
        stopOnError: toolPlan.stopOnError ?? false,
      }),
    });

    if (!payload || !Array.isArray(payload.results)) {
      processedToolPlans.delete(planHash);
      throw new Error('Tool execution returned an invalid payload.');
    }

    const resultBlock = [
      toolResultsMarker,
      '\`\`\`json',
      JSON.stringify(payload, null, 2),
      '\`\`\`',
      'Continue from these results.',
    ].join('\\n');

    setComposerText(resultBlock);

    if (latestEffectiveSettings.autoSubmitResults) {
      clickSendButton();
    }

    setOverlayStatus('Local tools completed.');
  }

  async function insertBootstrapIntoComposer(force) {
    await loadEffectiveSettings();

    if (!force) {
      return;
    }

    if (!findComposerElement()) {
      return;
    }

    setComposerText(latestEffectiveSettings.toolPrompt);
    awaitingToolReply = true;
    setOverlayStatus('Bootstrap prompt inserted.');
  }

  async function sendRecoveryPrompt(statusText) {
    setOverlayStatus(statusText);
    setComposerText(latestEffectiveSettings.recoveryPrompt);
    awaitingToolReply = true;
    clickSendButton();
    setOverlayStatus('Recovery prompt sent.');
  }

  async function recoverFromCapabilityRefusal(force) {
    await loadEffectiveSettings();

    if (!latestEffectiveSettings.autoRecoverRefusals && !force) {
      return;
    }

    const refusal = findLatestCapabilityRefusal();
    if (!refusal) {
      return;
    }

    processedCapabilityRefusals.add(refusal.refusalHash);
    await sendRecoveryPrompt('Recovering local tool access...');
  }

  async function recoverFromPlanningReplyWithoutTools(force) {
    await loadEffectiveSettings();

    if (!awaitingToolReply && !force) {
      return;
    }

    const planningReply = findLatestPlanningReplyWithoutTools();
    if (!planningReply) {
      return;
    }

    processedPlanningReplies.add(planningReply.planningHash);
    await sendRecoveryPrompt('Correcting planning-only reply...');
  }

  async function recoverFromBuiltInToolReply(force) {
    await loadEffectiveSettings();

    if (!awaitingToolReply && !force) {
      return;
    }

    const builtInToolReply = findLatestBuiltInToolReply();
    if (!builtInToolReply) {
      return;
    }

    processedBuiltInToolReplies.add(builtInToolReply.builtInToolHash);
    await sendRecoveryPrompt('Redirecting from built-in tools...');
  }

  async function maybeBootstrapConversation() {
    await loadEffectiveSettings();

    if (!latestEffectiveSettings.autoBootstrapConversation) {
      return;
    }

    if (awaitingToolReply || autoBootstrapInFlight) {
      return;
    }

    if (conversationHasToolContext()) {
      return;
    }

    if (getAllConversationMessages().length > 0) {
      autoBootstrapInFlight = false;
      return;
    }

    if (!findComposerElement()) {
      return;
    }

    autoBootstrapInFlight = true;
    setComposerText(latestEffectiveSettings.toolPrompt);
    awaitingToolReply = true;
    clickSendButton();
    setOverlayStatus('Bootstrap prompt sent.');
  }

  async function processLatestToolPlan(force) {
    if (toolPlanExecutionInFlight) {
      return;
    }

    toolPlanExecutionInFlight = true;

    try {
    await loadEffectiveSettings();

      if (!force && !latestEffectiveSettings.autoRun) {
        return;
      }

      const assistantMessages = getAssistantMessages().reverse();
      for (const messageElement of assistantMessages) {
        try {
          const parsedPlan = parseToolPlanFromMessage(messageElement);
          if (!parsedPlan) {
            continue;
          }

          processedToolPlans.add(parsedPlan.planHash);
          await executeToolPlan(parsedPlan.toolPlan, parsedPlan.planHash);
          return;
        } catch (error) {
          setOverlayStatus(error instanceof Error ? error.message : String(error));
          return;
        }
      }

      await recoverFromBuiltInToolReply(force);
      await recoverFromCapabilityRefusal(force);
      await recoverFromPlanningReplyWithoutTools(force);
    } finally {
      toolPlanExecutionInFlight = false;
    }
  }

  function startAutomaticPlanExecutionPulse() {
    window.setInterval(() => {
      sanitizeVisibleUserMessages();
      void processLatestToolPlan(false);
      void maybeBootstrapConversation();
    }, 1500);
  }

  async function setBridgeLock(locked) {
    await loadEffectiveSettings();
    setOverlayStatus(locked ? 'Locking bridge...' : 'Unlocking bridge...');
    const pathname = locked ? '/bridge/security/lock' : '/bridge/security/unlock';
    const payload = await bridgeFetch(pathname, {
      method: 'POST',
      body: '{}',
    });
    latestEffectiveSettings.bridgeLocked = Boolean(payload && payload.locked);
    const storedSettings = readStoredSettings();
    storedSettings.bridgeLocked = latestEffectiveSettings.bridgeLocked;
    writeStoredSettings(storedSettings);
    setOverlayStatus(latestEffectiveSettings.bridgeLocked ? 'Bridge locked.' : 'Bridge unlocked.');
  }

  function maybeInjectInlineBootstrapIntoComposer() {
    const composer = findComposerElement();
    if (!composer) {
      return;
    }

    const currentText = getComposerText(composer).trim();
    if (!currentText) {
      return;
    }

    if (messageIncludesBridgePayload(currentText)) {
      return;
    }

    const likelyNeedsLocalTools = requestLikelyNeedsLocalTools(currentText);
    awaitingToolReply = likelyNeedsLocalTools;

    if (!likelyNeedsLocalTools) {
      return;
    }

    if (conversationHasToolContext()) {
      setOverlayStatus('Awaiting local tool reply...');
      return;
    }

    const nextText = currentText + '\\n\\n' + latestEffectiveSettings.inlineToolPrompt;
    setComposerText(nextText);
    setOverlayStatus('Attached local bridge context to outgoing request.');
  }

  function createButton(label, background, onClick) {
    const button = document.createElement('button');
    button.textContent = label;
    button.style.border = '0';
    button.style.borderRadius = '10px';
    button.style.padding = '8px 10px';
    button.style.background = background;
    button.style.color = background === '#d6cdc1' ? '#191919' : '#ffffff';
    button.style.cursor = 'pointer';
    button.addEventListener('click', () => {
      void onClick();
    });
    return button;
  }

  function createOverlay() {
    if (overlayRoot) {
      return;
    }

    overlayRoot = document.createElement('div');
    overlayRoot.style.position = 'fixed';
    overlayRoot.style.right = '18px';
    overlayRoot.style.bottom = '18px';
    overlayRoot.style.zIndex = '999999';
    overlayRoot.style.width = '280px';
    overlayRoot.style.padding = '12px';
    overlayRoot.style.borderRadius = '16px';
    overlayRoot.style.background = 'rgba(247, 242, 233, 0.96)';
    overlayRoot.style.boxShadow = '0 10px 30px rgba(0, 0, 0, 0.14)';
    overlayRoot.style.backdropFilter = 'blur(8px)';
    overlayRoot.style.fontFamily = '"Segoe UI", sans-serif';
    overlayRoot.style.color = '#191919';

    const title = document.createElement('div');
    title.textContent = 'Full Access Bridge';
    title.style.fontWeight = '700';
    title.style.marginBottom = '8px';
    overlayRoot.appendChild(title);

    overlayStatus = document.createElement('div');
    overlayStatus.textContent = 'Initializing...';
    overlayStatus.style.fontSize = '12px';
    overlayStatus.style.lineHeight = '1.4';
    overlayStatus.style.marginBottom = '10px';
    overlayRoot.appendChild(overlayStatus);

    const buttonRow = document.createElement('div');
    buttonRow.style.display = 'flex';
    buttonRow.style.gap = '8px';
    buttonRow.style.flexWrap = 'wrap';

    buttonRow.appendChild(
      createButton('Run latest plan', '#1e5f53', async () => {
        await processLatestToolPlan(true);
      }),
    );

    buttonRow.appendChild(
      createButton('Insert bootstrap', '#d6cdc1', async () => {
        await insertBootstrapIntoComposer(true);
      }),
    );

    buttonRow.appendChild(
      createButton('Toggle auto-run', '#8b6f47', async () => {
        const storedSettings = readStoredSettings();
        const nextValue = !Boolean(
          typeof storedSettings.autoRun === 'boolean'
            ? storedSettings.autoRun
            : latestEffectiveSettings.autoRun,
        );
        storedSettings.autoRun = nextValue;
        writeStoredSettings(storedSettings);
        latestEffectiveSettings.autoRun = nextValue;
        setOverlayStatus('Auto-run ' + (nextValue ? 'enabled.' : 'disabled.'));
      }),
    );

    buttonRow.appendChild(
      createButton('Recover access', '#6c7f93', async () => {
        await recoverFromCapabilityRefusal(true);
      }),
    );

    buttonRow.appendChild(
      createButton('Lock bridge', '#a44d3f', async () => {
        await setBridgeLock(!latestEffectiveSettings.bridgeLocked);
      }),
    );

    overlayRoot.appendChild(buttonRow);
    document.body.appendChild(overlayRoot);
  }

  function startSendInterceptors() {
    document.addEventListener(
      'click',
      (event) => {
        const target =
          event.target instanceof Element ? event.target.closest('button') : null;

        if (target && isSendButtonElement(target)) {
          maybeInjectInlineBootstrapIntoComposer();
        }
      },
      true,
    );

    document.addEventListener(
      'keydown',
      (event) => {
        if (
          event.key !== 'Enter' ||
          event.shiftKey ||
          event.altKey ||
          event.ctrlKey ||
          event.metaKey ||
          event.isComposing
        ) {
          return;
        }

        const composer = findComposerElement();
        if (!composer) {
          return;
        }

        const activeElement = document.activeElement;
        if (
          activeElement !== composer &&
          !(activeElement instanceof Element && composer.contains(activeElement))
        ) {
          return;
        }

        maybeInjectInlineBootstrapIntoComposer();
      },
      true,
    );
  }

  function startObserver() {
    const observer = new MutationObserver(() => {
      sanitizeVisibleUserMessages();
      void processLatestToolPlan(false);
      void maybeBootstrapConversation();
    });

    observer.observe(document.documentElement, {
      subtree: true,
      childList: true,
      characterData: true,
    });
  }

  createOverlay();
  startSendInterceptors();
  startObserver();
  startAutomaticPlanExecutionPulse();
  void loadEffectiveSettings()
    .then(() => {
      setOverlayStatus('Bridge ready.');
      sanitizeVisibleUserMessages();
      return Promise.all([
        processLatestToolPlan(false),
        maybeBootstrapConversation(),
      ]);
    })
    .catch((error) => {
      setOverlayStatus(error instanceof Error ? error.message : String(error));
    });
})();
`;
}
