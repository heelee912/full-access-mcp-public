import { randomUUID } from 'node:crypto';
import http from 'node:http';
import { URL } from 'node:url';

import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

import { readJsonBody, sendJson, setCorsHeaders } from './httpJson.js';
import { OidcGatewayAuth } from './oidcGatewayAuth.js';
import { RemoteGatewayQueue } from './remoteGatewayQueue.js';
import { createRemoteGatewayMcpServer } from './remoteGatewayMcpServer.js';
import { loadRemoteGatewaySettings } from './remoteGatewaySettings.js';

interface ConnectedTransport {
  server: ReturnType<typeof createRemoteGatewayMcpServer>['server'];
  transport: StreamableHTTPServerTransport;
  closeMetadata: () => Promise<void>;
}

type RemoteGatewaySurface = 'full-access' | 'read-only';

interface RemoteGatewaySurfaceRoute {
  surface: RemoteGatewaySurface;
  mcpPath: string;
  protectedResourceMetadataPath: string;
  oidcGatewayAuth?: OidcGatewayAuth;
  mcpAuthToken?: string;
}

function isLoopbackRemoteAddress(remoteAddress: string | undefined): boolean {
  return (
    remoteAddress === '127.0.0.1' ||
    remoteAddress === '::1' ||
    remoteAddress === '::ffff:127.0.0.1'
  );
}

function isLoopbackHostHeader(hostHeader: string | undefined): boolean {
  if (!hostHeader) {
    return false;
  }

  const normalized = hostHeader.trim().toLowerCase();
  return (
    normalized === '127.0.0.1' ||
    normalized.startsWith('127.0.0.1:') ||
    normalized === 'localhost' ||
    normalized.startsWith('localhost:')
  );
}

function isLoopbackDebugBypassRequest(
  request: http.IncomingMessage,
  enabled: boolean,
): boolean {
  if (!enabled) {
    return false;
  }

  const hostHeader = Array.isArray(request.headers.host)
    ? request.headers.host[0]
    : request.headers.host;

  return (
    isLoopbackRemoteAddress(request.socket.remoteAddress) &&
    isLoopbackHostHeader(hostHeader)
  );
}

function isAuthorizedBearer(
  actualHeader: string | undefined,
  expectedToken: string,
): boolean {
  return actualHeader === `Bearer ${expectedToken}`;
}

function sendUnauthorizedMcpResponse(
  response: http.ServerResponse,
  oidcGatewayAuth?: OidcGatewayAuth,
): void {
  if (oidcGatewayAuth) {
    oidcGatewayAuth.appendUnauthorizedHeaders(response);
  }

  sendJson(response, 401, { error: 'unauthorized' });
}

function getRemoteGatewaySurfaceRoutes(
  settings: ReturnType<typeof loadRemoteGatewaySettings>,
): RemoteGatewaySurfaceRoute[] {
  return [
    {
      surface: 'full-access',
      mcpPath: '/mcp',
      protectedResourceMetadataPath: '/.well-known/oauth-protected-resource/mcp',
      oidcGatewayAuth: settings.oidc
        ? new OidcGatewayAuth(settings.oidc)
        : undefined,
      mcpAuthToken: settings.mcpAuthToken,
    },
    {
      surface: 'read-only',
      mcpPath: '/mcp-readonly',
      protectedResourceMetadataPath:
        '/.well-known/oauth-protected-resource/mcp-readonly',
      oidcGatewayAuth: settings.readOnlyOidc
        ? new OidcGatewayAuth(settings.readOnlyOidc)
        : undefined,
      mcpAuthToken: settings.readOnlyMcpAuthToken,
    },
  ];
}

