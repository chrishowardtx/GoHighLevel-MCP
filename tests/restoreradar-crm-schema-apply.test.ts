const {
  HighLevelClient,
  assertNoProhibitedPayloadData,
  buildAssignmentRecordPayload,
  buildBusinessRecordPayload,
  buildContactPayloads,
  buildOpportunityPayloads,
  createReceipt,
  customObjectV2NamespaceFromReadback,
  loadManifest,
  readBusinesses,
  runSchemaTool,
  testIds,
  timestampFromTestSuffix
} = require('../scripts/restoreradar-crm-schema-lib.cjs');

type FetchCall = {
  url: URL;
  method: string;
  headers: Record<string, string>;
  body?: any;
};

const NOW = new Date('2026-08-09T12:34:56.000Z');
const TEST_SUFFIX = '20260809T123456Z';
const TOKEN = 'test_secret_token_value';
const AGENCY_TOKEN = 'test_agency_secret_token_value';

function credentialEnv() {
  return {
    GHL_AGENCY_API_KEY: AGENCY_TOKEN,
    GHL_RESTORERADAR_API_KEY: TOKEN
  };
}

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body)
  };
}

function mockFetch(router: (call: FetchCall) => any) {
  const calls: FetchCall[] = [];
  const fetchImpl = jest.fn(async (input: string, init: any = {}) => {
    const call: FetchCall = {
      url: new URL(input),
      method: init.method || 'GET',
      headers: init.headers || {},
      ...(init.body ? { body: JSON.parse(init.body) } : {})
    };
    calls.push(call);
    return router(call);
  });
  return { calls, fetchImpl };
}

function requiredArgs(extra: string[] = []) {
  const manifest = loadManifest();
  return [
    '--company-id',
    manifest.identity.companyId,
    '--location-id',
    manifest.identity.locationId,
    ...extra
  ];
}

function emptyDiscoveryRouter(call: FetchCall, overrides: { wrongIdentity?: boolean; collision?: boolean } = {}) {
  const manifest = loadManifest();
  const pathname = call.url.pathname;
  if (call.method === 'GET' && pathname === `/companies/${manifest.identity.companyId}`) {
    return jsonResponse({ company: { id: manifest.identity.companyId } });
  }
  if (call.method === 'GET' && pathname === `/locations/${manifest.identity.locationId}`) {
    return jsonResponse({
      location: {
        id: overrides.wrongIdentity ? 'wrong-location' : manifest.identity.locationId,
        companyId: manifest.identity.companyId
      }
    });
  }
  if (call.method === 'GET' && pathname === '/opportunities/pipelines') {
    return jsonResponse({
      pipelines: overrides.collision
        ? [{ id: 'pipeline_collision', name: manifest.pipelines[0].name, stages: [{ name: 'Wrong' }] }]
        : []
    });
  }
  if (call.method === 'GET' && pathname.endsWith('/customFields')) {
    return jsonResponse({ customFields: [] });
  }
  if (call.method === 'GET' && pathname === '/objects/') {
    return jsonResponse({
      objects: [
        { key: 'contact', standard: true },
        { key: 'opportunity', standard: true },
        { key: 'business', standard: true }
      ]
    });
  }
  if (call.method === 'GET' && pathname === '/custom-fields/object-key/business') {
    return jsonResponse({ fields: [], folders: [] });
  }
  if (call.method === 'GET' && pathname === '/associations/') {
    return jsonResponse({ associations: [] });
  }
  throw new Error(`Unexpected request in empty discovery mock: ${call.method} ${pathname}`);
}

function completeFixture() {
  const manifest = loadManifest();
  const pipelines = manifest.pipelines.map((pipeline: any, pipelineIndex: number) => ({
    id: `pipeline_${pipelineIndex}`,
    name: pipeline.name,
    stages: pipeline.stages.map((name: string, stageIndex: number) => ({
      id: `pipeline_${pipelineIndex}_stage_${stageIndex}`,
      name,
      position: stageIndex + 1
    }))
  }));
  const legacyFields = ['contact', 'opportunity'].flatMap((model) =>
    manifest.legacyFields[model].map((name: string, index: number) => ({
      id: `${model}_field_${index}`,
      name,
      fieldKey: `${model}.rr_${index}`,
      dataType: 'TEXT',
      model
    }))
  );
  const object = {
    id: 'object_assignment',
    key: manifest.customObject.key,
    labels: manifest.customObject.labels,
    description: manifest.customObject.description,
    primaryDisplayProperty: manifest.customObject.primaryDisplayPropertyDetails.key
  };
  const primaryField = {
    id: 'assignment_primary',
    name: manifest.customObject.primaryDisplayPropertyDetails.name,
    fieldKey: 'custom_object.rr_lead_assignment.rr_assignment_id',
    objectKey: 'custom_object.rr_lead_assignment',
    dataType: 'TEXT',
    options: []
  };
  const businessFolder = {
    id: 'business_folder',
    objectKey: manifest.business.objectKey,
    name: manifest.business.folder
  };
  const builtInBusinessFolder = {
    id: 'business_builtin_folder',
    objectKey: manifest.business.objectKey,
    name: 'Company Info'
  };
  const businessFields = manifest.business.fields.map((field: any, index: number) => ({
    id: `business_field_${index}`,
    objectKey: manifest.business.objectKey,
    parentId: businessFolder.id,
    ...field,
    options: field.options || []
  }));
  businessFields.unshift(
    {
      id: 'business_builtin_name',
      objectKey: manifest.business.objectKey,
      name: 'Business Name',
      fieldKey: 'business.name',
      dataType: 'TEXT',
      options: []
    },
    {
      id: 'business_builtin_phone',
      objectKey: manifest.business.objectKey,
      name: 'Business Phone',
      fieldKey: 'business.phone',
      dataType: 'TEXT',
      options: []
    },
    {
      id: 'business_builtin_email',
      objectKey: manifest.business.objectKey,
      name: 'Business Email',
      fieldKey: 'business.email',
      dataType: 'TEXT',
      options: []
    }
  );
  const customFolder = {
    id: 'assignment_folder',
    objectKey: 'custom_object.rr_lead_assignment',
    name: manifest.customObject.folder
  };
  const customFields = [
    primaryField,
    ...manifest.customObject.fields.map((field: any, index: number) => ({
      id: `assignment_field_${index}`,
      name: field.name,
      fieldKey: `custom_object.rr_lead_assignment.${field.suffix}`,
      objectKey: 'custom_object.rr_lead_assignment',
      parentId: customFolder.id,
      dataType: field.dataType,
      options: field.options || []
    }))
  ];
  const association = { id: 'association_homeowner_assignment', ...manifest.association };
  return {
    manifest,
    pipelines,
    legacyFields,
    object,
    primaryField,
    businessFolder,
    builtInBusinessFolder,
    businessFields,
    customFolder,
    customFields,
    association
  };
}

