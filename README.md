# Full Access MCP Server

Full Access MCP Server exposes a local Windows workstation to ChatGPT Developer Mode through a remote Streamable HTTP MCP gateway. The supported deployment path is:

```text
ChatGPT Developer Mode
-> remote HTTPS MCP gateway
-> local workstation agent
-> local files / terminal / current Chrome / Windows desktop
```

This public release is sanitized for GitHub:

- no personal tokens, domains, or account identifiers are committed
- runtime logs, screenshots, and local output are excluded from version control
- only one setup path is documented and supported

## Supported deployment path

Use only this path:

```text
src/gatewayIndex.ts
src/agentIndex.ts
src/toolCatalog.ts
```

Do not use the legacy localhost bridge or userscript path for new setups.

## Repository guide

Start here, in this order:

1. [docs/ai-operator-guide.md](docs/ai-operator-guide.md)
   - AI / Codex operator runbook
   - user-supplied Auth0 and ngrok values
   - stale runtime and ChatGPT Apps `Refresh` handling
   - abandoned paths and dead ends to avoid
2. [docs/rebuild-blueprint.md](docs/rebuild-blueprint.md)
   - architecture
   - environment variables
   - Auth0 and ngrok setup
   - ChatGPT Developer Mode registration
   - validation and troubleshooting
3. [docs/mcp-catalog.md](docs/mcp-catalog.md)
   - full tool inventory
   - read-only surface
   - published remote tool names
   - lane-specific recommendations
4. [docs/full-access-mcp-decision-log-2026-04-23.md](docs/full-access-mcp-decision-log-2026-04-23.md)
   - discarded experiments
   - why they were rejected
5. [AGENTS.md](AGENTS.md)
   - instructions for coding agents and repository AI tools

## Quick start

### Prerequisites

- Windows
- Node.js 22 or newer
- npm
- ChatGPT account with Developer Mode access
- Auth0 tenant for OAuth / OIDC
- ngrok reserved domain

### Install

```powershell
cd "C:\path\to\full-access-mcp-server"
npm install
npm run install:browsers
Copy-Item .env.example .env
```

Fill in `.env` using the comments in [.env.example](.env.example).

The public repository is sanitized. The operator must provide their own values for:

- Auth0 issuer and audience
- ngrok reserved domain
- workstation token shared between gateway and agent

Browser automation notes:

- Chrome DevTools attachment uses a dedicated Chrome profile, not the user's everyday profile
- you can override Chrome discovery with `CHROME_EXECUTABLE`
- you can override the dedicated profile location with `CHROME_DEVTOOLS_USER_DATA_DIR`

### Run locally

Preferred hidden runtime launcher:

```powershell
npm run build
npm run runtime:start
```

Stop and inspect:

```powershell
npm run runtime:status
npm run runtime:stop
```

If the tool surface changed, do not assume `Refresh` alone is enough. Use this sequence:

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

New chat, browser cache clear, or Apps `Refresh` alone is not always enough when the runtime itself is stale.

Manual split-process path:

Terminal 1:

```powershell
cd "C:\path\to\full-access-mcp-server"
npm run build
npm run gateway:start
```

Terminal 2:

```powershell
cd "C:\path\to\full-access-mcp-server"
npm run agent:start
```

Terminal 3:

```powershell
ngrok http 9797 --url=YOUR-NGROK-DOMAIN.ngrok-free.app
```

### Validate

```powershell
npm run check
npm run test -- --runInBand
npm run build
Invoke-WebRequest -UseBasicParsing http://127.0.0.1:9797/health | Select-Object -ExpandProperty Content
npm run gateway:cli -- --path /mcp list-tools
```

Healthy output must include:

```json
{
  "ok": true,
  "workstation": {
    "connected": true
  }
}
```

## Commands

| Command | Purpose |
| --- | --- |
| `npm run check` | Type-check without emitting build output |
| `npm run test` | Run the test suite |
| `npm run build` | Build the TypeScript project |
| `npm run gateway:start` | Run the remote MCP gateway |
| `npm run agent:start` | Run the local workstation agent |
| `npm run runtime:start` | Start gateway, agent, and optional ngrok as hidden background processes |
| `npm run runtime:stop` | Stop the hidden runtime stack |
| `npm run runtime:status` | Show hidden runtime stack status and health |
| `npm run gateway:cli` | Inspect the live gateway from the terminal |
| `npm run developer-mode:print` | Print MCP registration metadata |

## Project structure

```text
src/gatewayIndex.ts
  Remote HTTPS gateway for ChatGPT Developer Mode

src/agentIndex.ts
  Local workstation agent loop

src/toolCatalog.ts
  Public MCP tool surface

src/browserSessionRegistry.ts
  Current Chrome and Playwright automation

src/windowsDesktopAutomation.ts
  Native Windows desktop automation

src/workspaceFileAccess.ts
  File and folder access rules

src/commandSessionRegistry.ts
  Terminal command execution and interactive sessions
```

## Unsupported legacy path

The following code may still exist in the repository for historical reasons, but it is not part of the supported deployment path and should not be used for a new installation:

```text
src/index.ts
src/fullAccessMcpServer.ts
src/chatGptUserscript.ts
src/localBridgeHttp.ts
src/localBridgeAuditTrail.ts
extension/
```

If you are building or reviewing this project, ignore those paths unless you are intentionally removing legacy code.

## Operator note

If a future AI is operating this repository, treat the live gateway as the source of truth:

- `npm run runtime:status`
- `npm run gateway:cli -- --path /mcp list-tools`
- `npm run developer-mode:print`

Do not assume ChatGPT Web has already picked up tool changes. A fresh runtime plus Apps `Refresh` is part of the normal deployment workflow.
