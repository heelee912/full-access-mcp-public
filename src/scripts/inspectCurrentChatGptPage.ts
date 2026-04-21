import fs from 'node:fs/promises';
import path from 'node:path';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js';

import { loadFullAccessServerSettings } from '../settings.js';
import { loadRemoteGatewaySettings } from '../remoteGatewaySettings.js';

function extractStructuredContent(
  result: Awaited<ReturnType<Client['request']>>,
): Record<string, unknown> {
  if (
    result &&
    typeof result === 'object' &&
    'structuredContent' in result &&
    result.structuredContent &&
    typeof result.structuredContent === 'object'
  ) {
    return result.structuredContent as Record<string, unknown>;
  }

  return {};
}

async function callTool(
  client: Client,
  name: string,
  argumentsValue: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const result = await client.request(
    {
      method: 'tools/call',
      params: {
        name,
        arguments: argumentsValue,
      },
    },
    CallToolResultSchema,
  );

  return extractStructuredContent(result);
}

async function main(): Promise<void> {
  const gatewaySettings = loadRemoteGatewaySettings();
  const fullAccessSettings = loadFullAccessServerSettings();
  const gatewayUrl = new URL(
    `http://${gatewaySettings.host}:${String(gatewaySettings.port)}/mcp`,
  );
  const transport = new StreamableHTTPClientTransport(gatewayUrl);
  const client = new Client(
    {
      name: 'chatgpt-page-inspector',
      version: '0.1.0',
    },
    {
      capabilities: {},
    },
  );

  await client.connect(transport);

  try {
    const attached = await callTool(client, 'browser_attach_selected_page', {});
    const sessionId = String(attached.sessionId ?? '');

    if (!sessionId) {
      throw new Error('browser_attach_selected_page did not return a sessionId');
    }

    const snapshot = await callTool(client, 'browser_snapshot', { sessionId });
    const evaluated = await callTool(client, 'browser_evaluate', {
      sessionId,
      expression: `(() => {
        const normalized = (value) =>
          String(value || '').trim().replace(/\\s+/g, ' ');
        const interactiveEntries = [...document.querySelectorAll('a,button,[role="button"],textarea,input,[contenteditable="true"]')];
        const interestingEntries = interactiveEntries
          .map((element, index) => ({
            index,
            tag: element.tagName,
            text: normalized(element.innerText || element.textContent),
            aria: normalized(element.getAttribute('aria-label')),
            title: normalized(element.getAttribute('title')),
            testid: normalized(element.getAttribute('data-testid')),
            id: normalized(element.id),
            placeholder: normalized(element.getAttribute('placeholder')),
            role: normalized(element.getAttribute('role')),
            contenteditable: normalized(element.getAttribute('contenteditable')),
          }))
          .filter((entry) => {
            const blob = [entry.text, entry.aria, entry.title, entry.testid, entry.id, entry.placeholder].join(' ');
            return /Full Access MCP|Apps|Developer mode|prompt|send|new chat|chat|connect/i.test(blob);
          })
          .slice(0, 160);

        const composerCandidates = [...document.querySelectorAll('textarea,input,[contenteditable="true"]')]
          .map((element, index) => ({
            index,
            tag: element.tagName,
            id: normalized(element.id),
            testid: normalized(element.getAttribute('data-testid')),
            aria: normalized(element.getAttribute('aria-label')),
            placeholder: normalized(element.getAttribute('placeholder')),
            role: normalized(element.getAttribute('role')),
            contenteditable: normalized(element.getAttribute('contenteditable')),
            selectorHint: element.id
              ? '#' + element.id
              : element.getAttribute('data-testid')
                ? '[' + 'data-testid="' + element.getAttribute('data-testid') + '"' + ']'
                : element.getAttribute('aria-label')
                  ? element.tagName.toLowerCase() + '[aria-label="' + element.getAttribute('aria-label') + '"]'
                  : element.tagName.toLowerCase(),
          }))
          .slice(0, 60);

        return {
          url: location.href,
          title: document.title,
          hasDeveloperMode: /developer mode/i.test(document.body?.innerText || ''),
          hasFullAccessText: /full access mcp/i.test(document.body?.innerText || ''),
          interestingEntries,
          composerCandidates,
        };
      })()`,
    });

    const output = {
      attached,
      snapshot,
      evaluated,
    };
    const outputPath = path.join(
      fullAccessSettings.browserStorageRoot,
      '..',
      'logs',
      'chatgpt-page-inspection-v2.json',
    );
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.writeFile(outputPath, JSON.stringify(output, null, 2), 'utf8');
    console.log(outputPath);
    console.log(JSON.stringify(output, null, 2));
  } finally {
    await transport.close().catch(() => {});
    await client.close().catch(() => {});
  }
}

await main();
