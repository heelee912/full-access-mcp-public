import type { IncomingMessage, ServerResponse } from 'node:http';

import { z } from 'zod';

import { LocalBridgeAuditTrail } from './localBridgeAuditTrail.js';
import { type FullAccessServerSettings } from './settings.js';
import { type FullAccessToolCatalog } from './toolCatalog.js';
import {
  createChatGptBootstrapPrompt,
  createChatGptInlineToolPrompt,
  createChatGptRecoveryPrompt,
} from './chatGptUserscript.js';

const singleToolCallSchema = z.object({
  toolName: z.string().min(1),
  arguments: z.unknown().optional(),
});

const batchToolCallSchema = z.object({
  calls: z.array(singleToolCallSchema).min(1),
  stopOnError: z.boolean().default(false),
});

const bridgeStatusSchema = z.object({
  includeSchemas: z.boolean().default(false),
});

const bridgeClientConfigSchema = z.object({
  includePrompt: z.boolean().default(true),
});

export interface LocalBridgeState {
  locked: boolean;
}

export interface LocalBridgeRuntime {
  settings: FullAccessServerSettings;
  toolCatalog: FullAccessToolCatalog;
  bridgeAuthToken?: string;
  bridgeState: LocalBridgeState;
  auditTrail: LocalBridgeAuditTrail;
}

function getHeaderValue(
  request: IncomingMessage,
  headerName: string,
): string | undefined {
  const rawValue = request.headers[headerName];
  if (Array.isArray(rawValue)) {
    return rawValue[0];
  }

  return rawValue;
}

function sendJson(
  response: ServerResponse,
  statusCode: number,
  payload: unknown,
): void {
  response.statusCode = statusCode;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.end(JSON.stringify(payload));
}

export function isLoopbackAddress(address: string | undefined): boolean {
  if (!address) {
    return false;
  }

  const normalized = address.replace('::ffff:', '').toLowerCase();
  return normalized === '127.0.0.1' || normalized === '::1' || normalized === '1';
}

export function isRejectedWebOrigin(origin: string | undefined): boolean {
  if (!origin) {
    return false;
  }

  return origin.startsWith('http://') || origin.startsWith('https://');
}

export function isLocalBridgeHostHeader(hostHeader: string | undefined): boolean {
  if (!hostHeader) {
    return false;
  }

  const normalizedHost = hostHeader.trim().toLowerCase();
  return (
    normalizedHost.startsWith('127.0.0.1:') ||
    normalizedHost === '127.0.0.1' ||
    normalizedHost.startsWith('localhost:') ||
    normalizedHost === 'localhost' ||
    normalizedHost.startsWith('[::1]:') ||
    normalizedHost === '[::1]'
  );
}

export function isAllowedBridgeClient(
  clientId: string | undefined,
  allowedClients: string[],
): boolean {
  if (!clientId) {
    return false;
  }

  return allowedClients.includes(clientId);
}

function getBridgeClientId(request: IncomingMessage): string {
  return getHeaderValue(request, 'x-full-access-client') || 'unknown-client';
}

function authorizeBridgeRequest(
  request: IncomingMessage,
  runtime: LocalBridgeRuntime,
  options?: {
    requireToken?: boolean;
  },
): { ok: true } | { ok: false; statusCode: number; error: string } {
  const bridgeClientId = getBridgeClientId(request);

  if (runtime.settings.localBridgeRequireLoopback) {
    const remoteAddress = request.socket.remoteAddress;

    if (!isLoopbackAddress(remoteAddress)) {
      return {
        ok: false,
        statusCode: 403,
        error: 'local bridge only accepts loopback connections',
      };
    }
  }

  if (runtime.settings.localBridgeRequireLocalHostHeader) {
    const hostHeader = getHeaderValue(request, 'host');

    if (!isLocalBridgeHostHeader(hostHeader)) {
      return {
        ok: false,
        statusCode: 403,
        error: 'local bridge only accepts localhost host headers',
      };
    }
  }

  if (runtime.settings.localBridgeRejectWebOrigins) {
    const origin = getHeaderValue(request, 'origin');

    if (isRejectedWebOrigin(origin)) {
      return {
        ok: false,
        statusCode: 403,
        error: 'local bridge rejects web page origins; use the browser extension or local client',
      };
    }
  }

  if (
    !isAllowedBridgeClient(
      bridgeClientId,
      runtime.settings.localBridgeAllowedClients,
    )
  ) {
    return {
      ok: false,
      statusCode: 403,
      error: 'bridge client is not allowed',
    };
  }

  if (options?.requireToken !== false && runtime.bridgeAuthToken) {
    const authorizationHeader = getHeaderValue(request, 'authorization');
    const expectedHeader = `Bearer ${runtime.bridgeAuthToken}`;

    if (authorizationHeader !== expectedHeader) {
      return {
        ok: false,
        statusCode: 401,
        error: 'missing or invalid local bridge token',
      };
    }
  }

  return { ok: true };
}

