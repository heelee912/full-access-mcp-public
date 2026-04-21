import fs from 'node:fs/promises';
import path from 'node:path';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {
  CallToolResultSchema,
  GetPromptResultSchema,
  ListPromptsResultSchema,
  ListResourcesResultSchema,
  ListToolsResultSchema,
  ReadResourceResultSchema,
} from '@modelcontextprotocol/sdk/types.js';

import { loadRemoteGatewaySettings } from '../remoteGatewaySettings.js';

type GatewayCommand =
  | 'list-tools'
  | 'list-prompts'
  | 'list-resources'
  | 'call-tool'
  | 'get-prompt'
  | 'read-resource';

async function loadJsonArgument(rawValue: string | undefined): Promise<unknown> {
  if (!rawValue || rawValue.trim() === '') {
    return {};
  }

  if (rawValue.startsWith('@')) {
    const filePath = path.resolve(process.cwd(), rawValue.slice(1));
    const fileContents = await fs.readFile(filePath, 'utf8');
    return JSON.parse(fileContents);
  }

  return JSON.parse(rawValue);
}

function printUsage(): void {
  console.log(
    [
      'Usage:',
      '  npm run gateway:cli -- [--path /mcp|/mcp-readonly] list-tools',
      '  npm run gateway:cli -- [--path /mcp|/mcp-readonly] list-prompts',
      '  npm run gateway:cli -- [--path /mcp|/mcp-readonly] list-resources',
      '  npm run gateway:cli -- [--path /mcp|/mcp-readonly] call-tool <toolName> [jsonArgsOr@file]',
      '  npm run gateway:cli -- [--path /mcp|/mcp-readonly] get-prompt <promptName> [jsonArgsOr@file]',
      '  npm run gateway:cli -- [--path /mcp|/mcp-readonly] read-resource <uri>',
    ].join('\n'),
  );
}

async function main(): Promise<void> {
  const rawArguments = process.argv.slice(2);
  let gatewayPath = process.env.GATEWAY_MCP_PATH?.trim() || '/mcp';

  if (rawArguments[0] === '--path') {
    const providedPath = rawArguments[1];
    if (!providedPath) {
      throw new Error('gateway path is required after --path');
    }

    gatewayPath = providedPath;
    rawArguments.splice(0, 2);
  }

  const command = rawArguments[0] as GatewayCommand | undefined;

  if (!command) {
    printUsage();
    process.exitCode = 1;
    return;
  }

  const settings = loadRemoteGatewaySettings();
  const normalizedGatewayPath = gatewayPath.startsWith('/')
    ? gatewayPath
    : `/${gatewayPath}`;
  const gatewayUrl = new URL(
    `http://${settings.host}:${String(settings.port)}${normalizedGatewayPath}`,
  );
  const transport = new StreamableHTTPClientTransport(gatewayUrl);
  const client = new Client(
    {
      name: 'gateway-cli',
      version: '0.1.0',
    },
    {
      capabilities: {},
    },
  );

  await client.connect(transport);

  try {
    switch (command) {
      case 'list-tools': {
        const result = await client.request(
          { method: 'tools/list', params: {} },
          ListToolsResultSchema,
        );
        console.log(JSON.stringify(result, null, 2));
        return;
      }
      case 'list-prompts': {
        const result = await client.request(
          { method: 'prompts/list', params: {} },
          ListPromptsResultSchema,
        );
        console.log(JSON.stringify(result, null, 2));
        return;
      }
      case 'list-resources': {
        const result = await client.request(
          { method: 'resources/list', params: {} },
          ListResourcesResultSchema,
        );
        console.log(JSON.stringify(result, null, 2));
        return;
      }
      case 'call-tool': {
        const toolName = rawArguments[1];
        if (!toolName) {
          throw new Error('tool name is required');
        }

        const args = await loadJsonArgument(rawArguments[2]);
        const result = await client.request(
          {
            method: 'tools/call',
            params: {
              name: toolName,
              arguments: args,
            },
          },
          CallToolResultSchema,
        );
        console.log(JSON.stringify(result, null, 2));
        return;
      }
      case 'get-prompt': {
        const promptName = rawArguments[1];
        if (!promptName) {
          throw new Error('prompt name is required');
        }

        const args = await loadJsonArgument(rawArguments[2]);
        const result = await client.request(
          {
            method: 'prompts/get',
            params: {
              name: promptName,
              arguments: args,
            },
          },
          GetPromptResultSchema,
        );
        console.log(JSON.stringify(result, null, 2));
        return;
      }
      case 'read-resource': {
        const resourceUri = rawArguments[1];
        if (!resourceUri) {
          throw new Error('resource uri is required');
        }

        const result = await client.request(
          {
            method: 'resources/read',
            params: {
              uri: resourceUri,
            },
          },
          ReadResourceResultSchema,
        );
        console.log(JSON.stringify(result, null, 2));
        return;
      }
      default:
        printUsage();
        process.exitCode = 1;
    }
  } finally {
    await transport.close().catch(() => {});
    await client.close().catch(() => {});
  }
}

await main();
