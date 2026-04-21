import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';

import { exportJWK, generateKeyPair, SignJWT } from 'jose';

import { OidcGatewayAuth } from '../src/oidcGatewayAuth.js';

test('OidcGatewayAuth validates a JWT from the discovered issuer metadata', async () => {
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const publicJwk = await exportJWK(publicKey);
  publicJwk.kid = 'test-key';

  const issuerServer = await createIssuerServer({
    jwks: {
      keys: [publicJwk],
    },
  });

  try {
    const gatewayAuth = new OidcGatewayAuth({
      issuerUrl: issuerServer.issuerUrl,
      audience: 'https://gateway.example.com/mcp',
      publicGatewayBaseUrl: 'https://gateway.example.com',
      requiredScopes: ['mcp.full_access'],
      allowedSubjects: ['user-123'],
      allowedEmails: ['user@example.com'],
    });

    const token = await new SignJWT({
      scope: 'mcp.full_access offline_access',
      email: 'user@example.com',
    })
      .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
      .setIssuer(issuerServer.issuerUrl)
      .setAudience('https://gateway.example.com/mcp')
      .setSubject('user-123')
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(privateKey);

    const principal = await gatewayAuth.authorizeAuthorizationHeader(`Bearer ${token}`);

    assert.equal(principal.subject, 'user-123');
    assert.equal(principal.email, 'user@example.com');
    assert.deepEqual(principal.scopes, ['mcp.full_access', 'offline_access']);
  } finally {
    await issuerServer.close();
  }
});

test('OidcGatewayAuth rejects tokens without the required scope', async () => {
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const publicJwk = await exportJWK(publicKey);
  publicJwk.kid = 'test-key';

  const issuerServer = await createIssuerServer({
    jwks: {
      keys: [publicJwk],
    },
  });

  try {
    const gatewayAuth = new OidcGatewayAuth({
      issuerUrl: issuerServer.issuerUrl,
      audience: 'https://gateway.example.com/mcp',
      publicGatewayBaseUrl: 'https://gateway.example.com',
      requiredScopes: ['mcp.full_access'],
      allowedSubjects: [],
      allowedEmails: [],
    });

    const token = await new SignJWT({
      scope: 'profile email',
    })
      .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
      .setIssuer(issuerServer.issuerUrl)
      .setAudience('https://gateway.example.com/mcp')
      .setSubject('user-123')
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(privateKey);

    await assert.rejects(
      gatewayAuth.authorizeAuthorizationHeader(`Bearer ${token}`),
      /missing required scopes/,
    );
  } finally {
    await issuerServer.close();
  }
});

test('OidcGatewayAuth exposes protected resource metadata for MCP discovery', () => {
  const gatewayAuth = new OidcGatewayAuth({
    issuerUrl: 'https://issuer.example.com',
    audience: 'https://gateway.example.com/mcp',
    publicGatewayBaseUrl: 'https://gateway.example.com',
    requiredScopes: ['mcp.full_access'],
    allowedSubjects: [],
    allowedEmails: [],
  });

  assert.deepEqual(gatewayAuth.getProtectedResourceMetadata(), {
    resource: 'https://gateway.example.com/mcp',
    authorization_servers: ['https://issuer.example.com'],
    scopes_supported: ['mcp.full_access'],
    bearer_methods_supported: ['header'],
  });
});

async function createIssuerServer(options: {
  jwks: Record<string, unknown>;
}): Promise<{
  issuerUrl: string;
  close: () => Promise<void>;
}> {
  const server = http.createServer((request, response) => {
    if (!request.url) {
      response.statusCode = 400;
      response.end();
      return;
    }

    if (request.url === '/.well-known/openid-configuration') {
      response.setHeader('Content-Type', 'application/json');
      response.end(
        JSON.stringify({
          issuer: issuerUrl,
          jwks_uri: `${issuerUrl}/jwks`,
          authorization_endpoint: `${issuerUrl}/authorize`,
          token_endpoint: `${issuerUrl}/oauth/token`,
          code_challenge_methods_supported: ['S256'],
        }),
      );
      return;
    }

    if (request.url === '/jwks') {
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify(options.jwks));
      return;
    }

    response.statusCode = 404;
    response.end();
  });

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve());
  });

  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('unexpected issuer server address');
  }

  const issuerUrl = `http://127.0.0.1:${String(address.port)}`;

  return {
    issuerUrl,
    close: async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }

          resolve();
        });
      });
    },
  };
}
