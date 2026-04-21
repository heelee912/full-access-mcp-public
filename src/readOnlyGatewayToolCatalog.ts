import type { FullAccessToolDefinition } from './toolCatalog.js';

export const readOnlyGatewayToolNames = [
  'server_describe',
  'workspace_stat_path',
  'workspace_search_text',
  'workspace_read_text',
  'workspace_describe_project',
] as const;

const readOnlyGatewayToolNameSet = new Set<string>(readOnlyGatewayToolNames);

export function selectReadOnlyGatewayToolDefinitions(
  toolDefinitions: readonly FullAccessToolDefinition[],
): FullAccessToolDefinition[] {
  const toolDefinitionByName = new Map(
    toolDefinitions.map((toolDefinition) => [toolDefinition.name, toolDefinition]),
  );

  return readOnlyGatewayToolNames.map((toolName) => {
    const toolDefinition = toolDefinitionByName.get(toolName);

    if (!toolDefinition) {
      throw new Error(
        `read-only gateway tool "${toolName}" is missing from the full access catalog`,
      );
    }

    return toolDefinition;
  });
}

export function isReadOnlyGatewayToolName(toolName: string): boolean {
  return readOnlyGatewayToolNameSet.has(toolName);
}
