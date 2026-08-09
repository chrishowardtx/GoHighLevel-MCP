import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type {
  GHLApiResponse,
  GHLCompanyResponse,
  GHLConfig,
  GHLLocationSearchResponse,
  GHLSnapshotsResponse,
  GHLUsersSearchResponse,
} from './types/ghl-types.js';

const OFFICIAL_GHL_BASE_URL = 'https://services.leadconnectorhq.com';

export const AGENCY_TOOL_NAMES = [
  'search_locations',
  'get_location',
  'agency_get_company',
  'agency_search_users',
  'agency_get_snapshots',
  'agency_capability_report',
] as const;

type AgencyToolName = (typeof AGENCY_TOOL_NAMES)[number];

export interface AgencyConfig {
  apiConfig: GHLConfig;
  companyId: string;
}

export interface AgencyLocationTools {
  getToolDefinitions(): Tool[];
  executeTool(name: string, args: unknown): Promise<unknown>;
}

export interface AgencyApiClient {
  getCompany(companyId: string): Promise<GHLApiResponse<GHLCompanyResponse>>;
  searchUsers(params: {
    companyId: string;
    locationId?: string;
  }): Promise<GHLApiResponse<GHLUsersSearchResponse>>;
  getSnapshots(): Promise<GHLApiResponse<GHLSnapshotsResponse>>;
  searchLocations(params?: {
    companyId?: string;
    skip?: number;
    limit?: number;
    order?: 'asc' | 'desc';
    email?: string;
  }): Promise<GHLApiResponse<GHLLocationSearchResponse>>;
}

const agencyInventoryDefinitions: Tool[] = [
  {
    name: 'agency_get_company',
    description: 'Read the configured agency/company identity.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'agency_search_users',
    description: 'List users belonging to the configured agency/company.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'agency_get_snapshots',
    description: 'List snapshots visible to the configured agency token.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'agency_capability_report',
    description:
      'Run harmless reads against company, locations, users, and snapshots and summarize supported inventory capabilities.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
];

export function createAgencyConfig(
  env: NodeJS.ProcessEnv = process.env,
): AgencyConfig {
  const accessToken = env.GHL_AGENCY_API_KEY || '';
  const companyId = env.GHL_EXPECTED_COMPANY_ID || '';
  if (!accessToken) {
    throw new Error('GHL_AGENCY_API_KEY environment variable is required');
  }
  if (!companyId) {
    throw new Error('GHL_EXPECTED_COMPANY_ID environment variable is required');
  }

  return {
    apiConfig: {
      accessToken,
      // Never allow inherited environment state to redirect a Keychain-backed bearer token.
      baseUrl: OFFICIAL_GHL_BASE_URL,
      version: '2021-07-28',
      // Agency mode has no default location. Location IDs must be explicit tool inputs.
      locationId: '',
    },
    companyId,
  };
}

export function getAgencyToolDefinitions(
  locationTools: AgencyLocationTools,
): Tool[] {
  const locationToolNames = new Set<string>(['search_locations', 'get_location']);
  const locationDefinitions = locationTools
    .getToolDefinitions()
    .filter((tool) => locationToolNames.has(tool.name));

  if (
    locationDefinitions.length !== locationToolNames.size ||
    [...locationToolNames].some(
      (name) => !locationDefinitions.some((tool) => tool.name === name),
    )
  ) {
    throw new Error('Agency tool definition invariant failed');
  }

  return [...locationDefinitions, ...agencyInventoryDefinitions];
}

function asArguments(args: unknown): Record<string, unknown> {
  if (!args || typeof args !== 'object' || Array.isArray(args)) {
    return {};
  }
  return { ...(args as Record<string, unknown>) };
}

export async function executeAgencyTool(
  locationTools: AgencyLocationTools,
  client: AgencyApiClient,
  companyId: string,
  name: string,
  args: unknown,
): Promise<unknown> {
  if (!AGENCY_TOOL_NAMES.includes(name as AgencyToolName)) {
    throw new Error(`Tool is not available in agency mode: ${name}`);
  }

  if (name === 'search_locations') {
    const scopedArgs = asArguments(args);
    if (scopedArgs.companyId && scopedArgs.companyId !== companyId) {
      throw new Error('Cross-company tool arguments are not allowed');
    }
    scopedArgs.companyId = companyId;
    return locationTools.executeTool(name, scopedArgs);
  }
  if (name === 'get_location') {
    return locationTools.executeTool(name, asArguments(args));
  }
  if (name === 'agency_get_company') {
    return client.getCompany(companyId);
  }
  if (name === 'agency_search_users') {
    return client.searchUsers({ companyId });
  }
  if (name === 'agency_get_snapshots') {
    return client.getSnapshots();
  }

  return getAgencyCapabilityReport(client, companyId);
}

function unsupported(error: unknown): { supported: false; error: string } {
  return {
    supported: false,
    error: error instanceof Error ? error.message : String(error),
  };
}

export async function getAgencyCapabilityReport(
  client: AgencyApiClient,
  companyId: string,
): Promise<Record<string, unknown>> {
  let company: unknown;
  let locations: unknown;
  let users: unknown;
  let snapshots: unknown;

  try {
    const result = await client.getCompany(companyId);
    company = result.success && result.data?.company
      ? { supported: true, id: result.data.company.id }
      : unsupported(result.error?.message || 'Company read returned no data');
  } catch (error) {
    company = unsupported(error);
  }

  try {
    const result = await client.searchLocations({ companyId, limit: 100 });
    locations = result.success && result.data
      ? { supported: true, visible: result.data.locations?.length || 0 }
      : unsupported(result.error?.message || 'Location read returned no data');
  } catch (error) {
    locations = unsupported(error);
  }

  try {
    const result = await client.searchUsers({ companyId });
    users = result.success && result.data
      ? { supported: true, visible: result.data.users?.length || 0 }
      : unsupported(result.error?.message || 'User read returned no data');
  } catch (error) {
    users = unsupported(error);
  }

  try {
    const result = await client.getSnapshots();
    snapshots = result.success && result.data
      ? { supported: true, visible: result.data.snapshots?.length || 0 }
      : unsupported(result.error?.message || 'Snapshot read returned no data');
  } catch (error) {
    snapshots = unsupported(error);
  }

  return { company, locations, users, snapshots };
}

export async function testAgencyConnection(
  client: AgencyApiClient,
  expectedCompanyId: string,
): Promise<{ companyId: string }> {
  const result = await client.getCompany(expectedCompanyId);
  if (!result.success || !result.data?.company) {
    throw new Error(result.error?.message || 'Agency company identity probe failed');
  }
  if (result.data.company.id !== expectedCompanyId) {
    throw new Error('Agency company identity mismatch');
  }

  return { companyId: result.data.company.id };
}