function completeRouter(call: FetchCall, overrides: {
  wrongBusinessFolder?: boolean;
  unsafeRecord?:
    | 'contact'
    | 'opportunity'
    | 'assignment'
    | 'business-top-channel'
    | 'business-property-channel'
    | 'business-extra'
    | 'business-prohibited';
} = {}) {
  const fixture = completeFixture();
  if (overrides.wrongBusinessFolder) {
    const field = fixture.businessFields.find((entry: any) => entry.name.startsWith('RR |'));
    field.parentId = 'wrong_folder';
  }
  const { manifest } = fixture;
  const pathname = call.url.pathname;
  const ids = testIds(TEST_SUFFIX);
  const contactFieldIds = Object.fromEntries(
    fixture.legacyFields
      .filter((field: any) => field.model === 'contact')
      .map((field: any) => [field.name, field.id])
  );
  const opportunityFieldIds = Object.fromEntries(
    fixture.legacyFields
      .filter((field: any) => field.model === 'opportunity')
      .map((field: any) => [field.name, field.id])
  );
  const contactPayloads = buildContactPayloads({
    manifest,
    suffix: TEST_SUFFIX,
    fieldIds: contactFieldIds
  });
  const opportunityPayloads = buildOpportunityPayloads({
    manifest,
    suffix: TEST_SUFFIX,
    nowIso: NOW.toISOString(),
    fieldIds: opportunityFieldIds,
    pipelines: {
      [manifest.pipelines[0].name]: {
        id: fixture.pipelines[0].id,
        stageId: fixture.pipelines[0].stages[0].id
      },
      [manifest.pipelines[1].name]: {
        id: fixture.pipelines[1].id,
        stageId: fixture.pipelines[1].stages[0].id
      }
    },
    homeownerContactId: 'contact_homeowner',
    providerContactId: 'contact_provider',
    businessId: 'business_test'
  });
  const businessPayload = buildBusinessRecordPayload({ manifest, suffix: TEST_SUFFIX });
  const assignmentPayload = buildAssignmentRecordPayload({
    manifest,
    suffix: TEST_SUFFIX,
    nowIso: NOW.toISOString(),
    homeownerContactId: 'contact_homeowner',
    homeownerOpportunityId: 'opportunity_homeowner',
    businessId: 'business_test'
  });
  if (call.method === 'GET' && pathname === `/companies/${manifest.identity.companyId}`) {
    return jsonResponse({ company: { id: manifest.identity.companyId } });
  }
  if (call.method === 'GET' && pathname === `/locations/${manifest.identity.locationId}`) {
    return jsonResponse({
      location: { id: manifest.identity.locationId, companyId: manifest.identity.companyId }
    });
  }
  if (call.method === 'GET' && pathname === '/opportunities/pipelines') {
    return jsonResponse({ pipelines: fixture.pipelines });
  }
  if (call.method === 'GET' && pathname.endsWith('/customFields')) {
    return jsonResponse({ customFields: fixture.legacyFields });
  }
  if (call.method === 'GET' && pathname === '/objects/') {
    return jsonResponse({
      objects: [
        { key: 'contact', standard: true },
        { key: 'opportunity', standard: true },
        { key: 'business', standard: true },
        fixture.object
      ]
    });
  }
  if (call.method === 'GET' && pathname === `/objects/${manifest.customObject.key}`) {
    return jsonResponse({ object: fixture.object, fields: [fixture.primaryField] });
  }
  if (call.method === 'GET' && pathname === '/custom-fields/object-key/business') {
    return jsonResponse({
      fields: fixture.businessFields,
      folders: [fixture.builtInBusinessFolder, fixture.businessFolder]
    });
  }
  if (
    call.method === 'GET' &&
    pathname === `/custom-fields/object-key/${manifest.customObject.key}`
  ) {
    return jsonResponse({ fields: fixture.customFields, folders: [fixture.customFolder] });
  }
  if (call.method === 'GET' && pathname === '/associations/') {
    return jsonResponse({ associations: [fixture.association] });
  }
  if (call.method === 'POST' && pathname === '/contacts/search') {
    const query = call.body.query;
    const contact = query === ids.homeownerName
      ? { id: 'contact_homeowner', name: ids.homeownerName }
      : { id: 'contact_provider', name: ids.providerName };
    return jsonResponse({ contacts: [contact] });
  }
  if (call.method === 'GET' && pathname === '/contacts/contact_homeowner') {
    const contact: any = { id: 'contact_homeowner', ...contactPayloads.homeowner };
    contact.customFields = [
      ...contact.customFields,
      { id: 'empty_contact_placeholder', fieldValue: '' }
    ];
    if (overrides.unsafeRecord === 'contact') {
      contact.customFields = [
        ...contact.customFields,
        { id: 'unexpected_contact_field', fieldValue: 'UNEXPECTED_NONEMPTY' }
      ];
    }
    return jsonResponse({ contact });
  }
  if (call.method === 'GET' && pathname === '/contacts/contact_provider') {
    return jsonResponse({
      contact: {
        id: 'contact_provider',
        ...contactPayloads.provider,
        customFields: [
          ...contactPayloads.provider.customFields,
          { id: 'empty_contact_placeholder', fieldValue: '' }
        ]
      }
    });
  }
  if (call.method === 'GET' && pathname === '/businesses/') {
    return jsonResponse({ businesses: [{ id: 'business_test', name: ids.businessName }] });
  }
  if (call.method === 'GET' && pathname === '/objects/business/records/business_test') {
    const record: any = {
      id: 'business_test',
      properties: { ...businessPayload.properties, rr_empty_placeholder: '' }
    };
    if (overrides.unsafeRecord === 'business-top-channel') record.email = 'unsafe@example.test';
    if (overrides.unsafeRecord === 'business-property-channel') {
      record.properties.phone = '+15550000000';
    }
    if (overrides.unsafeRecord === 'business-extra') {
      record.properties.rr_unexpected_projection = 'UNEXPECTED_NONEMPTY';
    }
    if (overrides.unsafeRecord === 'business-prohibited') {
      record.properties.userAgent = 'UNEXPECTED_NONEMPTY';
    }
    return jsonResponse({ record });
  }
  if (call.method === 'GET' && pathname === '/opportunities/search') {
    const name = call.url.searchParams.get('q');
    const pipelineId = call.url.searchParams.get('pipelineId');
    const id = name === ids.homeownerOpportunityName
      ? 'opportunity_homeowner'
      : 'opportunity_provider';
    return jsonResponse({ opportunities: [{ id, name, pipelineId }] });
  }
  if (call.method === 'GET' && pathname === '/opportunities/opportunity_homeowner') {
    const opportunity: any = { id: 'opportunity_homeowner', ...opportunityPayloads.homeowner };
    opportunity.customFields = [
      ...opportunity.customFields,
      { id: 'empty_opportunity_placeholder', fieldValue: '' }
    ];
    if (overrides.unsafeRecord === 'opportunity') {
      opportunity.customFields = [
        ...opportunity.customFields,
        { id: 'unexpected_opportunity_field', fieldValue: 'UNEXPECTED_NONEMPTY' }
      ];
    }
    return jsonResponse({
      opportunity
    });
  }
  if (call.method === 'GET' && pathname === '/opportunities/opportunity_provider') {
    return jsonResponse({
      opportunity: {
        id: 'opportunity_provider',
        ...opportunityPayloads.provider,
        customFields: [
          ...opportunityPayloads.provider.customFields,
          { id: 'empty_opportunity_placeholder', fieldValue: '' }
        ]
      }
    });
  }
  if (
    call.method === 'POST' &&
    pathname === `/objects/${manifest.customObject.key}/records/search`
  ) {
    const properties: any = {
      ...assignmentPayload.properties,
      rr_empty_placeholder: ''
    };
    if (overrides.unsafeRecord === 'assignment') {
      properties.rr_unexpected_projection = 'UNEXPECTED_NONEMPTY';
    }
    return jsonResponse({
      records: [{
        id: 'assignment_test',
        properties
      }]
    });
  }
  if (call.method === 'GET' && pathname === '/associations/relations/contact_homeowner') {
    return jsonResponse({
      relations: [{
        id: 'relation_test',
        associationId: fixture.association.id,
        firstRecordId: 'contact_homeowner',
        secondRecordId: 'assignment_test'
      }]
    });
  }
  throw new Error(`Unexpected request in complete fixture: ${call.method} ${pathname}`);
}

