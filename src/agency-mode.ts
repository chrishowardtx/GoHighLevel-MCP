import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type {
  GHLApiResponse,
  GHLConfig,
  GHLLocationSearchResponse,
} from './types/ghl-types.js';

export const AGENCY_TOOL_NAMES = ['search_locations', 'get_location'] as const;

type AgencyToolName = (typeof AGENCY_TOOL_NAMES)[number];

export interface AgencyLocationTools {
  getToolDefinitions(): Tool[];
  executeTool(name: string, args: unknown): Promise<unknown>;
}

export interface AgencyConnectionClient {
  searchLocations(params?: {
    companyId?: string;
    skip?: number;
    limit?: number;
    order?: 'asc' | 'desc';
    email?: string;
  }): Promise<GHLApiResponse<GHLLocationSearchResponse>>;
}

export function createAgencyConfig(
  env: NodeJS.ProcessEnv = process.env,
): GHLConfig {
  const accessToken = env.GHL_AGENCY_API_KEY || '';
  if (!accessToken) {
    throw new Error('GHL_AGENCY_API_KEY environment variable is required');
  }

  return {
    accessToken,
    // Never allow inherited environment state to redirect a Keychain-backed bearer token.
    baseUrl: 'https://services.leadconnectorhq.com',
    version: '2021-07-28',
    // Agency mode has no default location. Location IDs must be explicit tool inputs.
    locationId: '',
  };
}

export function getAgencyToolDefinitions(
  locationTools: AgencyLocationTools,
): Tool[] {
  const allowed = new Set<string>(AGENCY_TOOL_NAMES);
  const definitions = locationTools
    .getToolDefinitions()
    .filter((tool) => allowed.has(tool.name));

  if (
    definitions.length !== AGENCY_TOOL_NAMES.length ||
    AGENCY_TOOL_NAMES.some((name) => !definitions.some((tool) => tool.name === name))
  ) {
    throw new Error('Agency tool definition invariant failed');
  }

  return definitions;
}

export async function executeAgencyTool(
  locationTools: AgencyLocationTools,
  name: string,
  args: unknown,
): Promise<unknown> {
  if (!AGENCY_TOOL_NAMES.includes(name as AgencyToolName)) {
    throw new Error(`Tool is not available in agency mode: ${name}`);
  }

  return locationTools.executeTool(name, args || {});
}

export async function testAgencyConnection(
  client: AgencyConnectionClient,
): Promise<number> {
  const result = await client.searchLocations({ limit: 1 });
  if (!result.success || !result.data) {
    throw new Error(result.error?.message || 'Agency location search failed');
  }

  return result.data.locations?.length || 0;
}