async function recordBridgeAudit(
  runtime: LocalBridgeRuntime,
  request: IncomingMessage,
  pathname: string,
  authorized: boolean,
  outcome: 'allowed' | 'blocked' | 'error',
  details?: Record<string, unknown>,
): Promise<void> {
  try {
    await runtime.auditTrail.record({
      timestamp: new Date().toISOString(),
      method: request.method || 'UNKNOWN',
      pathname,
      clientId: getBridgeClientId(request),
      remoteAddress: request.socket.remoteAddress || '',
      authorized,
      outcome,
      details,
    });
  } catch (error) {
    console.warn('local bridge audit logging failed', error);
  }
}

function listToolSchemas(runtime: LocalBridgeRuntime) {
  return runtime.toolCatalog.toolDefinitions.map((toolDefinition) => ({
    name: toolDefinition.name,
    description: toolDefinition.description,
    annotations: toolDefinition.annotations,
    inputSchema: toolDefinition.inputSchema
      ? z.toJSONSchema(toolDefinition.inputSchema)
      : undefined,
  }));
}

export async function handleLocalBridgeRequest(options: {
  request: IncomingMessage;
  response: ServerResponse;
  parsedBody: unknown;
  runtime: LocalBridgeRuntime;
}): Promise<boolean> {
  const { request, response, parsedBody, runtime } = options;

  if (!runtime.settings.localBridgeEnabled) {
    sendJson(response, 404, { error: 'local bridge disabled' });
    return true;
  }

  const requestUrl = new URL(
    request.url || '/',
    `http://${request.headers.host || 'localhost'}`,
  );

  if (!requestUrl.pathname.startsWith('/bridge')) {
    return false;
  }

  const authorizationResult = authorizeBridgeRequest(request, runtime);

  if (request.method === 'GET' && requestUrl.pathname === '/bridge/status') {
    if (!authorizationResult.ok) {
      await recordBridgeAudit(runtime, request, requestUrl.pathname, false, 'blocked', {
        error: authorizationResult.error,
      });
      sendJson(response, authorizationResult.statusCode, {
        error: authorizationResult.error,
      });
      return true;
    }

    const queryObject = bridgeStatusSchema.parse({
      includeSchemas: requestUrl.searchParams.get('includeSchemas') === 'true',
    });

    sendJson(response, 200, {
      ok: true,
      toolCount: runtime.toolCatalog.toolDefinitions.length,
      toolLanguage: 'full-access-tools',
      batchEndpoint: '/bridge/batch',
      callEndpoint: '/bridge/call',
      authRequired: Boolean(runtime.bridgeAuthToken),
      locked: runtime.bridgeState.locked,
      allowedClients: runtime.settings.localBridgeAllowedClients,
      auditTrail: runtime.auditTrail.describe(),
      tools: queryObject.includeSchemas
        ? listToolSchemas(runtime)
        : runtime.toolCatalog.toolDefinitions.map((toolDefinition) => ({
            name: toolDefinition.name,
            description: toolDefinition.description,
            annotations: toolDefinition.annotations,
          })),
    });
    await recordBridgeAudit(runtime, request, requestUrl.pathname, true, 'allowed');
    return true;
  }

  if (request.method === 'GET' && requestUrl.pathname === '/bridge/client-config') {
    const configAuthorizationResult = authorizeBridgeRequest(request, runtime, {
      requireToken: false,
    });

    if (!configAuthorizationResult.ok) {
      await recordBridgeAudit(runtime, request, requestUrl.pathname, false, 'blocked', {
        error: configAuthorizationResult.error,
      });
      sendJson(response, configAuthorizationResult.statusCode, {
        error: configAuthorizationResult.error,
      });
      return true;
    }

    const queryObject = bridgeClientConfigSchema.parse({
      includePrompt: requestUrl.searchParams.get('includePrompt') !== 'false',
    });

    sendJson(response, 200, {
      ok: true,
      bridgeBaseUrl: `http://127.0.0.1:${runtime.settings.port}`,
      bridgeToken: runtime.bridgeAuthToken || '',
      toolLanguage: 'full-access-tools',
      batchEndpoint: '/bridge/batch',
      autoRun: true,
      autoSubmitResults: true,
      autoBootstrapConversation: false,
      autoRecoverRefusals: true,
      toolPrompt: queryObject.includePrompt
        ? createChatGptBootstrapPrompt('full-access-tools')
        : undefined,
      inlineToolPrompt: queryObject.includePrompt
        ? createChatGptInlineToolPrompt('full-access-tools')
        : undefined,
      recoveryPrompt: createChatGptRecoveryPrompt('full-access-tools'),
      bridgeLocked: runtime.bridgeState.locked,
    });
    await recordBridgeAudit(runtime, request, requestUrl.pathname, true, 'allowed');
    return true;
  }

  if (request.method === 'GET' && requestUrl.pathname === '/bridge/security') {
    if (!authorizationResult.ok) {
      await recordBridgeAudit(runtime, request, requestUrl.pathname, false, 'blocked', {
        error: authorizationResult.error,
      });
      sendJson(response, authorizationResult.statusCode, {
        error: authorizationResult.error,
      });
      return true;
    }

    sendJson(response, 200, {
      ok: true,
      locked: runtime.bridgeState.locked,
      allowedClients: runtime.settings.localBridgeAllowedClients,
      authRequired: Boolean(runtime.bridgeAuthToken),
      auditTrail: runtime.auditTrail.describe(),
    });
    await recordBridgeAudit(runtime, request, requestUrl.pathname, true, 'allowed');
    return true;
  }

  if (
    request.method === 'POST' &&
    (requestUrl.pathname === '/bridge/security/lock' ||
      requestUrl.pathname === '/bridge/security/unlock')
  ) {
    if (!authorizationResult.ok) {
      await recordBridgeAudit(runtime, request, requestUrl.pathname, false, 'blocked', {
        error: authorizationResult.error,
      });
      sendJson(response, authorizationResult.statusCode, {
        error: authorizationResult.error,
      });
      return true;
    }

    runtime.bridgeState.locked = requestUrl.pathname.endsWith('/lock');
    sendJson(response, 200, {
      ok: true,
      locked: runtime.bridgeState.locked,
    });
    await recordBridgeAudit(runtime, request, requestUrl.pathname, true, 'allowed', {
      locked: runtime.bridgeState.locked,
    });
    return true;
  }

  if (!authorizationResult.ok) {
    await recordBridgeAudit(runtime, request, requestUrl.pathname, false, 'blocked', {
      error: authorizationResult.error,
    });
    sendJson(response, authorizationResult.statusCode, {
      error: authorizationResult.error,
    });
    return true;
  }

  if (
    runtime.bridgeState.locked &&
    (requestUrl.pathname === '/bridge/call' || requestUrl.pathname === '/bridge/batch')
  ) {
    await recordBridgeAudit(runtime, request, requestUrl.pathname, true, 'blocked', {
      error: 'local bridge is locked',
    });
    sendJson(response, 423, {
      error: 'local bridge is locked',
    });
    return true;
  }

  if (request.method === 'POST' && requestUrl.pathname === '/bridge/call') {
    const parsedCall = singleToolCallSchema.parse(parsedBody);

    try {
      const result = await runtime.toolCatalog.executeToolCall(
        parsedCall.toolName,
        parsedCall.arguments,
      );

      sendJson(response, 200, {
        ok: true,
        toolName: parsedCall.toolName,
        result,
      });
      await recordBridgeAudit(runtime, request, requestUrl.pathname, true, 'allowed', {
        toolNames: [parsedCall.toolName],
      });
    } catch (error) {
      sendJson(response, 400, {
        ok: false,
        toolName: parsedCall.toolName,
        error: error instanceof Error ? error.message : String(error),
      });
      await recordBridgeAudit(runtime, request, requestUrl.pathname, true, 'error', {
        toolNames: [parsedCall.toolName],
        error: error instanceof Error ? error.message : String(error),
      });
    }

    return true;
  }

  if (request.method === 'POST' && requestUrl.pathname === '/bridge/batch') {
    const parsedBatch = batchToolCallSchema.parse(parsedBody);
    const results: Array<{
      toolName: string;
      ok: boolean;
      result?: unknown;
      error?: string;
    }> = [];

    for (const call of parsedBatch.calls) {
      try {
        const result = await runtime.toolCatalog.executeToolCall(
          call.toolName,
          call.arguments,
        );

        results.push({
          toolName: call.toolName,
          ok: true,
          result,
        });
      } catch (error) {
        results.push({
          toolName: call.toolName,
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        });

        if (parsedBatch.stopOnError) {
          break;
        }
      }
    }

    sendJson(response, 200, {
      ok: results.every((result) => result.ok),
      results,
    });
    await recordBridgeAudit(runtime, request, requestUrl.pathname, true, 'allowed', {
      toolNames: parsedBatch.calls.map((call) => call.toolName),
      resultCount: results.length,
      ok: results.every((result) => result.ok),
    });
    return true;
  }

  await recordBridgeAudit(runtime, request, requestUrl.pathname, true, 'blocked', {
    error: 'bridge route not found',
  });
  sendJson(response, 404, { error: 'bridge route not found' });
  return true;
}
