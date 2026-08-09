import {
  AGENCY_TOOL_NAMES,
  createAgencyConfig,
  executeAgencyTool,
  getAgencyToolDefinitions,
  getAgencyCapabilityReport,
  testAgencyConnection,
  type AgencyApiClient,
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

  const agencyClient: AgencyApiClient = {
    getCompany: jest.fn(async () => ({
      success: true,
      data: { company: { id: 'company-one', name: 'Expected agency' } },
    })),
    searchUsers: jest.fn(async () => ({ success: true, data: { users: [] } })),
    getSnapshots: jest.fn(async () => ({ success: true, data: { snapshots: [] } })),
    searchLocations: jest.fn(async () => ({ success: true, data: { locations: [] } })),
  };

  beforeEach(() => jest.clearAllMocks());

  it('builds agency configuration without requiring a location ID', () => {
    expect(
      createAgencyConfig({
        GHL_AGENCY_API_KEY: 'test-token',
        GHL_EXPECTED_COMPANY_ID: 'company-one',
        GHL_BASE_URL: 'https://attacker.invalid',
      }),
    ).toEqual({
      apiConfig: {
        accessToken: 'test-token',
        baseUrl: 'https://services.leadconnectorhq.com',
        version: '2021-07-28',
        locationId: '',
      },
      companyId: 'company-one',
    });
  });

  it('fails closed when the agency credential is absent', () => {
    expect(() =>
      createAgencyConfig({
        GHL_API_KEY: 'location-token',
        GHL_EXPECTED_COMPANY_ID: 'company-one',
      }),
    ).toThrow(
      'GHL_AGENCY_API_KEY environment variable is required',
    );
  });

  it('fails closed when the expected agency identity is absent', () => {
    expect(() => createAgencyConfig({ GHL_AGENCY_API_KEY: 'test-token' })).toThrow(
      'GHL_EXPECTED_COMPANY_ID environment variable is required',
    );
  });

  it('exposes only the six verified read-only agency tools', () => {
    expect(AGENCY_TOOL_NAMES).toEqual([
      'search_locations',
      'get_location',
      'agency_get_company',
      'agency_search_users',
      'agency_get_snapshots',
      'agency_capability_report',
    ]);
    expect(getAgencyToolDefinitions(locationTools).map((tool) => tool.name)).toEqual([
      'search_locations',
      'get_location',
      'agency_get_company',
      'agency_search_users',
      'agency_get_snapshots',
      'agency_capability_report',
    ]);
  });

  it('routes allowed tools and rejects mutating or location-only tools', async () => {
    await expect(
      executeAgencyTool(locationTools, agencyClient, 'company-one', 'search_locations', { limit: 3 }),
    ).resolves.toEqual({
      name: 'search_locations',
      args: { limit: 3, companyId: 'company-one' },
    });
    await expect(
      executeAgencyTool(locationTools, agencyClient, 'company-one', 'delete_location', { locationId: 'x' }),
    ).rejects.toThrow('Tool is not available in agency mode');
    await expect(
      executeAgencyTool(locationTools, agencyClient, 'company-one', 'search_contacts', {}),
    ).rejects.toThrow('Tool is not available in agency mode');
    expect(locationTools.executeTool).toHaveBeenCalledTimes(1);
  });

  it('rejects a cross-company agency location search', async () => {
    await expect(
      executeAgencyTool(locationTools, agencyClient, 'company-one', 'search_locations', {
        companyId: 'company-two',
      }),
    ).rejects.toThrow('Cross-company tool arguments are not allowed');
  });

  it('routes read-only agency inventory tools through the expected company', async () => {
    await executeAgencyTool(locationTools, agencyClient, 'company-one', 'agency_get_company', {});
    await executeAgencyTool(locationTools, agencyClient, 'company-one', 'agency_search_users', {});
    await executeAgencyTool(locationTools, agencyClient, 'company-one', 'agency_get_snapshots', {});

    expect(agencyClient.getCompany).toHaveBeenCalledWith('company-one');
    expect(agencyClient.searchUsers).toHaveBeenCalledWith({ companyId: 'company-one' });
    expect(agencyClient.getSnapshots).toHaveBeenCalledWith();
  });

  it('fails registration if either verified definition disappears', () => {
    const driftedTools: AgencyLocationTools = {
      getToolDefinitions: () => definitions.filter((tool) => tool.name !== 'get_location'),
      executeTool: jest.fn(),
    };

    expect(() => getAgencyToolDefinitions(driftedTools)).toThrow('Agency tool definition invariant failed');
  });

  it('validates startup through exact returned company identity', async () => {
    const client: AgencyApiClient = {
      getCompany: jest.fn(async () => ({
        success: true,
        data: { company: { id: 'company-one', name: 'Expected agency' } },
      })),
      searchUsers: jest.fn(),
      getSnapshots: jest.fn(),
      searchLocations: jest.fn(),
    };

    await expect(testAgencyConnection(client, 'company-one')).resolves.toEqual({
      companyId: 'company-one',
    });
    expect(client.getCompany).toHaveBeenCalledWith('company-one');
  });

  it('rejects failed or mismatched startup identity probes', async () => {
    const failedClient: AgencyApiClient = {
      getCompany: jest.fn(async () => ({ success: false, error: { message: 'not authorized' } })),
      searchUsers: jest.fn(),
      getSnapshots: jest.fn(),
      searchLocations: jest.fn(),
    };
    const wrongClient: AgencyApiClient = {
      getCompany: jest.fn(async () => ({
        success: true,
        data: { company: { id: 'company-two', name: 'Wrong agency' } },
      })),
      searchUsers: jest.fn(),
      getSnapshots: jest.fn(),
      searchLocations: jest.fn(),
    };

    await expect(testAgencyConnection(failedClient, 'company-one')).rejects.toThrow('not authorized');
    await expect(testAgencyConnection(wrongClient, 'company-one')).rejects.toThrow(
      'Agency company identity mismatch',
    );
  });

  it('builds a consolidated read-only capability report', async () => {
    await expect(getAgencyCapabilityReport(agencyClient, 'company-one')).resolves.toEqual({
      company: { supported: true, id: 'company-one' },
      locations: { supported: true, visible: 0 },
      users: { supported: true, visible: 0 },
      snapshots: { supported: true, visible: 0 },
    });
  });
});
