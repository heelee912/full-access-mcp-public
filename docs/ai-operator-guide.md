# AI Operator Guide

This document is for a future Codex or coding agent that needs to deploy, repair, or operate this repository without repeating the wrong turns already explored here.

Read this before changing code, docs, or runtime settings.

## 1. Supported path only

The only supported deployment path is:

```text
ChatGPT Developer Mode
-> remote gateway (src/gatewayIndex.ts)
-> local workstation agent (src/agentIndex.ts)
-> local Windows workstation tools (src/toolCatalog.ts)
```

Use these files as the source of truth:

```text
src/gatewayIndex.ts
src/agentIndex.ts
src/toolCatalog.ts
src/readOnlyGatewayToolCatalog.ts
```

Read these documents in this order:

1. `README.md`
2. `docs/rebuild-blueprint.md`
3. `docs/mcp-catalog.md`
4. `docs/full-access-mcp-decision-log-2026-04-23.md`
5. `AGENTS.md`

## 2. What the repository does not include

This public repository is sanitized. It does not include the operator's real:

- Auth0 tenant values
- ngrok reserved domain
- workstation token
- local screenshots, logs, or private browsing artifacts
- personal account names

Do not invent those values. Ask the user for them.

At minimum, the operator must supply:

```text
PUBLIC_GATEWAY_BASE_URL
OIDC_ISSUER_URL
OIDC_AUDIENCE
REMOTE_WORKSTATION_TOKEN
```

## 3. Clean rebuild procedure

From a clean clone:

```powershell
cd "C:\path\to\full-access-mcp-server"
npm install
npm run install:browsers
Copy-Item .env.example .env
```

Fill `.env` with the user's own values.

Then build and start the runtime:

```powershell
npm run check
npm run test -- --runInBand
npm run build
npm run runtime:start
npm run runtime:status
```

Confirm the live server, not just local source code:

```powershell
Invoke-WebRequest -UseBasicParsing http://127.0.0.1:9797/health | Select-Object -ExpandProperty Content
npm run gateway:cli -- --path /mcp list-tools
npm run developer-mode:print
```

If `workstation.connected` is not `true`, stop and repair the runtime before touching ChatGPT Web.

## 4. ChatGPT Web registration and refresh rules

When registering or updating the app in ChatGPT Developer Mode:

- use the operator's own Auth0 values
- use the operator's own ngrok domain
- register the full-access path at `/mcp`
- optionally register the reduced read-only path at `/mcp-readonly`

If the tool surface, tool naming, or approval wording changed, use this exact order:

```powershell
npm run build
npm run runtime:stop
npm run runtime:start
npm run runtime:status
npm run gateway:cli -- --path /mcp list-tools
```

Then in ChatGPT Web:

1. Open `Settings -> Apps -> Full Access MCP`
2. Press `Refresh`
3. Start a new chat

Important:

- a new chat alone is not enough
- browser cache clear alone is not enough
- Apps `Refresh` alone is not enough if the gateway process is stale

If removed tool names still appear after `Refresh`, assume stale runtime first and compare the ChatGPT app view against the live `list-tools` output.

## 5. Approval watcher operating rules

This repository now relies on the approval watcher path rather than trying to suppress confirmation entirely.

Relevant `.env` flags:

```text
CHROME_REMOTE_DEBUGGING_AUTO_ALLOW_ENABLED=true
CHATGPT_MCP_AUTO_ALLOW_ENABLED=true
```

What those flags do:

- they allow the watcher to automatically approve visible confirmation cards
- they do not suppress ChatGPT confirmation policy by themselves

What changes can break matching:

- published tool names
- tool titles
- tool descriptions
- ChatGPT-generated approval wording

The watcher matcher is supposed to stay aligned with published tool metadata. If approval cards stop matching:

1. verify the live tool metadata first
2. verify the runtime was freshly restarted
3. verify the ChatGPT app was refreshed
4. only then patch matcher logic

Do not assume that a browser issue means the code is wrong. Stale runtime and stale app snapshots were real failure modes in this repository.

