# AGENTS

This repository has one supported deployment path:

```text
ChatGPT Developer Mode
-> remote gateway (src/gatewayIndex.ts)
-> local workstation agent (src/agentIndex.ts)
-> local Windows workstation tools (src/toolCatalog.ts)
```

## Read first

When working in this repository, start with:

```text
README.md
docs/rebuild-blueprint.md
docs/mcp-catalog.md
```

## Source of truth

- `src/gatewayIndex.ts`: remote MCP gateway
- `src/agentIndex.ts`: local workstation agent
- `src/toolCatalog.ts`: full-access tool surface
- `src/readOnlyGatewayToolCatalog.ts`: read-only tool surface

If documentation and code disagree, the code wins.

## Supported workflow

Use only the supported public path above for new work, reviews, and setup guidance.

## Unsupported legacy workflow

Do not propose or extend these paths for new setups:

```text
src/index.ts
src/fullAccessMcpServer.ts
src/chatGptUserscript.ts
src/localBridgeHttp.ts
src/localBridgeAuditTrail.ts
extension/
```

Legacy code may remain in the repository for compatibility or migration reasons, but it is not the supported deployment target.

## Build and test

Use the existing scripts:

```text
npm run check
npm run test
npm run build
```

## Security and release hygiene

Never commit:

- `.env`
- runtime logs
- screenshots from private sessions
- ngrok tunnel logs
- real Auth0 tenant values tied to a user
- secrets or access tokens

Keep `.env.example`, README, and the rebuild blueprint aligned with the supported path.
