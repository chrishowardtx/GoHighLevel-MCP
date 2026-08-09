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

type DocumentedCreateFamily =
  | 'pipeline'
  | 'legacy-field'
  | 'v2-folder'
  | 'v2-field'
  | 'association';

const DOCUMENTED_CREATE_FAMILIES: Array<{
  family: DocumentedCreateFamily;
  path: string;
  status: number;
}> = [
  { family: 'pipeline', path: '/opportunities/pipelines', status: 200 },
  { family: 'legacy-field', path: `/locations/${loadManifest().identity.locationId}/customFields`, status: 201 },
  { family: 'v2-folder', path: '/custom-fields/folder', status: 201 },
  { family: 'v2-field', path: '/custom-fields/', status: 201 },
  { family: 'association', path: '/associations/', status: 201 }
];

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
    standard: false,
    locationId: manifest.identity.locationId,
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
  wrongBusinessObjectKey?: boolean;
  wrongObjectStandard?: boolean;
  wrongObjectLocation?: boolean;
  missingId?:
    | 'pipeline'
    | 'legacy-field'
    | 'custom-object'
    | 'association'
    | 'v2-folder'
    | 'v2-field';
  unsafeRecord?:
    | 'contact'
    | 'contact-extra-tag'
    | 'contact-false'
    | 'opportunity'
    | 'opportunity-zero'
    | 'assignment'
    | 'assignment-sent'
    | 'assignment-false'
    | 'business-top-channel'
    | 'business-property-channel'
    | 'business-extra'
    | 'business-prohibited'
    | 'business-false';
} = {}) {
  const fixture = completeFixture();
  if (overrides.wrongBusinessFolder) {
    const field = fixture.businessFields.find((entry: any) => entry.name.startsWith('RR |'));
    field.parentId = 'wrong_folder';
  }
  if (overrides.wrongBusinessObjectKey) {
    const field = fixture.businessFields.find((entry: any) => entry.name.startsWith('RR |'));
    field.objectKey = 'wrong.business';
  }
  if (overrides.wrongObjectStandard) fixture.object.standard = true;
  if (overrides.wrongObjectLocation) fixture.object.locationId = 'wrong-location';
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
    const pipelines = fixture.pipelines.map((pipeline: any) => ({ ...pipeline }));
    if (overrides.missingId === 'pipeline') delete pipelines[0].id;
    return jsonResponse({ pipelines });
  }
  if (call.method === 'GET' && pathname.endsWith('/customFields')) {
    const customFields = fixture.legacyFields.map((field: any) => ({ ...field }));
    if (overrides.missingId === 'legacy-field') delete customFields[0].id;
    return jsonResponse({ customFields });
  }
  if (call.method === 'GET' && pathname === '/objects/') {
    return jsonResponse({
      objects: [
        { key: 'contact', standard: true },
        { key: 'opportunity', standard: true },
        { key: 'business', standard: true },
        overrides.missingId === 'custom-object'
          ? (() => { const object = { ...fixture.object }; delete object.id; return object; })()
          : fixture.object
      ]
    });
  }
  if (call.method === 'GET' && pathname === `/objects/${manifest.customObject.key}`) {
    return jsonResponse({ object: fixture.object, fields: [fixture.primaryField] });
  }
  if (call.method === 'GET' && pathname === '/custom-fields/object-key/business') {
    const fields = fixture.businessFields.map((field: any) => ({ ...field }));
    const folders = [fixture.builtInBusinessFolder, { ...fixture.businessFolder }];
    if (overrides.missingId === 'v2-folder') delete folders[1].id;
    if (overrides.missingId === 'v2-field') {
      const field = fields.find((entry: any) => entry.name.startsWith('RR |'));
      delete field.id;
    }
    return jsonResponse({
      fields,
      folders
    });
  }
  if (
    call.method === 'GET' &&
    pathname === `/custom-fields/object-key/${manifest.customObject.key}`
  ) {
    return jsonResponse({ fields: fixture.customFields, folders: [fixture.customFolder] });
  }
  if (call.method === 'GET' && pathname === '/associations/') {
    const association = { ...fixture.association };
    if (overrides.missingId === 'association') delete association.id;
    return jsonResponse({ associations: [association] });
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
    if (overrides.unsafeRecord === 'contact-extra-tag') contact.tags.push('unexpected-tag');
    if (overrides.unsafeRecord === 'contact-false') {
      contact.customFields.push({ id: 'unexpected_contact_false', fieldValue: false });
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
    return jsonResponse({
      businesses: call.url.searchParams.get('skip') === '0'
        ? [{ id: 'business_test', name: ids.businessName }]
        : []
    });
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
    if (overrides.unsafeRecord === 'business-false') {
      record.properties.unexpected_false = false;
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
    if (overrides.unsafeRecord === 'opportunity-zero') {
      opportunity.customFields.push({ id: 'unexpected_opportunity_zero', fieldValue: 0 });
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
    if (overrides.unsafeRecord === 'assignment-sent') {
      properties.rr_sent_at_utc = '2026-08-09T12:35:00.000Z';
    }
    if (overrides.unsafeRecord === 'assignment-false') {
      properties.unexpected_false = false;
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

function statefulMissingSchemaServer(objectReadDelay = 0, options: {
  envelope?: 'flat' | 'wrapper';
  failure?: {
    family: DocumentedCreateFamily | 'test-assignment';
    kind: 'wrong-status' | 'missing-id' | 'id-mismatch';
  };
} = {}) {
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
    relations: [],
    writeLog: []
  };

  const createResponse = (
    family: string,
    wrapperName: string,
    resource: any,
    expectedStatus: number,
    documentedFlat = false
  ) => {
    const responseResource = { ...resource };
    if (options.failure?.family === family && options.failure.kind === 'missing-id') {
      delete responseResource.id;
    }
    if (options.failure?.family === family && options.failure.kind === 'id-mismatch') {
      responseResource.id = `mismatched_${resource.id}`;
    }
    const status = options.failure?.family === family && options.failure.kind === 'wrong-status'
      ? expectedStatus === 200 ? 201 : 200
      : expectedStatus;
    const body = documentedFlat && options.envelope !== 'wrapper'
      ? responseResource
      : { [wrapperName]: responseResource };
    return jsonResponse(body, status);
  };

  const router = (call: FetchCall) => {
    const pathname = call.url.pathname;
    if (
      call.method === 'POST' &&
      pathname !== '/contacts/search' &&
      !pathname.endsWith('/records/search')
    ) {
      state.writeLog.push({
        path: pathname,
        authorization: call.headers.Authorization,
        body: call.body
      });
    }
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
      return createResponse('pipeline', 'pipeline', pipeline, 200, true);
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
      return createResponse('legacy-field', 'customField', customField, 201);
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
      return createResponse('v2-folder', 'folder', folder, 201, true);
    }
    if (call.method === 'POST' && pathname === '/custom-fields/') {
      const field = { ...call.body, id: nextId('v2_field'), options: call.body.options || [] };
      const target = call.body.objectKey === 'business'
        ? state.businessFields
        : state.customFields;
      target.push(field);
      return createResponse('v2-field', 'field', field, 201);
    }
    if (call.method === 'GET' && pathname === '/associations/') {
      return jsonResponse({ associations: state.associations });
    }
    if (call.method === 'POST' && pathname === '/associations/') {
      const association = { ...call.body, id: nextId('association') };
      state.associations.push(association);
      return createResponse('association', 'association', association, 201, true);
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
        businesses: call.url.searchParams.get('skip') === '0'
          ? state.businesses.map((business: any) => ({
            id: business.id,
            name: business.properties.name
          }))
          : []
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
      return createResponse('test-assignment', 'record', record, 201);
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

  test('treats a V2 field under the wrong object namespace as a collision', async () => {
    const { calls, fetchImpl } = mockFetch((call) =>
      completeRouter(call, { wrongBusinessObjectKey: true })
    );
    const result = await runSchemaTool({
      argv: requiredArgs(),
      fetchImpl,
      env: credentialEnv(),
      now: () => NOW
    });
    expect(result.receipt.haltReason.code).toBe('SCHEMA_PLAN_HALTED');
    expect(calls.every((call) => call.method === 'GET')).toBe(true);
  });

  test.each([
    ['standard custom object', { wrongObjectStandard: true }],
    ['custom object from another location', { wrongObjectLocation: true }]
  ])('rejects an otherwise exact %s during read-only discovery', async (_label, overrides) => {
    const { calls, fetchImpl } = mockFetch((call) => completeRouter(call, overrides));
    const result = await runSchemaTool({
      argv: requiredArgs(),
      fetchImpl,
      env: credentialEnv(),
      now: () => NOW
    });
    expect(result.receipt.haltReason.code).toBe('SCHEMA_PLAN_HALTED');
    expect(result.receipt.collisions).toEqual(expect.arrayContaining([
      expect.objectContaining({ resource: 'customObject' })
    ]));
    expect(calls.every((call) => call.method === 'GET')).toBe(true);
  });

  test.each([
    'pipeline',
    'legacy-field',
    'custom-object',
    'association',
    'v2-folder',
    'v2-field'
  ])('rejects an otherwise exact %s resource without a server ID', async (missingId: any) => {
    const { calls, fetchImpl } = mockFetch((call) => completeRouter(call, { missingId }));
    const result = await runSchemaTool({
      argv: requiredArgs(),
      fetchImpl,
      env: credentialEnv(),
      now: () => NOW
    });
    expect(result.receipt.haltReason.code).toBe('SCHEMA_PLAN_HALTED');
    expect(calls.every((call) => call.method === 'GET')).toBe(true);
  });

  test.each([
    'contact',
    'contact-extra-tag',
    'contact-false',
    'opportunity',
    'opportunity-zero',
    'assignment',
    'assignment-sent',
    'assignment-false',
    'business-top-channel',
    'business-property-channel',
    'business-extra',
    'business-prohibited',
    'business-false'
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

  test('finds a target Business on page two and requests an explicit empty page', async () => {
    const manifest = loadManifest();
    const receipt = createReceipt(manifest, { apply: false }, NOW.toISOString());
    const firstPage = Array.from({ length: 100 }, (_, index) => ({
      id: `business_${index}`,
      name: `Business ${index}`
    }));
    const { calls, fetchImpl } = mockFetch((call) => {
      const skip = Number(call.url.searchParams.get('skip'));
      return jsonResponse({
        businesses: skip === 0
          ? firstPage
          : skip === 100
            ? [{ id: 'business_100', name: 'RR TEST target on page two' }]
            : []
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
    expect(calls.map((call) => call.url.searchParams.get('skip')))
      .toEqual(['0', '100', '101']);
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
    expect(result.receipt.acceptedCreates).toEqual([
      expect.objectContaining({ path: '/objects/', status: 201, credentialRole: 'agency' })
    ]);
    expect(result.receipt.completed).toEqual([]);
  });

  test('object create accepted but permanently unverified makes one POST then read-only retries', async () => {
    const server = statefulMissingSchemaServer(99);
    const { calls, fetchImpl } = mockFetch(server.router);
    const result = await runSchemaTool({
      argv: requiredArgs(['--apply', '--test-suffix', TEST_SUFFIX]),
      fetchImpl,
      env: credentialEnv(),
      now: () => NOW
    });
    expect(result.receipt.haltReason.code).toBe('CREATE_ACCEPTED_READBACK_PENDING');
    expect(server.state.writeLog).toHaveLength(1);
    expect(server.state.writeLog[0].path).toBe('/objects/');
    const objectPostIndex = calls.findIndex((call) =>
      call.method === 'POST' && call.url.pathname === '/objects/'
    );
    expect(calls.slice(objectPostIndex + 1).every((call) => call.method === 'GET')).toBe(true);
    expect(calls.filter((call) =>
      call.method === 'GET' && call.url.pathname === `/objects/${server.manifest.customObject.key}`
    )).toHaveLength(3);
    expect(result.receipt.acceptedCreates).toEqual([
      expect.objectContaining({ path: '/objects/', status: 201, credentialRole: 'agency' })
    ]);
    expect(result.receipt.summary.acceptedCreates).toBe(1);
    expect(result.receipt.completed).toEqual([]);
    expect(result.receipt.summary.completedCreates).toBe(0);
  });

  test('creates a complete missing schema and TEST graph, then replays with zero writes', async () => {
    const server = statefulMissingSchemaServer(2);
    const first = mockFetch(server.router);
    const firstResult = await runSchemaTool({
      argv: requiredArgs(['--apply', '--test-suffix', TEST_SUFFIX]),
      fetchImpl: first.fetchImpl,
      env: credentialEnv(),
      now: () => new Date('2040-01-02T03:04:05.000Z')
    });
    expect(firstResult.receipt.verdict).toBe('APPLIED');
    expect(firstResult.exitCode).toBe(0);
    const firstMutationPosts = first.calls.filter((call) =>
      call.method === 'POST' &&
      call.url.pathname !== '/contacts/search' &&
      !call.url.pathname.endsWith('/records/search')
    );
    expect(firstMutationPosts).toHaveLength(75);
    expect(server.state.writeLog).toHaveLength(75);
    expect(firstResult.receipt.acceptedCreates).toHaveLength(75);
    expect(firstResult.receipt.completed).toHaveLength(75);
    expect(firstResult.receipt.summary.acceptedCreates).toBe(75);
    expect(firstResult.receipt.summary.completedCreates).toBe(75);
    expect(firstMutationPosts[0].url.pathname).toBe('/objects/');
    expect(server.state.writeLog[0].authorization).toBe(`Bearer ${AGENCY_TOKEN}`);
    expect(server.state.writeLog.slice(1).every((write: any) =>
      write.authorization === `Bearer ${TOKEN}`
    )).toBe(true);
    for (const { path, status } of DOCUMENTED_CREATE_FAMILIES) {
      const requests = firstResult.receipt.requests.filter((request: any) =>
        request.method === 'POST' && request.path === path
      );
      expect(requests.length).toBeGreaterThan(0);
      expect(requests.every((request: any) =>
        request.status === status && request.accepted2xx === true
      )).toBe(true);
    }
    expect(firstResult.receipt.responseShapes).toEqual(expect.arrayContaining([
      { resource: 'pipeline.create', path: '$' },
      { resource: 'custom field folder.create', path: '$' },
      { resource: 'association.create', path: '$' }
    ]));
    expect(firstResult.receipt.actions.every((action: any) => action.status === 'exists')).toBe(true);
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
    const ids = testIds(TEST_SUFFIX);
    const homeowner = server.state.contacts.find((contact: any) => contact.name === ids.homeownerName);
    const business = server.state.businesses[0];
    const homeownerOpportunity = server.state.opportunities.find((opportunity: any) =>
      opportunity.name === ids.homeownerOpportunityName
    );
    const assignment = server.state.assignments[0];
    expect(assignment.properties).toMatchObject({
      rr_ghl_contact_id: homeowner.id,
      rr_ghl_opportunity_id: homeownerOpportunity.id,
      rr_ghl_business_id: business.id
    });
    expect(server.state.relations[0]).toMatchObject({
      firstRecordId: homeowner.id,
      secondRecordId: assignment.id
    });
    const recordedAtField = server.state.legacyFields.find((field: any) =>
      field.name === 'RR | Source Recorded At UTC'
    );
    const deterministicTimestamp = timestampFromTestSuffix(TEST_SUFFIX);
    expect(homeownerOpportunity.customFields.find((field: any) =>
      field.id === recordedAtField.id
    )?.fieldValue).toBe(deterministicTimestamp);
    expect(assignment.properties.rr_queued_at_utc).toBe(deterministicTimestamp);
    expect(deterministicTimestamp).not.toContain('2040-01-02');

    const second = mockFetch(server.router);
    const secondResult = await runSchemaTool({
      argv: requiredArgs(['--apply', '--test-suffix', TEST_SUFFIX]),
      fetchImpl: second.fetchImpl,
      env: credentialEnv(),
      now: () => new Date('2035-06-07T08:09:10.000Z')
    });
    expect(secondResult.receipt.verdict).toBe('APPLIED');
    expect(secondResult.receipt.acceptedCreates).toEqual([]);
    expect(secondResult.receipt.completed).toEqual([]);
    const secondMutationPosts = second.calls.filter((call) =>
      call.method === 'POST' &&
      call.url.pathname !== '/contacts/search' &&
      !call.url.pathname.endsWith('/records/search')
    );
    expect(secondMutationPosts).toEqual([]);
    expect(server.state.writeLog).toHaveLength(75);
  });

  test('retains compatibility with wrapped pipeline, folder, and association create envelopes', async () => {
    const server = statefulMissingSchemaServer(0, { envelope: 'wrapper' });
    const { fetchImpl } = mockFetch(server.router);
    const result = await runSchemaTool({
      argv: requiredArgs(['--apply', '--test-suffix', TEST_SUFFIX]),
      fetchImpl,
      env: credentialEnv(),
      now: () => NOW
    });
    expect(result.receipt.verdict).toBe('APPLIED');
    expect(result.receipt.acceptedCreates).toHaveLength(75);
    expect(result.receipt.completed).toHaveLength(75);
    expect(result.receipt.responseShapes).toEqual(expect.arrayContaining([
      { resource: 'pipeline.create', path: 'pipeline' },
      { resource: 'custom field folder.create', path: 'folder' },
      { resource: 'association.create', path: 'association' }
    ]));
  });

  test.each(DOCUMENTED_CREATE_FAMILIES)(
    'halts after one accepted $family POST when the 2xx status is not the documented status',
    async ({ family, path, status }) => {
      const server = statefulMissingSchemaServer(0, {
        failure: { family, kind: 'wrong-status' }
      });
      const { calls, fetchImpl } = mockFetch(server.router);
      const result = await runSchemaTool({
        argv: requiredArgs(['--apply', '--test-suffix', TEST_SUFFIX]),
        fetchImpl,
        env: credentialEnv(),
        now: () => NOW
      });
      const targetPosts = calls.filter((call) =>
        call.method === 'POST' && call.url.pathname === path
      );
      const targetRequests = result.receipt.requests.filter((request: any) =>
        request.method === 'POST' && request.path === path
      );
      const accepted = result.receipt.acceptedCreates.filter((entry: any) => entry.path === path);
      expect(result.receipt.haltReason.code).toBe('UNEXPECTED_SUCCESS_STATUS');
      expect(targetPosts).toHaveLength(1);
      expect(targetRequests).toEqual([
        expect.objectContaining({ status: status === 200 ? 201 : 200, accepted2xx: true })
      ]);
      expect(accepted).toHaveLength(1);
      expect(result.receipt.acceptedCreates.length).toBeGreaterThan(result.receipt.completed.length);
      expect(result.receipt.completed.some((entry: any) => entry.path === path)).toBe(false);
    }
  );

  test.each(DOCUMENTED_CREATE_FAMILIES)(
    'halts after one accepted $family POST when the create envelope has no ID',
    async ({ family, path, status }) => {
      const server = statefulMissingSchemaServer(0, {
        failure: { family, kind: 'missing-id' }
      });
      const { calls, fetchImpl } = mockFetch(server.router);
      const result = await runSchemaTool({
        argv: requiredArgs(['--apply', '--test-suffix', TEST_SUFFIX]),
        fetchImpl,
        env: credentialEnv(),
        now: () => NOW
      });
      const targetPosts = calls.filter((call) =>
        call.method === 'POST' && call.url.pathname === path
      );
      const targetRequest = result.receipt.requests.find((request: any) =>
        request.method === 'POST' && request.path === path
      );
      const accepted = result.receipt.acceptedCreates.filter((entry: any) => entry.path === path);
      expect(result.receipt.haltReason.code).toBe('CREATE_RESPONSE_ID_MISSING');
      expect(targetPosts).toHaveLength(1);
      expect(targetRequest).toEqual(expect.objectContaining({ status, accepted2xx: true }));
      expect(accepted).toHaveLength(1);
      expect(result.receipt.acceptedCreates.length).toBeGreaterThan(result.receipt.completed.length);
      expect(result.receipt.completed.some((entry: any) => entry.path === path)).toBe(false);
    }
  );

  test.each(DOCUMENTED_CREATE_FAMILIES)(
    'requires $family readback to match the exact server-assigned create ID',
    async ({ family, path, status }) => {
      const server = statefulMissingSchemaServer(0, {
        failure: { family, kind: 'id-mismatch' }
      });
      const { calls, fetchImpl } = mockFetch(server.router);
      const result = await runSchemaTool({
        argv: requiredArgs(['--apply', '--test-suffix', TEST_SUFFIX]),
        fetchImpl,
        env: credentialEnv(),
        now: () => NOW
      });
      const targetPosts = calls.filter((call) =>
        call.method === 'POST' && call.url.pathname === path
      );
      const accepted = result.receipt.acceptedCreates.filter((entry: any) => entry.path === path);
      expect(result.receipt.haltReason.code).toBe('CREATE_RESPONSE_ID_MISMATCH');
      expect(targetPosts).toHaveLength(1);
      expect(accepted).toEqual([
        expect.objectContaining({ status, resource: expect.any(String) })
      ]);
      expect(result.receipt.completed.some((entry: any) => entry.path === path)).toBe(false);
    }
  );

  test('reports an accepted partial TEST graph separately from readback-verified creates', async () => {
    const server = statefulMissingSchemaServer(0, {
      failure: { family: 'test-assignment', kind: 'missing-id' }
    });
    const { calls, fetchImpl } = mockFetch(server.router);
    const result = await runSchemaTool({
      argv: requiredArgs(['--apply', '--test-suffix', TEST_SUFFIX]),
      fetchImpl,
      env: credentialEnv(),
      now: () => NOW
    });
    const assignmentPath = `/objects/${server.manifest.customObject.key}/records`;
    expect(result.receipt.haltReason.code).toBe('CREATE_RESPONSE_ID_MISSING');
    expect(result.receipt.acceptedCreates).toHaveLength(74);
    expect(result.receipt.completed).toHaveLength(73);
    expect(result.receipt.summary.acceptedCreates).toBe(74);
    expect(result.receipt.summary.completedCreates).toBe(73);
    expect(result.receipt.testVerification).toMatchObject({
      recordsRead: true,
      recordsWritten: true
    });
    expect(result.receipt.acceptedCreates.at(-1)).toEqual(expect.objectContaining({
      resource: 'testAssignment',
      key: testIds(TEST_SUFFIX).assignmentExternalId,
      path: assignmentPath,
      status: 201
    }));
    expect(result.receipt.completed.some((entry: any) => entry.resource === 'testAssignment')).toBe(false);
    expect(calls.filter((call) =>
      call.method === 'POST' && call.url.pathname === assignmentPath
    )).toHaveLength(1);
    expect(calls.some((call) =>
      call.method === 'POST' && call.url.pathname === '/associations/relations'
    )).toBe(false);
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