Useful logs:

```text
.runtime/agent.out.log
.runtime/agent.err.log
.runtime/gateway.out.log
.runtime/gateway.err.log
```

## 6. Live source of truth rules

For deployment and operator work, the live runtime wins over stale docs.

Use these live checks before making architectural claims:

```powershell
npm run runtime:status
npm run gateway:cli -- --path /mcp list-tools
npm run gateway:cli -- --path /mcp-readonly list-tools
npm run gateway:cli -- --path /mcp read-resource gateway://recent-tool-calls
```

Two important details:

1. `src/toolCatalog.ts` internal tool names are not always the same as the published names in ChatGPT. The remote gateway can publish aliases.
2. ChatGPT Apps can hold onto an old snapshot even after code changes. Always check both live `list-tools` output and the app view.

## 7. Paths and approaches that are intentionally discarded

These are the main dead ends already explored and should not be revived casually.

### 7.1 Unsupported legacy deployment path

Do not build new setup guidance around:

```text
src/index.ts
src/fullAccessMcpServer.ts
src/chatGptUserscript.ts
src/localBridgeHttp.ts
src/localBridgeAuditTrail.ts
extension/
```

They may still exist for compatibility or migration, but they are not the supported path.

### 7.2 Metadata/title/name concealment to suppress confirmations

This was pushed too far and then abandoned.

Why it was rejected:

- ChatGPT does not appear to rely only on raw MCP annotations
- it also interprets tool family and capability semantics
- aggressive concealment degraded tool clarity and did not eliminate confirmations reliably

Use the watcher path instead of trying to hide capability semantics.

### 7.3 `local_session_execute` single-writer tool

This was implemented and then discarded.

Why it was rejected:

- ChatGPT still invoked it multiple times for one user task
- approval friction moved from many tool names to repeated invocations of the same tool
- it did not reliably collapse approval into one user-visible confirmation

### 7.4 Queue / daemon public contract

A file-backed queue watcher is viable internally, but it was rejected as the primary public contract for this repository.

Why it was rejected:

- the current blocker was not lack of orchestration
- the real blocker was approval-card handling and stale runtime / app state
- adding a new public contract would have increased drift without solving the main operational problem

### 7.5 Over-broad approval matching

Generic action matching like `click`, `scroll`, or humanized tool-name fragments caused false positives and focus leaks.

The current direction is:

- approval contract derived from published tool metadata
- action matching narrowed to actual approval labels
- browser and desktop watcher paths consuming the same contract

Do not reintroduce loose substring matching for generic UI verbs.

## 8. Current operator guidance for future AI

If the user asks for a deployable or repairable setup:

1. verify runtime health
2. verify live published tool surface
3. only then touch docs or matcher logic

If the user says "Refresh did not help":

1. assume stale runtime is still possible
2. do a full `build -> runtime:stop -> runtime:start -> runtime:status`
3. compare live `list-tools` against the ChatGPT Apps view

If the user asks whether a public release is safe:

- confirm no personal Auth0 values, ngrok domains, workstation tokens, runtime logs, or screenshots are committed
- confirm `.env.example`, `README.md`, `docs/rebuild-blueprint.md`, `docs/mcp-catalog.md`, and this guide stay aligned

If the user asks why an old path was abandoned:

- answer from `docs/full-access-mcp-decision-log-2026-04-23.md`
- do not re-explore rejected paths without a new concrete blocker or new evidence

## 9. Release hygiene checklist

Before pushing:

```powershell
git status --short
npm run check
npm run test -- --runInBand
npm run build
```

Never commit:

- `.env`
- `.runtime/*`
- ngrok logs
- screenshots from private sessions
- any Auth0 issuer, audience, or tenant values tied to a real user
- any reserved ngrok domain tied to a real user
- workstation tokens

For release review, ask for a security-focused pass that checks:

- private values are not committed
- approval watcher changes do not broaden unintended UI matches
- published tool metadata and docs stay aligned
