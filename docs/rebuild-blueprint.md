# Full Access MCP Rebuild Blueprint

This document describes the only supported public setup path for this repository.

## 1. Goal

The system should let ChatGPT Developer Mode call a remote MCP endpoint, which delegates work to a local Windows workstation agent that can operate on the real machine.

```text
ChatGPT Developer Mode
-> remote gateway (/mcp)
-> local workstation agent
-> local files / terminal / current Chrome / Windows desktop
```

The public release must satisfy these constraints:

- no personal domains, tokens, or local screenshots in the repository
- one supported setup path
- enough detail for a new engineer or coding agent to rebuild the environment on another machine

For AI operator notes, read [docs/ai-operator-guide.md](ai-operator-guide.md) together with this blueprint.

## 2. Supported entry points

Read these files first:

```text
src/gatewayIndex.ts
src/agentIndex.ts
src/toolCatalog.ts
```

Treat these paths as legacy and unsupported for new deployment work:

```text
src/index.ts
src/fullAccessMcpServer.ts
src/chatGptUserscript.ts
src/localBridgeHttp.ts
src/localBridgeAuditTrail.ts
extension/
```

## 3. Runtime architecture

### Remote gateway

`src/gatewayIndex.ts` hosts:

- `POST /mcp` for the full-access MCP surface
- `POST /mcp-readonly` for the reduced read-only surface
- `GET /health` for liveness and workstation connectivity
- `POST /agent/poll` for the workstation agent task queue
- `POST /agent/tasks/:id/result` for task completion upload

The gateway is responsible for:

- OAuth / OIDC validation
- MCP transport session handling
- task queueing
- recent tool call tracking

### Local workstation agent

`src/agentIndex.ts` polls the gateway, executes the requested tool locally, and reports the result back to the gateway.

The agent depends on `src/localWorkstationRuntime.ts`, which wires together:

- `src/workspaceFileAccess.ts`
- `src/commandSessionRegistry.ts`
- `src/browserSessionRegistry.ts`
- `src/windowsDesktopAutomation.ts`
- `src/windowsSystemControl.ts`
- `src/toolCatalog.ts`

## 4. Environment variables

Copy `.env.example` to `.env` and fill in the values.

### Required values

| Variable | Purpose |
| --- | --- |
| `PUBLIC_GATEWAY_BASE_URL` | Public HTTPS base URL served through ngrok |
| `OIDC_ISSUER_URL` | Auth0 issuer URL |
| `OIDC_AUDIENCE` | OAuth audience for `/mcp` |
| `REMOTE_WORKSTATION_TOKEN` | Shared secret between gateway and agent |

These values are intentionally not committed. A new operator must ask the user for their own:

- Auth0 tenant / issuer URL
- ngrok reserved domain
- workstation token

### Common local execution values

| Variable | Default | Purpose |
| --- | --- | --- |
| `WORKSPACE_ROOTS` | `.` | Seed project roots for local file access |
| `ALLOW_COMPUTER_WIDE_ACCESS` | `false` | When `true`, any absolute local Windows path is allowed |
| `BROWSER_ENABLED` | `true` | Enables browser automation |
| `BROWSER_HEADLESS` | `true` | Headless mode for separate Playwright sessions |
| `CHROME_EXECUTABLE` | empty | Optional override for the local Chrome executable path |
| `CHROME_DEVTOOLS_USER_DATA_DIR` | `%LOCALAPPDATA%\full-access-mcp\chrome-devtools-mcp-profile` | Optional dedicated Chrome profile path for DevTools attachment |
| `CHROME_REMOTE_DEBUGGING_AUTO_ALLOW_ENABLED` | `true` | Auto-accepts Chrome remote debugging prompt |
| `CHATGPT_MCP_AUTO_ALLOW_ENABLED` | `true` | Auto-accepts ChatGPT MCP approval cards on the real Windows desktop |

## 5. External services

### Auth0

Create one API in Auth0:

```text
Name:
Full Access MCP Gateway

Identifier:
https://YOUR-NGROK-DOMAIN.ngrok-free.app/mcp

Signing algorithm:
RS256

JWT profile:
RFC 9068
```

Add the scope:

```text
mcp.full_access
```

Enable:

```text
Allow Offline Access = ON
Dynamic Client Registration = ON
Resource Parameter Compatibility Profile = ON
```

### ngrok

Use a reserved domain. Temporary tunnels are not stable enough for a reusable public setup.

```powershell
ngrok http 9797 --url=YOUR-NGROK-DOMAIN.ngrok-free.app
```

## 6. Local setup from scratch

### Step 1: install dependencies

