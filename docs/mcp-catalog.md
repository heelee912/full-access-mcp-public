# MCP Catalog

This repository exposes two MCP surfaces through `src/gatewayIndex.ts`.

Important:

- the live gateway is the source of truth
- published remote tool names can differ from the internal names in `src/toolCatalog.ts`
- if this document and `npm run gateway:cli -- --path /mcp list-tools` disagree, the live list wins

## Full-access surface

Endpoint:

```text
/mcp
```

Current live tool count:

```text
78
```

### 1. Gateway status

```text
server_describe
```

Use this first to confirm:

- workstation connectivity
- workspace roots
- computer-wide access
- current browser lane availability

### 2. Local context and project tools

```text
workspace_list_entries
workspace_read_text
local_context_content_apply
local_context_content_update
local_context_prepare
local_context_sync
local_context_retarget
local_context_update
workspace_stat_path
workspace_search_text
workspace_describe_project
workspace_review_project
workspace_collect_project_context
workspace_collect_text_files
workspace_suggest_smoke_commands
local_context_entry_prepare
```

Use these for:

- project inspection
- targeted file reads
- local file creation and edits
- local path copy, move, delete, and directory preparation

Recommended first choices:

```text
workspace_describe_project
workspace_review_project
workspace_collect_project_context
workspace_search_text
```

### 3. Local Codex session artifact tools

```text
codex_list_session_artifacts
codex_describe_session_artifact
```

Use these for:

- local Codex Desktop session inspection
- prior local artifact lookup

### 4. Local terminal tools

```text
local_terminal_session
local_terminal_script
local_terminal_channel
command_read_session
local_terminal_channel_input
local_terminal_channel_update
```

Use these for:

- one-shot shell commands
- multi-line shell scripts
- interactive terminal session lifecycle

Recommended first choices:

```text
local_terminal_session
local_terminal_script
local_terminal_channel
```

### 5. Current Chrome / DevTools browser tools

```text
local_browser_session
local_browser_query
browser_open_session
browser_attach_selected_page
local_browser_confirm
browser_list_pages
local_browser_session_update
browser_select_page
browser_snapshot
browser_wait_for_text
local_browser_pointer
local_browser_input
local_browser_input_key
browser_evaluate
local_browser_context
browser_close_session
```

Use these for:

- current Chrome / DevTools browser automation
- high-level navigation and search
- selected-page attachment
- DOM snapshot and evaluation
- current page screenshot and interaction

Recommended first choices:

```text
browser_open_session
browser_attach_selected_page
browser_snapshot
browser_list_pages
```

Notes:

- `local_browser_query` is the published alias for the high-level Google search helper
- `local_browser_confirm` is the browser-side approval helper lane
- `browser_*` names are generally the stable DevTools lane names

### 6. Separate Playwright browser tools

```text
playwright_open_session
local_playwright_session_update
playwright_snapshot
playwright_wait_for_text
local_playwright_pointer
local_playwright_input
local_playwright_input_key
playwright_evaluate
local_playwright_context
playwright_close_session
```

Use these for:

- a separate automation browser
- flows where the current Chrome session is not the right target

Recommended first choices:

```text
playwright_open_session
playwright_snapshot
```

### 7. Native Windows desktop tools

```text
desktop_list_windows
desktop_get_foreground_window
local_desktop_focus
local_desktop_input_commit
local_desktop_input_keys
local_desktop_input_text
local_desktop_pointer
local_desktop_pointer_move
local_desktop_pointer_scroll
local_desktop_pointer_drag
desktop_get_cursor_position
local_desktop_context
desktop_inspect_elements
local_desktop_confirm_debug
local_desktop_confirm
local_desktop_element_apply
local_desktop_element_input
```

Use these for:

- real Windows desktop automation
- native dialog handling
- visible approval-card interaction
- screen capture and UI element inspection

Recommended first choices:

```text
local_desktop_focus
local_desktop_input_commit
desktop_inspect_elements
local_desktop_confirm
```

Notes:

- `local_desktop_context` is the published desktop screenshot tool
- `local_desktop_confirm` is the ChatGPT MCP approval watcher helper
- `local_desktop_confirm_debug` is the Chrome remote-debugging approval helper

### 8. Windows system tools

```text
system_wait
system_read_clipboard
local_system_buffer_apply
system_list_processes
local_system_session_update
local_system_session
local_system_notify
system_get_registry_value
local_system_settings_apply
local_system_settings_update
```

Use these for:

- waits and pacing
- clipboard reads and writes
- process inspection and termination
- application launch
- notifications
- registry reads and writes

Recommended first choices:

```text
system_wait
system_read_clipboard
local_system_session
```

## Read-only surface

Endpoint:

```text
/mcp-readonly
```

Current live tool count:

```text
5
```

Tools:

```text
server_describe
workspace_stat_path
workspace_search_text
workspace_read_text
workspace_describe_project
```

This surface exists for low-risk inspection flows. The main supported deployment path is still the full-access surface.

## What a future AI operator should use first

### Runtime and health

```text
server_describe
```

### Project understanding

```text
workspace_describe_project
workspace_review_project
workspace_collect_project_context
workspace_search_text
```

### Local file edits

```text
local_context_content_apply
local_context_content_update
local_context_prepare
local_context_entry_prepare
```

### Terminal execution

```text
local_terminal_session
local_terminal_script
local_terminal_channel
```

### Current Chrome / DevTools browser work

```text
browser_open_session
browser_attach_selected_page
browser_snapshot
browser_list_pages
```

### Separate Playwright work

```text
playwright_open_session
playwright_snapshot
```

### Native desktop fallback and approvals

```text
local_desktop_focus
local_desktop_input_commit
local_desktop_confirm
local_desktop_confirm_debug
```

## Source of truth

If this document and code disagree, the live published surface wins:

```powershell
npm run gateway:cli -- --path /mcp list-tools
npm run gateway:cli -- --path /mcp-readonly list-tools
```

Then compare against:

```text
src/toolCatalog.ts
src/readOnlyGatewayToolCatalog.ts
src/remoteGatewayMcpServer.ts
```
