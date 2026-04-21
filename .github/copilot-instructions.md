Use the supported public deployment path only: `src/gatewayIndex.ts` + `src/agentIndex.ts` + `src/toolCatalog.ts`.

Do not recommend or extend the legacy localhost bridge or userscript path. Treat these as unsupported for new work:

- `src/index.ts`
- `src/fullAccessMcpServer.ts`
- `src/chatGptUserscript.ts`
- `src/localBridgeHttp.ts`
- `src/localBridgeAuditTrail.ts`
- `extension/`

Before changing code, read:

- `README.md`
- `docs/rebuild-blueprint.md`
- `docs/mcp-catalog.md`
- `AGENTS.md`

For validation, prefer:

- `npm run check`
- `npm run test`
- `npm run build`

When reviewing code, prioritize:

1. security of local workstation access
2. correctness of the remote gateway and agent contract
3. clarity of the public setup path
4. avoiding secrets, runtime logs, screenshots, and private local paths in the repository

When suggesting browser automation changes, prefer the high-level tools in `src/toolCatalog.ts` over low-level multi-step chains.
