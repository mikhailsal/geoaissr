import type { CatalogFeature } from './catalog.ts';
import { roleToolDefinitions, type Protocol, type Role, type ToolDefinition } from './protocol.ts';
import { reportToolDefinitions } from './report-protocol.ts';

/** The tool list of one role under any protocol. The server maps each token to one role. */
export function toolDefinitions(
  role: Role,
  catalog: readonly CatalogFeature[],
  protocol: Protocol,
): ToolDefinition[] {
  return protocol === 'report'
    ? reportToolDefinitions(role)
    : roleToolDefinitions(role, catalog, protocol);
}