```powershell
cd "C:\path\to\full-access-mcp-server"
npm install
npm run install:browsers
Copy-Item .env.example .env
```

### Step 2: build

```powershell
npm run build
```

### Step 3: run the gateway

```powershell
npm run gateway:start
```

### Step 4: run the agent

```powershell
npm run agent:start
```

### Step 5: expose the gateway publicly

```powershell
ngrok http 9797 --url=YOUR-NGROK-DOMAIN.ngrok-free.app
```

### Optional hidden runtime launcher

If you want `gateway`, `agent`, and optional `ngrok` to stay off-screen, use:

```powershell
npm run runtime:start
npm run runtime:status
npm run runtime:stop
```

`runtime:start` reads these optional `.env` values:

```text
NGROK_AUTOSTART=true|false
NGROK_URL=YOUR-NGROK-DOMAIN.ngrok-free.app
NGROK_EXECUTABLE=C:\Path\To\ngrok.exe
CHROME_EXECUTABLE=C:\Path\To\chrome.exe
CHROME_DEVTOOLS_USER_DATA_DIR=C:\Path\To\dedicated-chrome-profile
```

### Step 6: verify health

```powershell
Invoke-WebRequest -UseBasicParsing http://127.0.0.1:9797/health | Select-Object -ExpandProperty Content
```

Expected shape:

```json
{
  "ok": true,
  "oidcEnabled": true,
  "workstation": {
    "connected": true
  }
}
```

## 7. ChatGPT Developer Mode registration

Register the full-access connector with:

```text
MCP URL:
https://YOUR-NGROK-DOMAIN.ngrok-free.app/mcp

Authentication:
OAuth / OIDC

Issuer:
https://YOUR-AUTH0-TENANT.us.auth0.com/

Audience:
https://YOUR-NGROK-DOMAIN.ngrok-free.app/mcp

Scopes:
mcp.full_access offline_access
```

The optional read-only connector uses:

```text
https://YOUR-NGROK-DOMAIN.ngrok-free.app/mcp-readonly
```

## 8. Validation checklist

Run these commands after any setup or release change:

```powershell
npm run check
npm run test -- --runInBand
npm run build
```

Then validate the live server:

```powershell
Invoke-WebRequest -UseBasicParsing http://127.0.0.1:9797/health | Select-Object -ExpandProperty Content
npm run gateway:cli -- --path /mcp read-resource gateway://recent-tool-calls
```

## 9. Common failure modes

### ChatGPT Apps `Refresh` ran, but old tools or old approval wording still appear

Treat this as a stale runtime or stale app snapshot problem until proven otherwise.

Use this order:

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

- browser cache clear alone is not enough
- a new chat alone is not enough
- Apps `Refresh` alone is not enough if the old gateway process is still serving the previous tool surface

If removed tool names still appear after that sequence, compare the ChatGPT app view against the live `list-tools` output before changing code again.

### Health endpoint says `connected: false`

The agent is not polling the gateway. Check:

- `REMOTE_WORKSTATION_TOKEN` matches in gateway and agent
- `AGENT_GATEWAY_BASE_URL` points to `http://127.0.0.1:9797`
- only one gateway and one agent process are running

### ChatGPT connects but tools never run

Check:

- Auth0 audience matches the public `/mcp` URL
- ChatGPT app is attached in the current Developer Mode chat
- the gateway logs show incoming MCP requests

### Browser automation partially runs

The browser tool surface is intentionally split:

- `browser_*` tools operate on the real current Chrome session through DevTools
- `playwright_*` tools operate on a separate automation browser
- `desktop_*` tools operate on the native Windows UI

If one browser session goes stale, prefer the high-level tools in `docs/mcp-catalog.md` instead of manually chaining low-level browser calls.

### Approval watcher stopped matching after tool wording changed

The approval watcher derives its matcher contract from the published tool metadata. If tool names, titles, or descriptions changed:

1. rebuild
2. restart the runtime
3. refresh the ChatGPT app
4. test one real approval card again

Do not treat browser cache or a new chat as sufficient proof that the new contract is active.

## 10. Release rules

The public repository must never contain:

- `.env`
- runtime logs
- screenshots from private sessions
- ngrok tunnel logs
- Auth0 tenant values tied to a real user
- local absolute Windows paths in committed artifacts

The repository should always contain:

- a working `.env.example`
- `README.md`
- this blueprint
- `docs/mcp-catalog.md`
- `docs/ai-operator-guide.md`
- `docs/full-access-mcp-decision-log-2026-04-23.md`
- `AGENTS.md`
- `.github/copilot-instructions.md`
