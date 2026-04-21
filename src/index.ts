import { randomUUID } from 'node:crypto';
import http, { type ServerResponse } from 'node:http';
import { URL } from 'node:url';

import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';

import { BrowserSessionRegistry } from './browserSessionRegistry.js';
import { CommandSessionRegistry } from './commandSessionRegistry.js';
import { createFullAccessMcpServer } from './fullAccessMcpServer.js';
import {
  createChatGptBootstrapPrompt,
  createChatGptInlineToolPrompt,
  createChatGptRecoveryPrompt,
  createChatGptUserscript,
} from './chatGptUserscript.js';
import { readJsonBody, sendJson, setCorsHeaders } from './httpJson.js';
import { LocalBridgeAuditTrail } from './localBridgeAuditTrail.js';
import { handleLocalBridgeRequest } from './localBridgeHttp.js';
import { createLocalWorkstationRuntime } from './localWorkstationRuntime.js';
import { loadFullAccessServerSettings } from './settings.js';
interface ConnectedTransport {
  server: ReturnType<typeof createFullAccessMcpServer>;
  transport: StreamableHTTPServerTransport;
}

interface ConnectedLegacySseTransport {
  server: ReturnType<typeof createFullAccessMcpServer>;
  transport: SSEServerTransport;
}

async function main(): Promise<void> {
  const settings = loadFullAccessServerSettings();
  const workstationRuntime = createLocalWorkstationRuntime(settings);
  const {
    workspaceFileAccess,
    commandSessionRegistry,
    browserSessionRegistry,
    windowsDesktopAutomation,
    windowsSystemControl,
    toolCatalog,
  } = workstationRuntime;
  const bridgeAuthToken = settings.localBridgeEnabled
    ? settings.localBridgeToken || randomUUID()
    : undefined;
  const bridgeState = {
    locked: settings.localBridgeStartLocked,
  };
  const auditTrail = new LocalBridgeAuditTrail(
    settings.localBridgeAuditLogPath,
    settings.localBridgeAuditLogEnabled,
  );

  const connectedTransports = new Map<string, ConnectedTransport>();
  const connectedLegacySseTransports = new Map<string, ConnectedLegacySseTransport>();
  const userscriptBaseUrl = `http://127.0.0.1:${settings.port}`;
  const userscriptPathname = '/tampermonkey/chatgpt-full-access.user.js';
  const userscriptInstallPathname = '/tampermonkey/install';

  const createConnectedTransport = async (): Promise<ConnectedTransport> => {
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (sessionId) => {
        connectedTransports.set(sessionId, {
          server,
          transport,
        });
      },
    });

    const server = createFullAccessMcpServer({
      settings,
      workspaceFileAccess,
      commandSessionRegistry,
      browserSessionRegistry,
      windowsDesktopAutomation,
      windowsSystemControl,
    });

    transport.onclose = () => {
      if (transport.sessionId) {
        connectedTransports.delete(transport.sessionId);
      }
    };

    transport.onerror = (error) => {
      console.error('transport error', error);
    };

    await server.connect(transport);

    return {
      server,
      transport,
    };
  };

  const createConnectedLegacySseTransport = async (
    response: ServerResponse,
  ): Promise<ConnectedLegacySseTransport> => {
    const transport = new SSEServerTransport('/messages', response);
    const server = createFullAccessMcpServer({
      settings,
      workspaceFileAccess,
      commandSessionRegistry,
      browserSessionRegistry,
      windowsDesktopAutomation,
      windowsSystemControl,
    });

    connectedLegacySseTransports.set(transport.sessionId, {
      server,
      transport,
    });

    transport.onclose = () => {
      connectedLegacySseTransports.delete(transport.sessionId);
    };

    transport.onerror = (error) => {
      console.error('legacy SSE transport error', error);
    };

    try {
      await server.connect(transport);
      return {
        server,
        transport,
      };
    } catch (error) {
      connectedLegacySseTransports.delete(transport.sessionId);
      await server.close();
      throw error;
    }
  };

  const httpServer = http.createServer(async (request, response) => {
    setCorsHeaders(response, settings.corsOrigin);

    if (!request.url) {
      sendJson(response, 400, { error: 'missing request url' });
      return;
    }

    if (request.method === 'OPTIONS') {
      response.statusCode = 204;
      response.end();
      return;
    }

    const requestUrl = new URL(
      request.url,
      `http://${request.headers.host || 'localhost'}`,
    );

    if (requestUrl.pathname === '/health') {
      sendJson(response, 200, {
        ok: true,
        browserEnabled: settings.browserEnabled,
        localBridgeEnabled: settings.localBridgeEnabled,
        workspaceRoots: workspaceFileAccess.listWorkspaceRoots(),
      });
      return;
    }

    if (request.method === 'GET' && requestUrl.pathname === userscriptPathname) {
      const userscript = createChatGptUserscript({
        bridgeBaseUrl: userscriptBaseUrl,
        bridgeConfigUrl: `${userscriptBaseUrl}/bridge/client-config`,
        toolLanguage: 'full-access-tools',
        toolPrompt: createChatGptBootstrapPrompt('full-access-tools'),
        inlineToolPrompt: createChatGptInlineToolPrompt('full-access-tools'),
        recoveryPrompt: createChatGptRecoveryPrompt('full-access-tools'),
        autoRun: true,
        autoSubmitResults: true,
        autoBootstrapConversation: false,
        autoRecoverRefusals: true,
        bridgeLocked: bridgeState.locked,
      });

      response.statusCode = 200;
      response.setHeader('Content-Type', 'text/javascript; charset=utf-8');
      response.end(userscript);
      return;
    }

    if (request.method === 'GET' && requestUrl.pathname === userscriptInstallPathname) {
      const installUrl = `${userscriptBaseUrl}${userscriptPathname}`;
      const installHtml = [
        '<!doctype html>',
        '<html lang="en">',
        '<head>',
        '  <meta charset="utf-8">',
        '  <title>ChatGPT Full Access Userscript</title>',
        '  <meta http-equiv="refresh" content="0; url=' + installUrl + '">',
        '</head>',
        '<body style="font-family:Segoe UI,sans-serif;padding:24px;">',
        '  <h1>ChatGPT Full Access Userscript</h1>',
        '  <p>If Tampermonkey does not open automatically, use the link below.</p>',
        '  <p><a href="' + installUrl + '">Install the userscript</a></p>',
        '</body>',
        '</html>',
      ].join('\n');

      response.statusCode = 200;
      response.setHeader('Content-Type', 'text/html; charset=utf-8');
      response.end(installHtml);
      return;
    }

    try {
      const parsedBody =
        request.method === 'POST'
          ? await readJsonBody(request, settings.httpRequestBodyLimitBytes)
          : undefined;

      const handledByLocalBridge = await handleLocalBridgeRequest({
        request,
        response,
        parsedBody,
        runtime: {
          settings,
          toolCatalog,
          bridgeAuthToken,
          bridgeState,
          auditTrail,
        },
      });

      if (handledByLocalBridge) {
        return;
      }

      if (request.method === 'GET' && requestUrl.pathname === '/sse') {
        await createConnectedLegacySseTransport(response);
        return;
      }

      if (request.method === 'POST' && requestUrl.pathname === '/messages') {
        const sessionId = requestUrl.searchParams.get('sessionId');

        if (!sessionId) {
          sendJson(response, 400, { error: 'missing SSE session id' });
          return;
        }

        const connectedLegacyTransport =
          connectedLegacySseTransports.get(sessionId);

        if (!connectedLegacyTransport) {
          sendJson(response, 404, { error: 'unknown SSE session' });
          return;
        }

        await connectedLegacyTransport.transport.handlePostMessage(
          request,
          response,
          parsedBody,
        );
        return;
      }

      if (requestUrl.pathname !== '/mcp') {
        sendJson(response, 404, { error: 'not found' });
        return;
      }

      if (settings.authToken) {
        const headerValue = request.headers.authorization || '';
        const expectedHeaderValue = `Bearer ${settings.authToken}`;

        if (headerValue !== expectedHeaderValue) {
          sendJson(response, 401, { error: 'unauthorized' });
          return;
        }
      }

      if (request.method === 'POST') {
        const sessionIdHeader = request.headers['mcp-session-id'];
        const sessionId = Array.isArray(sessionIdHeader)
          ? sessionIdHeader[0]
          : sessionIdHeader;

        if (!sessionId) {
          if (!isInitializeRequest(parsedBody)) {
            sendJson(response, 400, {
              jsonrpc: '2.0',
              error: {
                code: -32000,
                message: 'Missing MCP session id for a non-initialize request',
              },
              id: null,
            });
            return;
          }

          const connectedTransport = await createConnectedTransport();
          await connectedTransport.transport.handleRequest(
            request,
            response,
            parsedBody,
          );
          return;
        }

        const connectedTransport = connectedTransports.get(sessionId);
        if (!connectedTransport) {
          sendJson(response, 404, { error: 'unknown MCP session' });
          return;
        }

        await connectedTransport.transport.handleRequest(
          request,
          response,
          parsedBody,
        );
        return;
      }

      if (request.method === 'GET' || request.method === 'DELETE') {
        const sessionIdHeader = request.headers['mcp-session-id'];
        const sessionId = Array.isArray(sessionIdHeader)
          ? sessionIdHeader[0]
          : sessionIdHeader;

        if (!sessionId) {
          sendJson(response, 400, { error: 'missing MCP session id' });
          return;
        }

        const connectedTransport = connectedTransports.get(sessionId);
        if (!connectedTransport) {
          sendJson(response, 404, { error: 'unknown MCP session' });
          return;
        }

        await connectedTransport.transport.handleRequest(request, response);
        return;
      }

      sendJson(response, 405, { error: 'method not allowed' });
    } catch (error) {
      console.error('request handling failed', error);
      const statusCode =
        error instanceof Error &&
        error.message.includes('request body exceeds')
          ? 413
          : 500;
      sendJson(response, statusCode, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  const shutdown = async () => {
    httpServer.close();

    for (const connectedTransport of connectedTransports.values()) {
      await connectedTransport.transport.close();
      await connectedTransport.server.close();
    }

    for (const connectedLegacySseTransport of connectedLegacySseTransports.values()) {
      await connectedLegacySseTransport.transport.close();
      await connectedLegacySseTransport.server.close();
    }

    await Promise.all([
      workstationRuntime.close(),
    ]);
  };

  process.once('SIGINT', () => {
    void shutdown().finally(() => process.exit(0));
  });
  process.once('SIGTERM', () => {
    void shutdown().finally(() => process.exit(0));
  });

  httpServer.listen(settings.port, settings.host, () => {
    console.log(
      `full-access MCP server listening on http://${settings.host}:${settings.port}/mcp`,
    );
    console.log(
      `legacy SSE endpoint: http://${settings.host}:${settings.port}/sse`,
    );
    console.log(`health endpoint: http://${settings.host}:${settings.port}/health`);
    if (settings.localBridgeEnabled) {
      console.log(
        `local bridge endpoint: http://${settings.host}:${settings.port}/bridge/status`,
      );
      if (settings.localBridgeToken) {
        console.log('local bridge token: loaded from environment');
      } else {
        console.log(`local bridge token (runtime-only): ${bridgeAuthToken}`);
      }
      console.log(
        `local bridge allowed clients: ${settings.localBridgeAllowedClients.join(', ')}`,
      );
      console.log(
        `local bridge locked on startup: ${bridgeState.locked ? 'yes' : 'no'}`,
      );
      console.log(
        `local bridge audit log: ${settings.localBridgeAuditLogEnabled ? settings.localBridgeAuditLogPath : 'disabled'}`,
      );
    } else {
      console.log('local bridge: disabled');
    }
    console.log(
      `workspace roots: ${workspaceFileAccess.listWorkspaceRoots().join(', ')}`,
    );
    if (settings.authToken) {
      console.log('MCP authorization: bearer token enabled');
    } else {
      console.log('MCP authorization: disabled');
    }
    console.log(`HTTP request body limit: ${settings.httpRequestBodyLimitBytes} bytes`);
  });
}

void main();
