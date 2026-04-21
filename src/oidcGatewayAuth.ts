import type { ServerResponse } from 'node:http';

import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';

import { type RemoteGatewayOidcSettings } from './remoteGatewaySettings.js';

interface AuthorizationServerMetadata {
  issuer: string;
  jwks_uri: string;
}

export interface AuthorizedGatewayPrincipal {
  subject: string;
  email?: string;
  scopes: string[];
  claims: JWTPayload;
}

export class OidcGatewayAuth {
  private authorizationServerMetadataPromise?: Promise<AuthorizationServerMetadata>;

  private remoteJwkSet?: ReturnType<typeof createRemoteJWKSet>;

  constructor(private readonly settings: RemoteGatewayOidcSettings) {}

  isEnabled(): boolean {
    return true;
  }

  getProtectedResourceMetadataUrl(): string {
    return joinGatewayUrl(
      this.settings.publicGatewayBaseUrl,
      this.settings.protectedResourceMetadataPath || '/.well-known/oauth-protected-resource/mcp',
    );
  }

  getProtectedResourceMetadata(): Record<string, unknown> {
    return {
      resource:
        this.settings.resourceUrl ||
        joinGatewayUrl(this.settings.publicGatewayBaseUrl, this.settings.mcpPath || '/mcp'),
      authorization_servers: [this.settings.issuerUrl],
      scopes_supported:
        this.settings.requiredScopes.length > 0
          ? this.settings.requiredScopes
          : undefined,
      bearer_methods_supported: ['header'],
    };
  }

  appendUnauthorizedHeaders(response: ServerResponse): void {
    const scopeFragment =
      this.settings.requiredScopes.length > 0
        ? `, scope="${this.settings.requiredScopes.join(' ')}"`
        : '';
    response.setHeader(
      'WWW-Authenticate',
      `Bearer resource_metadata="${this.getProtectedResourceMetadataUrl()}"${scopeFragment}`,
    );
  }

  async authorizeAuthorizationHeader(
    authorizationHeader: string | undefined,
  ): Promise<AuthorizedGatewayPrincipal> {
    const token = extractBearerToken(authorizationHeader);

    if (!token) {
      throw new Error('missing bearer token');
    }

    const authorizationServerMetadata = await this.getAuthorizationServerMetadata();
    const remoteJwkSet =
      this.remoteJwkSet ||
      createRemoteJWKSet(new URL(authorizationServerMetadata.jwks_uri));
    this.remoteJwkSet = remoteJwkSet;

    const verificationResult = await jwtVerify(token, remoteJwkSet, {
      issuer: this.settings.issuerUrl,
      audience: this.settings.audience,
    });
    const scopes = extractScopes(verificationResult.payload);
    const subject = verificationResult.payload.sub;

    if (!subject) {
      throw new Error('token subject is missing');
    }

    if (
      this.settings.requiredScopes.length > 0 &&
      !this.settings.requiredScopes.every((requiredScope) =>
        scopes.includes(requiredScope),
      )
    ) {
      throw new Error('token is missing required scopes');
    }

    if (
      this.settings.allowedSubjects.length > 0 &&
      !this.settings.allowedSubjects.includes(subject)
    ) {
      throw new Error('token subject is not allowed');
    }

    const email =
      typeof verificationResult.payload.email === 'string'
        ? verificationResult.payload.email
        : undefined;

    if (
      this.settings.allowedEmails.length > 0 &&
      (!email || !this.settings.allowedEmails.includes(email))
    ) {
      throw new Error('token email is not allowed');
    }

    return {
      subject,
      email,
      scopes,
      claims: verificationResult.payload,
    };
  }

  private async getAuthorizationServerMetadata(): Promise<AuthorizationServerMetadata> {
    if (!this.authorizationServerMetadataPromise) {
      this.authorizationServerMetadataPromise = resolveAuthorizationServerMetadata(
        this.settings.issuerUrl,
      );
    }

    return await this.authorizationServerMetadataPromise;
  }
}

function joinGatewayUrl(baseUrl: string, resourcePath: string): string {
  const normalizedBaseUrl = baseUrl.replace(/\/+$/, '');
  const normalizedResourcePath = resourcePath.startsWith('/')
    ? resourcePath
    : `/${resourcePath}`;

  return `${normalizedBaseUrl}${normalizedResourcePath}`;
}

function extractScopes(payload: JWTPayload): string[] {
  if (typeof payload.scope === 'string') {
    return payload.scope.split(/\s+/).filter(Boolean);
  }

  if (Array.isArray(payload.scp)) {
    return payload.scp.filter((scope): scope is string => typeof scope === 'string');
  }

  return [];
}

function extractBearerToken(authorizationHeader: string | undefined): string | null {
  if (!authorizationHeader) {
    return null;
  }

  const [scheme, token] = authorizationHeader.split(/\s+/, 2);

  if (!scheme || !token || scheme.toLowerCase() !== 'bearer') {
    return null;
  }

  return token;
}

async function resolveAuthorizationServerMetadata(
  issuerUrl: string,
): Promise<AuthorizationServerMetadata> {
  const issuer = new URL(issuerUrl);
  const discoveryCandidates = buildDiscoveryCandidates(issuer);
  let lastError: Error | undefined;

  for (const discoveryCandidate of discoveryCandidates) {
    try {
      const response = await fetch(discoveryCandidate);
      if (!response.ok) {
        throw new Error(`metadata fetch failed with status ${String(response.status)}`);
      }

      const payload = authorizationServerMetadataSchema.parse(await response.json());
      return payload;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
    }
  }

  throw lastError || new Error('unable to resolve authorization server metadata');
}

function buildDiscoveryCandidates(issuer: URL): string[] {
  const normalizedPath = issuer.pathname.replace(/\/+$/, '');

  if (!normalizedPath || normalizedPath === '/') {
    return [
      new URL('/.well-known/oauth-authorization-server', issuer).toString(),
      new URL('/.well-known/openid-configuration', issuer).toString(),
    ];
  }

  const pathWithoutLeadingSlash = normalizedPath.replace(/^\/+/, '');

  return [
    new URL(
      `/.well-known/oauth-authorization-server/${pathWithoutLeadingSlash}`,
      issuer,
    ).toString(),
    new URL(
      `/.well-known/openid-configuration/${pathWithoutLeadingSlash}`,
      issuer,
    ).toString(),
    new URL(`${normalizedPath}/.well-known/openid-configuration`, issuer).toString(),
  ];
}

const authorizationServerMetadataSchema = {
  parse(payload: unknown): AuthorizationServerMetadata {
    if (!payload || typeof payload !== 'object') {
      throw new Error('authorization server metadata must be an object');
    }

    const candidate = payload as Record<string, unknown>;

    if (typeof candidate.issuer !== 'string') {
      throw new Error('authorization server metadata is missing issuer');
    }

    if (typeof candidate.jwks_uri !== 'string') {
      throw new Error('authorization server metadata is missing jwks_uri');
    }

    return {
      issuer: candidate.issuer,
      jwks_uri: candidate.jwks_uri,
    };
  },
};
