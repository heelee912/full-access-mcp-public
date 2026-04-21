# MCP Catalog

This repository exposes two MCP surfaces through `src/gatewayIndex.ts`.

## Full-access surface

Endpoint:

```text
/mcp
```

Tool count:

```text
77
```

### 1. Server status

```text
server_describe
```

### 2. Workspace and project tools

```text
workspace_list_entries
workspace_read_text
workspace_write_text
workspace_replace_text
workspace_make_directory
workspace_copy_path
workspace_move_path
workspace_delete_path
workspace_stat_path
workspace_search_text
workspace_describe_project
workspace_review_project
workspace_collect_project_context
workspace_collect_text_files
workspace_suggest_smoke_commands
workspace_create_empty_file
```

Purpose:

- inspect a local project
- search or edit files
- create, move, or delete local paths
- collect high-level project context for review

### 3. Codex session tools

```text
codex_list_session_artifacts
codex_describe_session_artifact
```

Purpose:

- inspect local Codex session JSONL artifacts
- compare a local project with prior local agent sessions

### 4. Command and process tools

```text
command_run
command_run_script
command_start_session
command_read_session
command_write_session
command_stop_session
```

Purpose:

- run one-shot shell commands
- run multi-line scripts
- manage interactive terminal sessions

### 5. Current Chrome tools

```text
browser_open_url_in_current_chrome
browser_search_google
browser_open_session
browser_attach_selected_page
browser_approve_chatgpt_mcp_prompt
browser_list_pages
browser_navigate
browser_select_page
browser_snapshot
browser_wait_for_text
browser_click
browser_fill
browser_press_key
browser_evaluate
browser_screenshot
browser_close_session
```

Purpose:

- attach to the real current Google Chrome session on the local Windows machine
- automate the live page the user already has open
- perform high-level browser actions without manually managing all low-level steps

Recommended first choices:

```text
browser_open_url_in_current_chrome
browser_search_google
browser_attach_selected_page
browser_snapshot
```

### 6. Separate Playwright browser tools

```text
playwright_open_session
playwright_navigate
playwright_snapshot
playwright_wait_for_text
playwright_click
playwright_fill
playwright_press_key
playwright_evaluate
playwright_screenshot
playwright_close_session
```

Purpose:

- use a separate automation browser when the user's live Chrome session is not the right target

### 7. Native Windows desktop tools

```text
desktop_list_windows
desktop_get_foreground_window
desktop_activate_window
desktop_type_and_submit
desktop_send_keys
desktop_type_text
desktop_click_screen
desktop_move_cursor
desktop_scroll_screen
desktop_drag_cursor
desktop_get_cursor_position
desktop_capture_screen
desktop_inspect_elements
desktop_approve_chrome_remote_debugging
desktop_invoke_element
desktop_set_element_value
```

Purpose:

- inspect and control the real Windows desktop UI
- activate windows, type text, submit keys, and handle native dialogs

Recommended first choices:

```text
desktop_activate_window
desktop_type_and_submit
desktop_inspect_elements
desktop_approve_chrome_remote_debugging
```

### 8. Windows system tools

```text
system_wait
system_read_clipboard
system_write_clipboard
system_list_processes
system_stop_process
system_launch_application
system_show_notification
system_get_registry_value
system_set_registry_value
system_delete_registry_value
```

Purpose:

- clipboard control
- process inspection and termination
- application launch
- registry inspection and updates

## Read-only surface

Endpoint:

```text
/mcp-readonly
```

Tool count:

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

This surface exists for low-risk inspection flows. It is optional. The primary supported deployment path for this repository is still the full-access surface.

## What an agent should use first

### Project understanding

```text
server_describe
workspace_describe_project
workspace_collect_project_context
workspace_review_project
```

### Local file edits

```text
workspace_read_text
workspace_write_text
workspace_replace_text
workspace_create_empty_file
```

### Local shell execution

```text
command_run
command_run_script
command_start_session
```

### Current Chrome actions

```text
browser_open_url_in_current_chrome
browser_search_google
browser_attach_selected_page
```

### Native desktop fallback

```text
desktop_activate_window
desktop_type_and_submit
desktop_send_keys
```

## Source of truth

If this document and the code disagree, the code wins.

```text
src/toolCatalog.ts
src/readOnlyGatewayToolCatalog.ts
```
