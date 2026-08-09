import {
  AGENCY_TOOL_NAMES,
  createAgencyConfig,
  executeAgencyTool,
  getAgencyToolDefinitions,
  testAgencyConnection,
  type AgencyConnectionClient,
  type AgencyLocationTools,
} from '../src/agency-mode.js';

describe('agency mode', () => {
  const definitions = [
    { name: 'delete_location', description: 'mutating', inputSchema: { type: 'object' } },
    { name: 'search_locations', description: 'read', inputSchema: { type: 'object' } },
    { name: 'get_location', description: 'read', inputSchema: { type: 'object' } },
    { name: 'search_contacts', description: 'location-only', inputSchema: { type: 'object' } },
  ];

  const locationTools: AgencyLocationTools = {
    getToolDefinitions: jest.fn(() => definitions),
    executeTool: jest.fn(async (name, args) => ({ name, args })),
  };

  beforeEach(() => jest.clearAllMocks());

  it('builds agency configuration without requiring a location ID', () => {
    expect(
      createAgencyConfig({
        GHL_AGENCY_API_KEY: 'test-token',
        GHL_BASE_URL: 'https://attacker.invalid',
      }),
    ).toEqual({
      accessToken: 'test-token',
      baseUrl: 'https://services.leadconnectorhq.com',
      version: '2021-07-28',
      locationId: '',
    });
  });

  it('fails closed when the agency credential is absent', () => {
    expect(() => createAgencyConfig({ GHL_API_KEY: 'location-token' })).toThrow(
      'GHL_AGENCY_API_KEY environment variable is required',
    );
  });

  it('exposes exactly the two verified read-only agency tools', () => {
    expect(AGENCY_TOOL_NAMES).toEqual(['search_locations', 'get_location']);
    expect(getAgencyToolDefinitions(locationTools).map((tool) => tool.name)).toEqual([
      'search_locations',
      'get_location',
    ]);
  });

  it('routes allowed tools and rejects mutating or location-only tools', async () => {
    await expect(
      executeAgencyTool(locationTools, 'search_locations', { limit: 3 }),
    ).resolves.toEqual({ name: 'search_locations', args: { limit: 3 } });
    await expect(
      executeAgencyTool(locationTools, 'delete_location', { locationId: 'x' }),
    ).rejects.toThrow('Tool is not available in agency mode');
    await expect(
      executeAgencyTool(locationTools, 'search_contacts', {}),
    ).rejects.toThrow('Tool is not available in agency mode');
    expect(locationTools.executeTool).toHaveBeenCalledTimes(1);
  });

  it('fails registration if either verified definition disappears', () => {
    const driftedTools: AgencyLocationTools = {
      getToolDefinitions: () => definitions.filter((tool) => tool.name !== 'get_location'),
      executeTool: jest.fn(),
    };

    expect(() => getAgencyToolDefinitions(driftedTools)).toThrow(
      'Agency tool definition invariant failed',
    );
  });

  it('validates startup through a bounded agency location search', async () => {
    const client: AgencyConnectionClient = {
      searchLocations: jest.fn(async () => ({
        success: true,
        data: { locations: [{ id: 'one' }] },
      })),
    };

    await expect(testAgencyConnection(client)).resolves.toBe(1);
    expect(client.searchLocations).toHaveBeenCalledWith({
      limit: 1,
    });
  });

  it('rejects a failed startup probe', async () => {
    const client: AgencyConnectionClient = {
      searchLocations: jest.fn(async () => ({
        success: false,
        error: { message: 'not authorized' },
      })),
    };

    await expect(testAgencyConnection(client)).rejects.toThrow('not authorized');
  });
});
