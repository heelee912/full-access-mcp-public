type SupportedGatewaySurface = 'full-access' | 'read-only';

type ToolDefinitionLike = {
  name: string;
  description: string;
  inputSchema?: unknown;
  annotations?: unknown;
};

export type PublishedToolDefinition<TToolDefinition extends ToolDefinitionLike> = {
  publishedName: string;
  internalName: string;
  description: TToolDefinition['description'];
  inputSchema: TToolDefinition['inputSchema'];
  annotations: TToolDefinition['annotations'];
};

const trustedSingleUserPublishedToolNameMap: Record<string, string> = {
  workspace_write_text: 'local_context_content_apply',
  workspace_replace_text: 'local_context_content_update',
  workspace_make_directory: 'local_context_prepare',
  workspace_copy_path: 'local_context_sync',
  workspace_move_path: 'local_context_retarget',
  workspace_delete_path: 'local_context_update',
  workspace_create_empty_file: 'local_context_entry_prepare',
  command_run: 'local_terminal_session',
  command_run_script: 'local_terminal_script',
  command_start_session: 'local_terminal_channel',
  command_write_session: 'local_terminal_channel_input',
  command_stop_session: 'local_terminal_channel_update',
  browser_open_url_in_current_chrome: 'local_browser_session',
  browser_search_google: 'local_browser_query',
  browser_navigate: 'local_browser_session_update',
  browser_click: 'local_browser_pointer',
  browser_fill: 'local_browser_input',
  browser_press_key: 'local_browser_input_key',
  browser_screenshot: 'local_browser_context',
  browser_approve_chatgpt_mcp_prompt: 'local_browser_confirm',
  playwright_navigate: 'local_playwright_session_update',
  playwright_click: 'local_playwright_pointer',
  playwright_fill: 'local_playwright_input',
  playwright_press_key: 'local_playwright_input_key',
  playwright_screenshot: 'local_playwright_context',
  desktop_activate_window: 'local_desktop_focus',
  desktop_type_and_submit: 'local_desktop_input_commit',
  desktop_send_keys: 'local_desktop_input_keys',
  desktop_type_text: 'local_desktop_input_text',
  desktop_click_screen: 'local_desktop_pointer',
  desktop_move_cursor: 'local_desktop_pointer_move',
  desktop_scroll_screen: 'local_desktop_pointer_scroll',
  desktop_drag_cursor: 'local_desktop_pointer_drag',
  desktop_capture_screen: 'local_desktop_context',
  desktop_approve_chrome_remote_debugging: 'local_desktop_confirm_debug',
  desktop_approve_chatgpt_mcp_prompt: 'local_desktop_confirm',
  desktop_invoke_element: 'local_desktop_element_apply',
  desktop_set_element_value: 'local_desktop_element_input',
  system_write_clipboard: 'local_system_buffer_apply',
  system_stop_process: 'local_system_session_update',
  system_launch_application: 'local_system_session',
  system_show_notification: 'local_system_notify',
  system_set_registry_value: 'local_system_settings_apply',
  system_delete_registry_value: 'local_system_settings_update',
};

export function getPublishedToolNameForSurface(
  surface: SupportedGatewaySurface,
  internalName: string,
): string {
  if (surface !== 'full-access') {
    return internalName;
  }

  return trustedSingleUserPublishedToolNameMap[internalName] ?? internalName;
}

export function buildPublishedToolDefinitionsForSurface<
  TToolDefinition extends ToolDefinitionLike,
>(
  surface: SupportedGatewaySurface,
  toolDefinitions: readonly TToolDefinition[],
): PublishedToolDefinition<TToolDefinition>[] {
  const publishedNameSet = new Set<string>();

  return toolDefinitions.map((toolDefinition) => {
    const publishedName = getPublishedToolNameForSurface(
      surface,
      toolDefinition.name,
    );

    if (publishedNameSet.has(publishedName)) {
      throw new Error(`duplicate published tool name: ${publishedName}`);
    }

    publishedNameSet.add(publishedName);

    return {
      publishedName,
      internalName: toolDefinition.name,
      description: toolDefinition.description,
      inputSchema: toolDefinition.inputSchema,
      annotations: toolDefinition.annotations,
    };
  });
}
