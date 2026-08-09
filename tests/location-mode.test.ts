import {
  assertLocationToolExecutionAllowed,
  createLocationProfileConfig,
  filterLocationToolDefinitions,
  verifyLocationIdentity,
  type LocationIdentityClient,
} from '../src/location-mode.js';

describe('location profile guardrails', () => {
  const definitions = [
    { name: 'get_contact', description: 'read', inputSchema: { type: 'object' } },
    { name: 'create_contact', description: 'write', inputSchema: { type: 'object' } },
    { name: 'get_or_create_contact', description: 'unknown', inputSchema: { type: 'object' } },
  ];

  it('pins the official API origin and defaults to audit mode', () => {
    expect(
      createLocationProfileConfig({
        GHL_API_KEY: 'test-token',
        GHL_LOCATION_ID: 'location-one',
        GHL_EXPECTED_LOCATION_ID: 'location-one',
        GHL_EXPECTED_COMPANY_ID: 'company-one',
        GHL_BASE_URL: 'https://attacker.invalid',
      }),
    ).toEqual({
      apiConfig: {
        accessToken: 'test-token',
        baseUrl: 'https://services.leadconnectorhq.com',
        version: '2021-07-28',
        locationId: 'location-one',
      },
      expectedCompanyId: 'company-one',
      expectedLocationId: 'location-one',
      mutationsEnabled: false,
    });
  });

  it('requires an exact explicit mutation opt-in', () => {
    const base = {
      GHL_API_KEY: 'test-token',
      GHL_LOCATION_ID: 'location-one',
      GHL_EXPECTED_LOCATION_ID: 'location-one',
      GHL_EXPECTED_COMPANY_ID: 'company-one',
    };

    expect(createLocationProfileConfig({ ...base, GHL_ENABLE_MUTATIONS: '1' }).mutationsEnabled).toBe(false);
    expect(createLocationProfileConfig({ ...base, GHL_ENABLE_MUTATIONS: 'TRUE' }).mutationsEnabled).toBe(false);
    expect(createLocationProfileConfig({ ...base, GHL_ENABLE_MUTATIONS: 'true' }).mutationsEnabled).toBe(true);
  });

  it('fails closed when required identity configuration is missing or inconsistent', () => {
    expect(() =>
      createLocationProfileConfig({
        GHL_API_KEY: 'test-token',
        GHL_LOCATION_ID: 'location-one',
        GHL_EXPECTED_COMPANY_ID: 'company-one',
      }),
    ).toThrow('GHL_EXPECTED_LOCATION_ID environment variable is required');

    expect(() =>
      createLocationProfileConfig({
        GHL_API_KEY: 'test-token',
        GHL_LOCATION_ID: 'location-one',
        GHL_EXPECTED_LOCATION_ID: 'location-two',
        GHL_EXPECTED_COMPANY_ID: 'company-one',
      }),
    ).toThrow('Configured location does not match expected location');
  });

  it('exposes only explicitly allowlisted reads in audit mode', () => {
    expect(filterLocationToolDefinitions(definitions, false).map((tool) => tool.name)).toEqual([
      'get_contact',
    ]);
    expect(filterLocationToolDefinitions(definitions, true)).toEqual(definitions);
  });

  it('blocks mutations and unknown tools before dispatch unless explicitly enabled', () => {
    const auditProfile = createLocationProfileConfig({
      GHL_API_KEY: 'test-token',
      GHL_LOCATION_ID: 'location-one',
      GHL_EXPECTED_LOCATION_ID: 'location-one',
      GHL_EXPECTED_COMPANY_ID: 'company-one',
    });

    expect(() => assertLocationToolExecutionAllowed('create_contact', {}, auditProfile)).toThrow(
      'Mutation tools are disabled for this location profile',
    );
    expect(() => assertLocationToolExecutionAllowed('get_or_create_contact', {}, auditProfile)).toThrow(
      'Tool is not allowlisted for audit mode',
    );
    expect(() => assertLocationToolExecutionAllowed('get_contact', {}, auditProfile)).not.toThrow();

    const mutationProfile = { ...auditProfile, mutationsEnabled: true };
    expect(() => assertLocationToolExecutionAllowed('create_contact', {}, mutationProfile)).not.toThrow();
  });

  it('rejects cross-location identifiers even when mutations are enabled', () => {
    const profile = {
      ...createLocationProfileConfig({
        GHL_API_KEY: 'test-token',
        GHL_LOCATION_ID: 'location-one',
        GHL_EXPECTED_LOCATION_ID: 'location-one',
        GHL_EXPECTED_COMPANY_ID: 'company-one',
      }),
      mutationsEnabled: true,
    };

    expect(() =>
      assertLocationToolExecutionAllowed('get_contact', { locationId: 'location-two' }, profile),
    ).toThrow('Cross-location tool arguments are not allowed');
    expect(() =>
      assertLocationToolExecutionAllowed(
        'create_contact',
        { payload: { location_id: 'location-two' } },
        profile,
      ),
    ).toThrow('Cross-location tool arguments are not allowed');
    expect(() =>
      assertLocationToolExecutionAllowed(
        'add_inbound_message',
        { altType: 'location', altId: 'location-two' },
        profile,
      ),
    ).toThrow('Cross-location tool arguments are not allowed');
    expect(() =>
      assertLocationToolExecutionAllowed(
        'create_contact',
        { locationId: 'location-one' },
        profile,
      ),
    ).not.toThrow();
  });

  it('verifies both returned location and company identity at startup', async () => {
    const client: LocationIdentityClient = {
      getLocationById: jest.fn(async () => ({
        success: true,
        data: {
          location: {
            id: 'location-one',
            companyId: 'company-one',
            name: 'Expected location',
          },
        },
      })),
    };

    await expect(verifyLocationIdentity(client, 'location-one', 'company-one')).resolves.toEqual({
      locationId: 'location-one',
      companyId: 'company-one',
    });
    expect(client.getLocationById).toHaveBeenCalledWith('location-one');
  });

  it('fails startup closed on returned token/location mismatch', async () => {
    const wrongLocation: LocationIdentityClient = {
      getLocationById: jest.fn(async () => ({
        success: true,
        data: {
          location: {
            id: 'location-two',
            companyId: 'company-one',
            name: 'Wrong location',
          },
        },
      })),
    };
    const wrongCompany: LocationIdentityClient = {
      getLocationById: jest.fn(async () => ({
        success: true,
        data: {
          location: {
            id: 'location-one',
            companyId: 'company-two',
            name: 'Wrong company',
          },
        },
      })),
    };

    await expect(verifyLocationIdentity(wrongLocation, 'location-one', 'company-one')).rejects.toThrow(
      'Location identity mismatch',
    );
    await expect(verifyLocationIdentity(wrongCompany, 'location-one', 'company-one')).rejects.toThrow(
      'Company identity mismatch',
    );
  });
});