function statefulMissingSchemaServer(objectReadDelay = 0) {
  const manifest = loadManifest();
  let sequence = 0;
  const nextId = (prefix: string) => `${prefix}_${++sequence}`;
  const state: any = {
    pipelines: [],
    legacyFields: [],
    businessFolders: [],
    businessFields: [],
    customFolders: [],
    customFields: [],
    object: null,
    objectReadDelay,
    associations: [],
    contacts: [],
    businesses: [],
    opportunities: [],
    assignments: [],
    relations: []
  };

  const router = (call: FetchCall) => {
    const pathname = call.url.pathname;
    if (call.method === 'GET' && pathname === `/companies/${manifest.identity.companyId}`) {
      return jsonResponse({ company: { id: manifest.identity.companyId } });
    }
    if (call.method === 'GET' && pathname === `/locations/${manifest.identity.locationId}`) {
      return jsonResponse({
        location: { id: manifest.identity.locationId, companyId: manifest.identity.companyId }
      });
    }
    if (call.method === 'GET' && pathname === '/opportunities/pipelines') {
      return jsonResponse({ pipelines: state.pipelines });
    }
    if (call.method === 'POST' && pathname === '/opportunities/pipelines') {
      const pipeline = {
        ...call.body,
        id: nextId('pipeline'),
        stages: call.body.stages.map((stage: any) => ({ ...stage, id: nextId('stage') }))
      };
      state.pipelines.push(pipeline);
      return jsonResponse({ pipeline }, 201);
    }
    if (call.method === 'GET' && pathname.endsWith('/customFields')) {
      const model = call.url.searchParams.get('model');
      return jsonResponse({
        customFields: model && model !== 'all'
          ? state.legacyFields.filter((field: any) => field.model === model)
          : state.legacyFields
      });
    }
    if (call.method === 'POST' && pathname.endsWith('/customFields')) {
      const customField = { ...call.body, id: nextId(`${call.body.model}_field`) };
      state.legacyFields.push(customField);
      return jsonResponse({ customField }, 201);
    }
    if (call.method === 'GET' && pathname === '/objects/') {
      return jsonResponse({
        objects: [
          { key: 'contact', standard: true },
          { key: 'opportunity', standard: true },
          { key: 'business', standard: true },
          ...(state.object ? [state.object] : [])
        ]
      });
    }
    if (call.method === 'POST' && pathname === '/objects/') {
      state.object = {
        ...call.body,
        id: nextId('object'),
        standard: false,
        primaryDisplayProperty: call.body.primaryDisplayPropertyDetails.key
      };
      state.customFields.push({
        id: nextId('assignment_primary'),
        name: call.body.primaryDisplayPropertyDetails.name,
        fieldKey: 'custom_object.rr_lead_assignment.rr_assignment_id',
        objectKey: 'custom_object.rr_lead_assignment',
        dataType: 'TEXT',
        options: []
      });
      return jsonResponse({ object: state.object }, 201);
    }
    if (call.method === 'GET' && pathname === `/objects/${manifest.customObject.key}`) {
      if (!state.object || state.objectReadDelay > 0) {
        if (state.objectReadDelay > 0) state.objectReadDelay -= 1;
        return jsonResponse({ message: 'not visible' }, 404);
      }
      return jsonResponse({ object: state.object, fields: state.customFields });
    }
    if (call.method === 'GET' && pathname === '/custom-fields/object-key/business') {
      return jsonResponse({ fields: state.businessFields, folders: state.businessFolders });
    }
    if (
      call.method === 'GET' &&
      pathname === `/custom-fields/object-key/${manifest.customObject.key}`
    ) {
      return jsonResponse({ fields: state.customFields, folders: state.customFolders });
    }
    if (call.method === 'POST' && pathname === '/custom-fields/folder') {
      const folder = { ...call.body, id: nextId('folder') };
      const target = call.body.objectKey === 'business'
        ? state.businessFolders
        : state.customFolders;
      target.push(folder);
      return jsonResponse({ folder }, 201);
    }
    if (call.method === 'POST' && pathname === '/custom-fields/') {
      const field = { ...call.body, id: nextId('v2_field'), options: call.body.options || [] };
      const target = call.body.objectKey === 'business'
        ? state.businessFields
        : state.customFields;
      target.push(field);
      return jsonResponse({ field }, 201);
    }
    if (call.method === 'GET' && pathname === '/associations/') {
      return jsonResponse({ associations: state.associations });
    }
    if (call.method === 'POST' && pathname === '/associations/') {
      const association = { ...call.body, id: nextId('association') };
      state.associations.push(association);
      return jsonResponse({ association }, 201);
    }
    if (call.method === 'POST' && pathname === '/contacts/search') {
      return jsonResponse({
        contacts: state.contacts.filter((contact: any) => contact.name === call.body.query)
      });
    }
    if (call.method === 'POST' && pathname === '/contacts/') {
      const contact = { ...call.body, id: nextId('contact') };
      state.contacts.push(contact);
      return jsonResponse({ contact }, 201);
    }
    if (call.method === 'GET' && pathname.startsWith('/contacts/')) {
      const id = pathname.split('/').pop();
      const contact = state.contacts.find((entry: any) => entry.id === id);
      return contact ? jsonResponse({ contact }) : jsonResponse({}, 404);
    }
    if (call.method === 'GET' && pathname === '/businesses/') {
      return jsonResponse({
        businesses: state.businesses.map((business: any) => ({
          id: business.id,
          name: business.properties.name
        }))
      });
    }
    if (call.method === 'POST' && pathname === '/objects/business/records') {
      const record = { ...call.body, id: nextId('business') };
      state.businesses.push(record);
      return jsonResponse({ record }, 201);
    }
    if (call.method === 'GET' && pathname.startsWith('/objects/business/records/')) {
      const id = pathname.split('/').pop();
      const record = state.businesses.find((entry: any) => entry.id === id);
      return record ? jsonResponse({ record }) : jsonResponse({}, 404);
    }
    if (call.method === 'GET' && pathname === '/opportunities/search') {
      const name = call.url.searchParams.get('q');
      const pipelineId = call.url.searchParams.get('pipelineId');
      return jsonResponse({
        opportunities: state.opportunities.filter((opportunity: any) =>
          opportunity.name === name && opportunity.pipelineId === pipelineId
        )
      });
    }
    if (call.method === 'POST' && pathname === '/opportunities/') {
      const opportunity = { ...call.body, id: nextId('opportunity') };
      state.opportunities.push(opportunity);
      return jsonResponse({ opportunity }, 201);
    }
    if (call.method === 'GET' && /^\/opportunities\/[^/]+$/.test(pathname)) {
      const id = pathname.split('/').pop();
      const opportunity = state.opportunities.find((entry: any) => entry.id === id);
      return opportunity ? jsonResponse({ opportunity }) : jsonResponse({}, 404);
    }
    if (
      call.method === 'POST' &&
      pathname === `/objects/${manifest.customObject.key}/records/search`
    ) {
      return jsonResponse({ records: state.assignments });
    }
    if (
      call.method === 'POST' &&
      pathname === `/objects/${manifest.customObject.key}/records`
    ) {
      const record = { ...call.body, id: nextId('assignment') };
      state.assignments.push(record);
      return jsonResponse({ record }, 201);
    }
    if (
      call.method === 'GET' &&
      pathname.startsWith(`/objects/${manifest.customObject.key}/records/`)
    ) {
      const id = pathname.split('/').pop();
      const record = state.assignments.find((entry: any) => entry.id === id);
      return record ? jsonResponse({ record }) : jsonResponse({}, 404);
    }
    if (call.method === 'GET' && pathname.startsWith('/associations/relations/')) {
      const homeownerId = pathname.split('/').pop();
      return jsonResponse({
        relations: state.relations.filter((relation: any) =>
          relation.firstRecordId === homeownerId
        )
      });
    }
    if (call.method === 'POST' && pathname === '/associations/relations') {
      const relation = { ...call.body, id: nextId('relation') };
      state.relations.push(relation);
      return jsonResponse({ relation }, 201);
    }
    throw new Error(`Unexpected request in stateful fixture: ${call.method} ${pathname}`);
  };
  return { manifest, router, state };
}