async function main(): Promise<void> {
  const settings = loadRemoteGatewaySettings();
  const remoteGatewayQueue = new RemoteGatewayQueue(
    settings.workstationId,
    settings.toolCallTimeoutMs,
    settings.agentPollTimeoutMs,
    settings.agentStaleAfterMs,
    settings.recentToolCallLimit,
  );
  const connectedTransports = new Map<string, ConnectedTransport>();
  const surfaceRoutes = getRemoteGatewaySurfaceRoutes(settings);

  const createConnectedTransport = async (
    surface: RemoteGatewaySurface,
  ): Promise<ConnectedTransport> => {
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (sessionId) => {
        connectedTransports.set(sessionId, connectedTransport);
      },
    });
    const remoteMcpServer = createRemoteGatewayMcpServer({
      remoteGatewayQueue,
      surface,
    });
    const connectedTransport: ConnectedTransport = {
      server: remoteMcpServer.server,
      transport,
      closeMetadata: remoteMcpServer.close,
    };

    transport.onclose = () => {
      if (transport.sessionId) {
        connectedTransports.delete(transport.sessionId);
      }
    };
    transport.onerror = (error) => {
      console.error('gateway transport error', error);
    };

    await remoteMcpServer.server.connect(transport);
    return connectedTransport;
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

    try {
      const parsedBody =
        request.method === 'POST'
          ? await readJsonBody(request, settings.httpRequestBodyLimitBytes)
          : undefined;

      if (request.method === 'GET' && requestUrl.pathname === '/health') {
        sendJson(response, 200, {
          ok: true,
          oidcEnabled: Boolean(settings.oidc),
          readOnlyOidcEnabled: Boolean(settings.readOnlyOidc),
          workstation: remoteGatewayQueue.getWorkstationSnapshot(),
          recentToolCallCount: remoteGatewayQueue.getRecentToolCalls().length,
        });
        return;
      }

      const protectedResourceRoute = surfaceRoutes.find(
        (surfaceRoute) =>
          surfaceRoute.protectedResourceMetadataPath === requestUrl.pathname,
      );

      if (
        request.method === 'GET' &&
        (requestUrl.pathname === '/.well-known/oauth-protected-resource' ||
          protectedResourceRoute)
      ) {
        const oidcGatewayAuth =
          protectedResourceRoute?.oidcGatewayAuth ?? surfaceRoutes[0]?.oidcGatewayAuth;

        if (!oidcGatewayAuth) {
          sendJson(response, 404, { error: 'OIDC is not enabled' });
          return;
        }

        sendJson(response, 200, oidcGatewayAuth.getProtectedResourceMetadata());
        return;
      }

      if (request.method === 'POST' && requestUrl.pathname === '/agent/poll') {
        const workstationId = request.headers['x-workstation-id'];
        const authHeader = request.headers.authorization;
        const normalizedWorkstationId = Array.isArray(workstationId)
          ? workstationId[0]
          : workstationId;

        if (normalizedWorkstationId !== settings.workstationId) {
          sendJson(response, 401, { error: 'unknown workstation id' });
          return;
        }

        if (!isAuthorizedBearer(authHeader, settings.workstationToken)) {
          sendJson(response, 401, { error: 'unauthorized workstation agent' });
          return;
        }

        const nextTask = await remoteGatewayQueue.pollNextTask();
        sendJson(response, 200, {
          ok: true,
          workstationId: settings.workstationId,
          task: nextTask,
        });
        return;
      }

      if (
        request.method === 'POST' &&
        requestUrl.pathname.startsWith('/agent/tasks/') &&
        requestUrl.pathname.endsWith('/result')
      ) {
        const workstationId = request.headers['x-workstation-id'];
        const authHeader = request.headers.authorization;
        const normalizedWorkstationId = Array.isArray(workstationId)
          ? workstationId[0]
          : workstationId;

        if (normalizedWorkstationId !== settings.workstationId) {
          sendJson(response, 401, { error: 'unknown workstation id' });
          return;
        }

        if (!isAuthorizedBearer(authHeader, settings.workstationToken)) {
          sendJson(response, 401, { error: 'unauthorized workstation agent' });
          return;
        }

        const taskId = requestUrl.pathname.slice('/agent/tasks/'.length, -'/result'.length);
        const parsedResult = zodAgentResult.parse(parsedBody);

        if (parsedResult.ok) {
          remoteGatewayQueue.completeTask(taskId, parsedResult.result);
        } else {
          remoteGatewayQueue.failTask(taskId, parsedResult.error);
        }

        sendJson(response, 200, { ok: true });
        return;
      }

      const surfaceRoute = surfaceRoutes.find(
        (candidateSurfaceRoute) =>
          candidateSurfaceRoute.mcpPath === requestUrl.pathname,
      );

      if (!surfaceRoute) {
        sendJson(response, 404, { error: 'not found' });
        return;
      }

      if (surfaceRoute.oidcGatewayAuth) {
        if (
          !isLoopbackDebugBypassRequest(
            request,
            settings.allowLoopbackDebugBypass,
          )
        ) {
          try {
            await surfaceRoute.oidcGatewayAuth.authorizeAuthorizationHeader(
              request.headers.authorization,
            );
          } catch {
            sendUnauthorizedMcpResponse(response, surfaceRoute.oidcGatewayAuth);
            return;
          }
        }
      } else if (
        surfaceRoute.mcpAuthToken &&
        !isAuthorizedBearer(request.headers.authorization, surfaceRoute.mcpAuthToken)
      ) {
        sendUnauthorizedMcpResponse(response);
        return;
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

          const connectedTransport = await createConnectedTransport(
            surfaceRoute.surface,
          );
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

        await connectedTransport.transport.handleRequest(request, response, parsedBody);
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
      console.error('gateway request handling failed', error);
      const statusCode =
        error instanceof Error && error.message.includes('request body exceeds')
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
      await connectedTransport.closeMetadata();
    }

    await remoteGatewayQueue.close();
  };

  process.once('SIGINT', () => {
    void shutdown().finally(() => process.exit(0));
  });
  process.once('SIGTERM', () => {
    void shutdown().finally(() => process.exit(0));
  });

  httpServer.listen(settings.port, settings.host, () => {
    console.log(
      `remote MCP gateway listening on http://${settings.host}:${settings.port}/mcp`,
    );
    console.log(
      `remote read-only MCP gateway listening on http://${settings.host}:${settings.port}/mcp-readonly`,
    );
    console.log(
      `agent poll endpoint: http://${settings.host}:${settings.port}/agent/poll`,
    );
    console.log(
      `expected workstation id: ${settings.workstationId}`,
    );
    console.log(
      `gateway MCP authorization: ${
        settings.oidc
          ? `OIDC enabled (${settings.oidc.issuerUrl})`
          : settings.mcpAuthToken
            ? 'bearer token enabled'
            : 'disabled'
      }`,
    );
    console.log(
      `gateway read-only MCP authorization: ${
        settings.readOnlyOidc
          ? `OIDC enabled (${settings.readOnlyOidc.issuerUrl})`
          : settings.readOnlyMcpAuthToken
            ? 'bearer token enabled'
            : 'disabled'
      }`,
    );
  });
}

const zodAgentResult = z.discriminatedUnion('ok', [
  z.object({
    ok: z.literal(true),
    result: z.unknown(),
  }),
  z.object({
    ok: z.literal(false),
    error: z.string(),
  }),
]);

void main();
