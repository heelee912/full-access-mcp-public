import assert from 'node:assert/strict';
import test from 'node:test';

import {
  readOnlyGatewayToolNames,
  selectReadOnlyGatewayToolDefinitions,
} from '../src/readOnlyGatewayToolCatalog.js';
import type { FullAccessToolDefinition } from '../src/toolCatalog.js';

test('selectReadOnlyGatewayToolDefinitions returns the exact read-only allowlist order', () => {
  const sourceToolDefinitions = readOnlyGatewayToolNames.map(
    (toolName): FullAccessToolDefinition => ({
      name: toolName,
      description: `${toolName} description`,
      annotations: {
        readOnlyHint: true,
      },
      execute: async () => undefined,
    }),
  );

  const selectedToolDefinitions =
    selectReadOnlyGatewayToolDefinitions(sourceToolDefinitions);

  assert.deepEqual(
    selectedToolDefinitions.map((toolDefinition) => toolDefinition.name),
    [...readOnlyGatewayToolNames],
  );
});

test('selectReadOnlyGatewayToolDefinitions fails fast when a required tool is missing', () => {
  const sourceToolDefinitions: FullAccessToolDefinition[] = [
    {
      name: 'server_describe',
      description: 'status',
      annotations: {
        readOnlyHint: true,
      },
      execute: async () => undefined,
    },
  ];

  assert.throws(
    () => selectReadOnlyGatewayToolDefinitions(sourceToolDefinitions),
    /read-only gateway tool "workspace_stat_path" is missing/i,
  );
});