describe('RestoreRadar guarded CRM schema apply tool', () => {
  test('dry-run performs discovery reads and no writes', async () => {
    const { calls, fetchImpl } = mockFetch((call) => emptyDiscoveryRouter(call));
    const result = await runSchemaTool({
      argv: requiredArgs(),
      fetchImpl,
      env: credentialEnv(),
      now: () => NOW
    });

    expect(result.exitCode).toBe(0);
    expect(result.receipt.verdict).toBe('READY');
    expect(result.receipt.mode).toBe('dry-run');
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.every((call) => call.method === 'GET')).toBe(true);
    expect(result.receipt.completed).toEqual([]);
    expect(JSON.stringify(result.receipt)).not.toContain(TOKEN);
  });

  test('fails closed on observed token/location identity mismatch before any schema call', async () => {
    const { calls, fetchImpl } = mockFetch((call) =>
      emptyDiscoveryRouter(call, { wrongIdentity: true })
    );
    const result = await runSchemaTool({
      argv: requiredArgs(),
      fetchImpl,
      env: credentialEnv(),
      now: () => NOW
    });

    expect(result.exitCode).toBe(2);
    expect(result.receipt.verdict).toBe('HALTED');
    expect(result.receipt.haltReason.code).toBe('TOKEN_LOCATION_IDENTITY_MISMATCH');
    expect(calls).toHaveLength(2);
    expect(calls.every((call) => call.method === 'GET')).toBe(true);
  });

  test('blocks mutation without explicit apply opt-in', async () => {
    const manifest = loadManifest();
    const receipt = createReceipt(manifest, { apply: false }, NOW.toISOString());
    const { fetchImpl } = mockFetch(() => {
      throw new Error('fetch must not be reached');
    });
    const client = new HighLevelClient({
      token: TOKEN,
      fetchImpl,
      apply: false,
      receipt,
      locationId: manifest.identity.locationId,
      companyId: manifest.identity.companyId,
      role: 'location'
    });

    await expect(client.request('POST', '/objects/', {
      mutating: true,
      body: { locationId: manifest.identity.locationId }
    })).rejects.toMatchObject({ code: 'MUTATION_OPT_IN_REQUIRED' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test('apply is idempotent when exact schema and stable TEST records already exist', async () => {
    const { calls, fetchImpl } = mockFetch(completeRouter);
    const result = await runSchemaTool({
      argv: requiredArgs(['--apply', '--test-suffix', TEST_SUFFIX]),
      fetchImpl,
      env: credentialEnv(),
      now: () => NOW
    });

    expect(result.exitCode).toBe(0);
    expect(result.receipt.verdict).toBe('APPLIED');
    expect(result.receipt.completed).toEqual([]);
    const semanticReadPosts = [
      '/contacts/search',
      `/objects/${loadManifest().customObject.key}/records/search`
    ];
    const mutationCalls = calls.filter((call) =>
      call.method === 'POST' && !semanticReadPosts.includes(call.url.pathname)
    );
    expect(mutationCalls).toEqual([]);
    expect(result.receipt.summary.completedCreates).toBe(0);
  });

  test('same stable suffix replays with zero writes even when the wall clock changes', async () => {
    const first = mockFetch(completeRouter);
    const second = mockFetch(completeRouter);
    const firstResult = await runSchemaTool({
      argv: requiredArgs(['--apply', '--test-suffix', TEST_SUFFIX]),
      fetchImpl: first.fetchImpl,
      env: credentialEnv(),
      now: () => NOW
    });
    const secondResult = await runSchemaTool({
      argv: requiredArgs(['--apply', '--test-suffix', TEST_SUFFIX]),
      fetchImpl: second.fetchImpl,
      env: credentialEnv(),
      now: () => new Date('2031-01-02T03:04:05.000Z')
    });
    const semanticReadPosts = [
      '/contacts/search',
      `/objects/${loadManifest().customObject.key}/records/search`
    ];
    for (const run of [first, second]) {
      expect(run.calls.filter((call) =>
        call.method === 'POST' && !semanticReadPosts.includes(call.url.pathname)
      )).toEqual([]);
    }
    expect(firstResult.receipt.verdict).toBe('APPLIED');
    expect(secondResult.receipt.verdict).toBe('APPLIED');
    expect(timestampFromTestSuffix(TEST_SUFFIX)).toBe(NOW.toISOString());
  });

  test('halts on an incompatible namespaced collision without writing', async () => {
    const { calls, fetchImpl } = mockFetch((call) =>
      emptyDiscoveryRouter(call, { collision: true })
    );
    const result = await runSchemaTool({
      argv: requiredArgs(),
      fetchImpl,
      env: credentialEnv(),
      now: () => NOW
    });

    expect(result.exitCode).toBe(2);
    expect(result.receipt.haltReason.code).toBe('SCHEMA_PLAN_HALTED');
    expect(result.receipt.collisions).toEqual(
      expect.arrayContaining([expect.objectContaining({ resource: 'pipeline' })])
    );
    expect(calls.every((call) => call.method === 'GET')).toBe(true);
  });

  test('treats a V2 field under the wrong parent folder as a collision', async () => {
    const { calls, fetchImpl } = mockFetch((call) =>
      completeRouter(call, { wrongBusinessFolder: true })
    );
    const result = await runSchemaTool({
      argv: requiredArgs(),
      fetchImpl,
      env: credentialEnv(),
      now: () => NOW
    });
    expect(result.receipt.haltReason.code).toBe('SCHEMA_PLAN_HALTED');
    expect(result.receipt.collisions).toEqual(expect.arrayContaining([
      expect.objectContaining({ resource: 'businessField' })
    ]));
    expect(calls.every((call) => call.method === 'GET')).toBe(true);
  });

  test.each([
    'contact',
    'opportunity',
    'assignment',
    'business-top-channel',
    'business-property-channel',
    'business-extra',
    'business-prohibited'
  ])('rejects unsafe nonempty values on an existing TEST %s record', async (unsafeRecord: any) => {
    const { calls, fetchImpl } = mockFetch((call) => completeRouter(call, { unsafeRecord }));
    const result = await runSchemaTool({
      argv: requiredArgs(['--apply', '--test-suffix', TEST_SUFFIX]),
      fetchImpl,
      env: credentialEnv(),
      now: () => NOW
    });
    expect(result.receipt.verdict).toBe('HALTED');
    expect(result.receipt.haltReason.code).toBe('INCOMPATIBLE_COLLISION');
    const semanticReadPosts = [
      '/contacts/search',
      `/objects/${loadManifest().customObject.key}/records/search`
    ];
    expect(calls.filter((call) =>
      call.method === 'POST' && !semanticReadPosts.includes(call.url.pathname)
    )).toEqual([]);
  });

  test('dry-run explicitly records no TEST reads or writes even when a suffix is supplied', async () => {
    const { calls, fetchImpl } = mockFetch((call) => emptyDiscoveryRouter(call));
    const result = await runSchemaTool({
      argv: requiredArgs(['--test-suffix', TEST_SUFFIX]),
      fetchImpl,
      env: credentialEnv(),
      now: () => NOW
    });
    expect(result.receipt.verdict).toBe('READY');
    expect(result.receipt.testVerification).toEqual({
      suffix: TEST_SUFFIX,
      recordsRead: false,
      recordsWritten: false
    });
    expect(result.receipt.notProven.join(' ')).toContain(
      'No TEST verification records were read or written in dry-run mode'
    );
    expect(calls.every((call) => call.method === 'GET')).toBe(true);
  });

  test('pins official paths and endpoint-specific Version v3 on every request', async () => {
    const { calls, fetchImpl } = mockFetch((call) => emptyDiscoveryRouter(call));
    const result = await runSchemaTool({
      argv: requiredArgs(),
      fetchImpl,
      env: credentialEnv(),
      now: () => NOW
    });

    expect(result.exitCode).toBe(0);
    expect(calls.every((call) => call.url.origin === 'https://services.leadconnectorhq.com')).toBe(true);
    expect(calls.every((call) => call.headers.Version === 'v3')).toBe(true);
    expect(calls.map((call) => call.url.pathname)).toEqual(
      expect.arrayContaining([
        `/locations/${loadManifest().identity.locationId}`,
        '/opportunities/pipelines',
        `/locations/${loadManifest().identity.locationId}/customFields`,
        '/objects/',
        '/custom-fields/object-key/business',
        '/associations/'
      ])
    );
  });

  test('pins Version v3 across the narrow create-only allowlist after opt-in', async () => {
    const manifest = loadManifest();
    const receipt = createReceipt(manifest, { apply: true }, NOW.toISOString());
    const { calls, fetchImpl } = mockFetch(() => jsonResponse({ accepted: true }, 201));
    const client = new HighLevelClient({
      token: TOKEN,
      fetchImpl,
      apply: true,
      receipt,
      locationId: manifest.identity.locationId,
      companyId: manifest.identity.companyId,
      role: 'location'
    });
    const agencyClient = new HighLevelClient({
      token: AGENCY_TOKEN,
      fetchImpl,
      apply: true,
      receipt,
      locationId: manifest.identity.locationId,
      companyId: manifest.identity.companyId,
      role: 'agency'
    });
    await agencyClient.request('POST', '/objects/', {
      mutating: true,
      expectedStatus: 201,
      body: { locationId: manifest.identity.locationId }
    });
    const endpoints = [
      '/opportunities/pipelines',
      `/locations/${manifest.identity.locationId}/customFields`,
      '/custom-fields/folder',
      '/custom-fields/',
      '/associations/',
      '/contacts/',
      '/objects/business/records',
      '/opportunities/',
      `/objects/${manifest.customObject.key}/records`,
      '/associations/relations'
    ];
    for (const endpoint of endpoints) {
      await client.request('POST', endpoint, {
        mutating: true,
        body: { locationId: manifest.identity.locationId }
      });
    }

    expect(calls.map((call) => call.url.pathname)).toEqual(['/objects/', ...endpoints]);
    expect(calls.every((call) => call.url.origin === 'https://services.leadconnectorhq.com')).toBe(true);
    expect(calls.every((call) => call.headers.Version === 'v3')).toBe(true);
    expect(calls.every((call) => call.method === 'POST')).toBe(true);
  });

  test('communication, workflow, snapshot, update, and delete endpoints are unreachable', async () => {
    const manifest = loadManifest();
    const receipt = createReceipt(manifest, { apply: true }, NOW.toISOString());
    const { fetchImpl } = mockFetch(() => jsonResponse({}));
    const client = new HighLevelClient({
      token: TOKEN,
      fetchImpl,
      apply: true,
      receipt,
      locationId: manifest.identity.locationId,
      companyId: manifest.identity.companyId,
      role: 'location'
    });

    for (const endpoint of [
      '/conversations/messages',
      '/workflows/',
      '/snapshots/',
      '/campaigns/'
    ]) {
      await expect(client.request('POST', endpoint, {
        mutating: true,
        body: { locationId: manifest.identity.locationId }
      })).rejects.toMatchObject({ code: 'FORBIDDEN_ENDPOINT' });
    }
    await expect(client.request('DELETE', '/objects/x', { mutating: true }))
      .rejects.toMatchObject({ code: 'FORBIDDEN_METHOD' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test('rejects protocol-relative and foreign-origin endpoints before fetch', async () => {
    const manifest = loadManifest();
    const receipt = createReceipt(manifest, { apply: true }, NOW.toISOString());
    const { fetchImpl } = mockFetch(() => jsonResponse({}));
    const client = new HighLevelClient({
      token: TOKEN,
      fetchImpl,
      apply: true,
      receipt,
      locationId: manifest.identity.locationId,
      companyId: manifest.identity.companyId,
      role: 'location'
    });
    await expect(client.request('POST', '//evil.example/objects/', {
      mutating: true,
      body: { locationId: manifest.identity.locationId }
    })).rejects.toMatchObject({ code: 'ENDPOINT_NOT_RELATIVE' });
    await expect(client.request('GET', '/\\evil.example/objects/'))
      .rejects.toMatchObject({ code: 'FOREIGN_ORIGIN_BLOCKED' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test('enforces credential roles before network dispatch', async () => {
    const manifest = loadManifest();
    const receipt = createReceipt(manifest, { apply: true }, NOW.toISOString());
    const { fetchImpl } = mockFetch(() => jsonResponse({}));
    const shared = {
      fetchImpl,
      apply: true,
      receipt,
      locationId: manifest.identity.locationId,
      companyId: manifest.identity.companyId
    };
    const agency = new HighLevelClient({ ...shared, token: AGENCY_TOKEN, role: 'agency' });
    const location = new HighLevelClient({ ...shared, token: TOKEN, role: 'location' });
    await expect(location.request('POST', '/objects/', {
      mutating: true,
      body: { locationId: manifest.identity.locationId }
    })).rejects.toMatchObject({ code: 'MUTATION_ENDPOINT_NOT_ALLOWLISTED' });
    await expect(agency.request('POST', '/custom-fields/', {
      mutating: true,
      body: { locationId: manifest.identity.locationId }
    })).rejects.toMatchObject({ code: 'MUTATION_ENDPOINT_NOT_ALLOWLISTED' });
    await expect(agency.request('GET', '/objects/', {
      query: { locationId: manifest.identity.locationId }
    })).rejects.toMatchObject({ code: 'READ_ENDPOINT_NOT_ALLOWLISTED' });
    await expect(location.request('GET', `/companies/${manifest.identity.companyId}`))
      .rejects.toMatchObject({ code: 'READ_ENDPOINT_NOT_ALLOWLISTED' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test('paginates Business discovery until a short page', async () => {
    const manifest = loadManifest();
    const receipt = createReceipt(manifest, { apply: false }, NOW.toISOString());
    const firstPage = Array.from({ length: 100 }, (_, index) => ({
      id: `business_${index}`,
      name: `Business ${index}`
    }));
    const { calls, fetchImpl } = mockFetch((call) => {
      const skip = Number(call.url.searchParams.get('skip'));
      return jsonResponse({
        businesses: skip === 0 ? firstPage : [{ id: 'business_100', name: 'Business 100' }]
      });
    });
    const client = new HighLevelClient({
      token: TOKEN,
      fetchImpl,
      apply: false,
      receipt,
      locationId: manifest.identity.locationId,
      companyId: manifest.identity.companyId,
      role: 'location'
    });
    await expect(readBusinesses(client, manifest, receipt)).resolves.toHaveLength(101);
    expect(calls.map((call) => call.url.searchParams.get('skip'))).toEqual(['0', '100']);
  });

  test('halts Business pagination when the API repeats a full page', async () => {
    const manifest = loadManifest();
    const receipt = createReceipt(manifest, { apply: false }, NOW.toISOString());
    const repeated = Array.from({ length: 100 }, (_, index) => ({
      id: `business_${index}`,
      name: `Business ${index}`
    }));
    const { calls, fetchImpl } = mockFetch(() => jsonResponse({ businesses: repeated }));
    const client = new HighLevelClient({
      token: TOKEN,
      fetchImpl,
      apply: false,
      receipt,
      locationId: manifest.identity.locationId,
      companyId: manifest.identity.companyId,
      role: 'location'
    });
    await expect(readBusinesses(client, manifest, receipt))
      .rejects.toMatchObject({ code: 'BUSINESS_PAGINATION_REPEAT' });
    expect(calls).toHaveLength(2);
  });

  test('dual preflights use independent tokens before any schema read', async () => {
    const { calls, fetchImpl } = mockFetch((call) => emptyDiscoveryRouter(call));
    const result = await runSchemaTool({
      argv: requiredArgs(),
      fetchImpl,
      env: credentialEnv(),
      now: () => NOW
    });
    expect(result.exitCode).toBe(0);
    expect(calls[0].url.pathname).toBe(`/companies/${loadManifest().identity.companyId}`);
    expect(calls[0].headers.Authorization).toBe(`Bearer ${AGENCY_TOKEN}`);
    expect(calls[1].url.pathname).toBe(`/locations/${loadManifest().identity.locationId}`);
    expect(calls[1].headers.Authorization).toBe(`Bearer ${TOKEN}`);
    expect(calls.slice(2).every((call) => call.headers.Authorization === `Bearer ${TOKEN}`)).toBe(true);
    expect(calls.every((call) => call.method === 'GET')).toBe(true);
  });

  test('swapped agency/location credentials fail before any POST', async () => {
    const manifest = loadManifest();
    const { calls, fetchImpl } = mockFetch((call) => {
      if (call.url.pathname === `/companies/${manifest.identity.companyId}`) {
        return jsonResponse({
          company: {
            id: call.headers.Authorization === `Bearer ${AGENCY_TOKEN}`
              ? manifest.identity.companyId
              : 'wrong-company'
          }
        });
      }
      return emptyDiscoveryRouter(call);
    });
    const result = await runSchemaTool({
      argv: requiredArgs(['--apply', '--test-suffix', TEST_SUFFIX]),
      fetchImpl,
      env: {
        GHL_AGENCY_API_KEY: TOKEN,
        GHL_RESTORERADAR_API_KEY: AGENCY_TOKEN
      },
      now: () => NOW
    });
    expect(result.receipt.haltReason.code).toBe('AGENCY_TOKEN_COMPANY_IDENTITY_MISMATCH');
    expect(calls.every((call) => call.method === 'GET')).toBe(true);
  });

  test('object create is the first POST and malformed 201 response halts bulk creates', async () => {
    const manifest = loadManifest();
    const { calls, fetchImpl } = mockFetch((call) => {
      if (call.method === 'POST' && call.url.pathname === '/objects/') {
        return jsonResponse({ object: { id: 'wrong' } }, 201);
      }
      return emptyDiscoveryRouter(call);
    });
    const result = await runSchemaTool({
      argv: requiredArgs(['--apply', '--test-suffix', TEST_SUFFIX]),
      fetchImpl,
      env: credentialEnv(),
      now: () => NOW
    });
    const posts = calls.filter((call) => call.method === 'POST');
    expect(posts).toHaveLength(1);
    expect(posts[0].url.pathname).toBe('/objects/');
    expect(posts[0].headers.Authorization).toBe(`Bearer ${AGENCY_TOKEN}`);
    expect(result.receipt.haltReason.code).toBe('MALFORMED_OBJECT_CREATE_RESPONSE');
  });

  test('creates a complete missing schema and TEST graph, then replays with zero writes', async () => {
    const server = statefulMissingSchemaServer(2);
    const first = mockFetch(server.router);
    const firstResult = await runSchemaTool({
      argv: requiredArgs(['--apply', '--test-suffix', TEST_SUFFIX]),
      fetchImpl: first.fetchImpl,
      env: credentialEnv(),
      now: () => NOW
    });
    expect(firstResult.receipt.verdict).toBe('APPLIED');
    expect(firstResult.exitCode).toBe(0);
    const firstMutationPosts = first.calls.filter((call) =>
      call.method === 'POST' &&
      call.url.pathname !== '/contacts/search' &&
      !call.url.pathname.endsWith('/records/search')
    );
    expect(firstMutationPosts.length).toBeGreaterThan(0);
    expect(firstMutationPosts[0].url.pathname).toBe('/objects/');
    expect(server.state.pipelines).toHaveLength(2);
    expect(server.state.legacyFields).toHaveLength(
      server.manifest.legacyFields.contact.length +
      server.manifest.legacyFields.opportunity.length
    );
    expect(server.state.businessFields).toHaveLength(server.manifest.business.fields.length);
    expect(server.state.customFields).toHaveLength(server.manifest.customObject.fields.length + 1);
    expect(server.state.associations).toHaveLength(1);
    expect(server.state.contacts).toHaveLength(2);
    expect(server.state.businesses).toHaveLength(1);
    expect(server.state.opportunities).toHaveLength(2);
    expect(server.state.assignments).toHaveLength(1);
    expect(server.state.relations).toHaveLength(1);

    const second = mockFetch(server.router);
    const secondResult = await runSchemaTool({
      argv: requiredArgs(['--apply', '--test-suffix', TEST_SUFFIX]),
      fetchImpl: second.fetchImpl,
      env: credentialEnv(),
      now: () => new Date('2035-06-07T08:09:10.000Z')
    });
    expect(secondResult.receipt.verdict).toBe('APPLIED');
    expect(secondResult.receipt.completed).toEqual([]);
    const secondMutationPosts = second.calls.filter((call) =>
      call.method === 'POST' &&
      call.url.pathname !== '/contacts/search' &&
      !call.url.pathname.endsWith('/records/search')
    );
    expect(secondMutationPosts).toEqual([]);
  });

  test('separates plural schema reads from one server-resolved singular V2 write namespace', () => {
    const manifest = loadManifest();
    const exact = customObjectV2NamespaceFromReadback(
      manifest,
      [{
        id: 'primary',
        objectKey: 'custom_object.rr_lead_assignment',
        fieldKey: 'custom_object.rr_lead_assignment.rr_assignment_id'
      }],
      [{ id: 'folder', objectKey: 'custom_object.rr_lead_assignment' }]
    );
    expect(exact).toMatchObject({
      state: 'exact',
      schemaKey: 'custom_objects.rr_lead_assignment',
      writeObjectKey: 'custom_object.rr_lead_assignment',
      fieldPrefix: 'custom_object.rr_lead_assignment.'
    });
    const conflict = customObjectV2NamespaceFromReadback(
      manifest,
      [{
        id: 'primary',
        objectKey: 'custom_object.rr_lead_assignment',
        fieldKey: 'custom_object.rr_lead_assignment.rr_assignment_id'
      }],
      [{ id: 'folder', objectKey: 'custom_objects.rr_lead_assignment' }]
    );
    expect(conflict).toMatchObject({ state: 'collision' });
  });

  test('verification payloads are no-channel, DND, TEST-only, and omit forbidden PII/narrative', () => {
    const fixture = completeFixture();
    const contactFieldIds = Object.fromEntries(
      fixture.legacyFields
        .filter((field: any) => field.model === 'contact')
        .map((field: any) => [field.name, field.id])
    );
    const opportunityFieldIds = Object.fromEntries(
      fixture.legacyFields
        .filter((field: any) => field.model === 'opportunity')
        .map((field: any) => [field.name, field.id])
    );
    const contacts = buildContactPayloads({
      manifest: fixture.manifest,
      suffix: TEST_SUFFIX,
      fieldIds: contactFieldIds
    });
    const business = buildBusinessRecordPayload({
      manifest: fixture.manifest,
      suffix: TEST_SUFFIX
    });
    const opportunities = buildOpportunityPayloads({
      manifest: fixture.manifest,
      suffix: TEST_SUFFIX,
      nowIso: NOW.toISOString(),
      fieldIds: opportunityFieldIds,
      pipelines: {
        [fixture.manifest.pipelines[0].name]: { id: 'p_home', stageId: 's_recorded' },
        [fixture.manifest.pipelines[1].name]: { id: 'p_provider', stageId: 's_listed' }
      },
      homeownerContactId: 'contact_homeowner',
      providerContactId: 'contact_provider',
      businessId: 'business_test'
    });
    const assignment = buildAssignmentRecordPayload({
      manifest: fixture.manifest,
      suffix: TEST_SUFFIX,
      nowIso: NOW.toISOString(),
      homeownerContactId: 'contact_homeowner',
      homeownerOpportunityId: 'opportunity_homeowner',
      businessId: 'business_test'
    });

    for (const contact of Object.values(contacts) as any[]) {
      expect(contact.dnd).toBe(true);
      expect(contact.tags).toEqual(['rr:test', 'rr:schema-verification']);
      expect(contact).not.toHaveProperty('email');
      expect(contact).not.toHaveProperty('phone');
      expect(contact.name).toMatch(/^RR TEST /);
    }
    expect(business.properties.rr_environment).toBe('TEST');
    expect(business.properties).not.toHaveProperty('email');
    expect(business.properties).not.toHaveProperty('phone');
    expect(opportunities.homeowner.name).toMatch(/^RR TEST /);
    expect(opportunities.provider.name).toMatch(/^RR TEST /);
    expect(assignment.properties.rr_environment).toBe('TEST');
    expect(assignment.properties.rr_assignment_state).toBe('Queued');
    expect(assignment.properties).not.toHaveProperty('rr_sent_at_utc');
    expect(assignment.properties).not.toHaveProperty('rr_resend_message_id');
    for (const payload of [contacts, business, opportunities, assignment]) {
      expect(() => assertNoProhibitedPayloadData(payload, fixture.manifest)).not.toThrow();
      expect(JSON.stringify(payload)).not.toMatch(/ipAddress|userAgent|rawNarrative|homeownerNarrative/);
    }
    expect(JSON.stringify({ contacts, business, opportunities, assignment })).not.toContain(TOKEN);
  });
});
