'use strict';

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const OFFICIAL_BASE_URL = 'https://services.leadconnectorhq.com';
const API_VERSION = 'v3';
const DEFAULT_MANIFEST_PATH = path.resolve(
  __dirname,
  '../spec/restoreradar-crm-schema-v1.json'
);

const READ_ENDPOINTS = [
  ['GET', /^\/locations\/[^/]+$/],
  ['GET', /^\/opportunities\/pipelines$/],
  ['GET', /^\/locations\/[^/]+\/customFields$/],
  ['GET', /^\/objects\/$/],
  ['GET', /^\/objects\/[^/]+$/],
  ['GET', /^\/custom-fields\/object-key\/[^/]+$/],
  ['GET', /^\/associations\/$/],
  ['GET', /^\/associations\/relations\/[^/]+$/],
  ['GET', /^\/businesses\/$/],
  ['GET', /^\/businesses\/[^/]+$/],
  ['GET', /^\/contacts\/[^/]+$/],
  ['GET', /^\/opportunities\/[^/]+$/],
  ['GET', /^\/opportunities\/search$/],
  ['GET', /^\/objects\/[^/]+\/records\/[^/]+$/],
  ['POST', /^\/contacts\/search$/],
  ['POST', /^\/objects\/[^/]+\/records\/search$/]
];

const MUTATION_ENDPOINTS = [
  ['POST', /^\/opportunities\/pipelines$/],
  ['POST', /^\/locations\/[^/]+\/customFields$/],
  ['POST', /^\/custom-fields\/folder$/],
  ['POST', /^\/custom-fields\/$/],
  ['POST', /^\/objects\/$/],
  ['POST', /^\/associations\/$/],
  ['POST', /^\/contacts\/$/],
  ['POST', /^\/opportunities\/$/],
  ['POST', /^\/objects\/[^/]+\/records$/],
  ['POST', /^\/associations\/relations$/]
];

const FORBIDDEN_ENDPOINT_PARTS = [
  '/conversations',
  '/messages',
  '/emails',
  '/sms',
  '/workflows',
  '/campaigns',
  '/snapshots'
];

class GuardError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'GuardError';
    this.code = code;
  }
}

class ApiError extends GuardError {
  constructor(status, method, endpoint) {
    super('API_ERROR', `HighLevel returned HTTP ${status} for ${method} ${endpoint}`);
    this.name = 'ApiError';
    this.status = status;
  }
}

function loadManifest(manifestPath = DEFAULT_MANIFEST_PATH) {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (manifest.api?.baseUrl !== OFFICIAL_BASE_URL) {
    throw new GuardError('BASE_URL_MISMATCH', 'Manifest does not pin the official HighLevel API origin');
  }
  if (manifest.api?.version !== API_VERSION) {
    throw new GuardError('VERSION_MISMATCH', 'Manifest does not pin the current v3 API version');
  }
  return manifest;
}

function parseArgs(argv, manifest) {
  const options = {
    apply: false,
    companyId: null,
    locationId: null,
    testSuffix: null,
    receiptPath: null,
    help: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--apply') {
      options.apply = true;
    } else if (argument === '--company-id') {
      options.companyId = argv[++index];
    } else if (argument === '--location-id') {
      options.locationId = argv[++index];
    } else if (argument === '--test-suffix') {
      options.testSuffix = argv[++index];
    } else if (argument === '--receipt') {
      options.receiptPath = argv[++index];
    } else if (argument === '--help' || argument === '-h') {
      options.help = true;
    } else {
      throw new GuardError('ARGUMENT_ERROR', `Unknown argument: ${argument}`);
    }
  }

  if (options.help) return options;
  if (!options.companyId || !options.locationId) {
    throw new GuardError(
      'IDENTITY_CONFIRMATION_REQUIRED',
      'Both --company-id and --location-id are required, including for dry-run'
    );
  }
  if (
    options.companyId !== manifest.identity.companyId ||
    options.locationId !== manifest.identity.locationId
  ) {
    throw new GuardError(
      'IDENTITY_CONFIRMATION_MISMATCH',
      'The confirmed company/location does not match the pinned RestoreRadar manifest'
    );
  }
  if (options.apply && !options.testSuffix) {
    throw new GuardError(
      'TEST_SUFFIX_REQUIRED',
      'Apply mode requires --test-suffix YYYYMMDDTHHMMSSZ so verification records are idempotent'
    );
  }
  if (options.testSuffix && !/^\d{8}T\d{6}Z$/.test(options.testSuffix)) {
    throw new GuardError('INVALID_TEST_SUFFIX', '--test-suffix must match YYYYMMDDTHHMMSSZ');
  }
  return options;
}

function defaultKeychainReader(service) {
  return execFileSync(
    '/usr/bin/security',
    ['find-generic-password', '-s', service, '-w'],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }
  ).trim();
}

function resolveCredential({ env, manifest, keychainReader = defaultKeychainReader }) {
  const inherited = env[manifest.api.keychainService];
  if (typeof inherited === 'string' && inherited.trim()) {
    return { token: inherited.trim(), source: 'inherited-env' };
  }

  let token = '';
  try {
    token = keychainReader(manifest.api.keychainService);
  } catch {
    throw new GuardError(
      'CREDENTIAL_UNAVAILABLE',
      `RestoreRadar credential is unavailable from inherited env or Keychain service ${manifest.api.keychainService}`
    );
  }
  if (typeof token !== 'string' || !token.trim()) {
    throw new GuardError('CREDENTIAL_UNAVAILABLE', 'RestoreRadar credential resolved to an empty value');
  }
  return { token: token.trim(), source: 'macOS-keychain' };
}

function endpointAllowed(method, pathname, rules) {
  return rules.some(([allowedMethod, pattern]) => allowedMethod === method && pattern.test(pathname));
}

function sanitizePath(pathname) {
  return pathname.replace(/\?.*$/, '');
}

function sanitizeError(error) {
  const code = error instanceof GuardError ? error.code : 'UNEXPECTED_ERROR';
  let message = error instanceof Error ? error.message : String(error);
  message = message
    .replace(/Bearer\s+[A-Za-z0-9._~+\/-]+/gi, 'Bearer [REDACTED]')
    .replace(/[A-Za-z0-9_-]{40,}/g, '[REDACTED]');
  return { code, message };
}

class HighLevelClient {
  constructor({ token, fetchImpl, apply, receipt, locationId }) {
    if (typeof fetchImpl !== 'function') {
      throw new GuardError('FETCH_UNAVAILABLE', 'A fetch implementation is required');
    }
    this.token = token;
    this.fetchImpl = fetchImpl;
    this.apply = apply;
    this.receipt = receipt;
    this.locationId = locationId;
  }

  async request(method, endpoint, { query, body, mutating = false } = {}) {
    method = method.toUpperCase();
    if (!endpoint.startsWith('/')) {
      throw new GuardError('ENDPOINT_NOT_RELATIVE', 'HighLevel endpoint must be a relative path');
    }

    const url = new URL(endpoint, OFFICIAL_BASE_URL);
    const pathname = url.pathname;
    if (FORBIDDEN_ENDPOINT_PARTS.some((part) => pathname.includes(part))) {
      throw new GuardError('FORBIDDEN_ENDPOINT', `Forbidden HighLevel endpoint: ${pathname}`);
    }
    if (method === 'PUT' || method === 'PATCH' || method === 'DELETE') {
      throw new GuardError('FORBIDDEN_METHOD', `${method} is never allowed by the additive schema tool`);
    }
    if (mutating) {
      if (!this.apply) {
        throw new GuardError('MUTATION_OPT_IN_REQUIRED', 'Mutation blocked because --apply was not supplied');
      }
      if (!endpointAllowed(method, pathname, MUTATION_ENDPOINTS)) {
        throw new GuardError('MUTATION_ENDPOINT_NOT_ALLOWLISTED', `${method} ${pathname} is not allowlisted`);
      }
    } else if (!endpointAllowed(method, pathname, READ_ENDPOINTS)) {
      throw new GuardError('READ_ENDPOINT_NOT_ALLOWLISTED', `${method} ${pathname} is not allowlisted`);
    }

    const pathLocationMatch = pathname.match(/^\/locations\/([^/]+)/);
    if (pathLocationMatch && decodeURIComponent(pathLocationMatch[1]) !== this.locationId) {
      throw new GuardError('CROSS_LOCATION_BLOCKED', 'Location path does not match RestoreRadar');
    }
    if (query?.locationId && query.locationId !== this.locationId) {
      throw new GuardError('CROSS_LOCATION_BLOCKED', 'Location query does not match RestoreRadar');
    }
    if (body?.locationId && body.locationId !== this.locationId) {
      throw new GuardError('CROSS_LOCATION_BLOCKED', 'Location payload does not match RestoreRadar');
    }

    for (const [key, value] of Object.entries(query || {})) {
      if (value === undefined || value === null) continue;
      if (Array.isArray(value)) {
        for (const item of value) url.searchParams.append(key, String(item));
      } else {
        url.searchParams.set(key, String(value));
      }
    }

    const requestReceipt = {
      method,
      path: pathname,
      version: API_VERSION,
      semantic: mutating ? 'create' : 'read',
      status: null
    };
    this.receipt.requests.push(requestReceipt);

    let response;
    try {
      response = await this.fetchImpl(url.toString(), {
        method,
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${this.token}`,
          Version: API_VERSION,
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' })
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) })
      });
    } catch {
      requestReceipt.status = 'NETWORK_ERROR';
      throw new GuardError('NETWORK_ERROR', `Network failure for ${method} ${pathname}`);
    }

    requestReceipt.status = response.status;
    if (!response.ok) throw new ApiError(response.status, method, pathname);
    const text = await response.text();
    if (!text.trim()) return {};
    try {
      return JSON.parse(text);
    } catch {
      throw new GuardError('INVALID_JSON_RESPONSE', `HighLevel returned invalid JSON for ${method} ${pathname}`);
    }
  }
}

function atPath(value, dottedPath) {
  return dottedPath.split('.').reduce((current, segment) => current?.[segment], value);
}

function recordResponseShape(receipt, resource, responsePath) {
  if (!receipt.responseShapes.some((entry) => entry.resource === resource && entry.path === responsePath)) {
    receipt.responseShapes.push({ resource, path: responsePath });
  }
}

function requireArray(payload, paths, resource, receipt) {
  if (Array.isArray(payload)) {
    recordResponseShape(receipt, resource, '$');
    return payload;
  }
  for (const responsePath of paths) {
    const value = atPath(payload, responsePath);
    if (Array.isArray(value)) {
      recordResponseShape(receipt, resource, responsePath);
      return value;
    }
  }
  throw new GuardError('RESPONSE_SHAPE_UNKNOWN', `No supported ${resource} array was found in the response`);
}

function requireObject(payload, paths, resource, receipt) {
  for (const responsePath of paths) {
    const value = responsePath === '$' ? payload : atPath(payload, responsePath);
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      recordResponseShape(receipt, resource, responsePath);
      return value;
    }
  }
  throw new GuardError('RESPONSE_SHAPE_UNKNOWN', `No supported ${resource} object was found in the response`);
}

async function verifyIdentity(client, manifest, receipt) {
  const payload = await client.request('GET', `/locations/${encodeURIComponent(manifest.identity.locationId)}`);
  const location = requireObject(payload, ['location', 'data.location', '$'], 'locationIdentity', receipt);
  const observedLocationId = location.id || location.locationId;
  const observedCompanyId = location.companyId || location.company_id;
  receipt.observedIdentity = {
    companyId: observedCompanyId || null,
    locationId: observedLocationId || null
  };
  if (
    observedLocationId !== manifest.identity.locationId ||
    observedCompanyId !== manifest.identity.companyId
  ) {
    throw new GuardError(
      'TOKEN_LOCATION_IDENTITY_MISMATCH',
      'RestoreRadar token/location identity did not match the pinned company and location'
    );
  }
}

async function readPipelines(client, manifest, receipt) {
  const payload = await client.request('GET', '/opportunities/pipelines', {
    query: { locationId: manifest.identity.locationId }
  });
  return requireArray(payload, ['pipelines', 'data.pipelines'], 'pipelines', receipt);
}

async function readLegacyFields(client, manifest, receipt, model = 'all') {
  const payload = await client.request(
    'GET',
    `/locations/${encodeURIComponent(manifest.identity.locationId)}/customFields`,
    { query: { model } }
  );
  return requireArray(payload, ['customFields', 'data.customFields'], `legacyFields.${model}`, receipt);
}

async function readObjects(client, manifest, receipt) {
  const payload = await client.request('GET', '/objects/', {
    query: { locationId: manifest.identity.locationId }
  });
  return requireArray(payload, ['objects', 'data.objects'], 'objects', receipt);
}

async function readObjectDetails(client, manifest, receipt, objectKey) {
  const payload = await client.request('GET', `/objects/${encodeURIComponent(objectKey)}`, {
    query: { locationId: manifest.identity.locationId, fetchProperties: true }
  });
  const object = requireObject(payload, ['object', 'data.object'], `object.${objectKey}`, receipt);
  let fields = [];
  for (const responsePath of ['fields', 'data.fields', 'object.fields', 'data.object.fields']) {
    const value = atPath(payload, responsePath);
    if (Array.isArray(value)) {
      fields = value;
      recordResponseShape(receipt, `objectFields.${objectKey}`, responsePath);
      break;
    }
  }
  return { object, fields };
}

async function readV2Fields(client, manifest, receipt, objectKey) {
  const payload = await client.request(
    'GET',
    `/custom-fields/object-key/${encodeURIComponent(objectKey)}`,
    { query: { locationId: manifest.identity.locationId } }
  );
  return {
    fields: requireArray(payload, ['fields', 'data.fields'], `v2Fields.${objectKey}`, receipt),
    folders: requireArray(payload, ['folders', 'data.folders'], `v2Folders.${objectKey}`, receipt)
  };
}

async function readAssociations(client, manifest, receipt) {
  const payload = await client.request('GET', '/associations/', {
    query: { locationId: manifest.identity.locationId, skip: 0, limit: 100 }
  });
  return requireArray(payload, ['associations', 'data.associations'], 'associations', receipt);
}

function stageNames(pipeline) {
  return [...(Array.isArray(pipeline.stages) ? pipeline.stages : [])]
    .map((stage, index) => ({
      name: typeof stage === 'string' ? stage : stage?.name,
      position: typeof stage === 'string' ? index + 1 : Number(stage?.position ?? index + 1)
    }))
    .sort((left, right) => left.position - right.position)
    .map((stage) => stage.name);
}

function sameStringArray(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function sameOptions(left = [], right = []) {
  const normalize = (options) => options
    .map((option) => ({ key: option?.key, label: option?.label }))
    .sort((a, b) => `${a.key}:${a.label}`.localeCompare(`${b.key}:${b.label}`));
  return JSON.stringify(normalize(left)) === JSON.stringify(normalize(right));
}

function findPipeline(pipelines, expected) {
  const matches = pipelines.filter(
    (pipeline) => String(pipeline?.name || '').toLowerCase() === expected.name.toLowerCase()
  );
  if (!matches.length) return { state: 'missing' };
  if (matches.length !== 1 || !sameStringArray(stageNames(matches[0]), expected.stages)) {
    return { state: 'collision', reason: `Pipeline ${expected.name} exists with incompatible stages` };
  }
  return { state: 'exact', value: matches[0] };
}

function findLegacyField(fields, model, name) {
  const matches = fields.filter((field) => field?.model === model && field?.name === name);
  if (!matches.length) return { state: 'missing' };
  if (matches.length !== 1 || String(matches[0]?.dataType).toUpperCase() !== 'TEXT') {
    return { state: 'collision', reason: `${model} field ${name} is incompatible` };
  }
  return { state: 'exact', value: matches[0] };
}

function findObject(objects, expected) {
  const matches = objects.filter((object) =>
    object?.key === expected.key ||
    object?.labels?.singular === expected.labels.singular ||
    object?.labels?.plural === expected.labels.plural
  );
  if (!matches.length) return { state: 'missing' };
  const object = matches[0];
  const exact = matches.length === 1 &&
    object.key === expected.key &&
    object.labels?.singular === expected.labels.singular &&
    object.labels?.plural === expected.labels.plural &&
    object.description === expected.description &&
    object.primaryDisplayProperty === expected.primaryDisplayPropertyDetails.key;
  if (!exact) return { state: 'collision', reason: `Custom object ${expected.key} is incompatible` };
  return { state: 'exact', value: object };
}

function findFolder(folders, objectKey, name) {
  const matches = folders.filter((folder) => folder?.objectKey === objectKey && folder?.name === name);
  if (!matches.length) return { state: 'missing' };
  if (matches.length !== 1 || !matches[0]?.id) {
    return { state: 'collision', reason: `Folder ${name} for ${objectKey} is ambiguous` };
  }
  return { state: 'exact', value: matches[0] };
}

function findV2Field(fields, expected, { bySuffix = false } = {}) {
  const fieldKeyMatch = (field) => bySuffix
    ? String(field?.fieldKey || '').endsWith(`.${expected.suffix}`)
    : field?.fieldKey === expected.fieldKey;
  const matches = fields.filter((field) => fieldKeyMatch(field) || field?.name === expected.name);
  if (!matches.length) return { state: 'missing' };
  const field = matches[0];
  const exactKey = bySuffix
    ? String(field?.fieldKey || '').endsWith(`.${expected.suffix}`)
    : field?.fieldKey === expected.fieldKey;
  const exact = matches.length === 1 && exactKey &&
    field.name === expected.name &&
    field.dataType === expected.dataType &&
    sameOptions(field.options || [], expected.options || []);
  if (!exact) {
    return { state: 'collision', reason: `V2 field ${expected.name} is incompatible` };
  }
  return { state: 'exact', value: field };
}

function findAssociation(associations, expected) {
  const matches = associations.filter((association) =>
    association?.key === expected.key ||
    (
      association?.firstObjectKey === expected.firstObjectKey &&
      association?.secondObjectKey === expected.secondObjectKey
    )
  );
  if (!matches.length) return { state: 'missing' };
  const association = matches[0];
  const exact = matches.length === 1 &&
    association.key === expected.key &&
    association.firstObjectLabel === expected.firstObjectLabel &&
    association.firstObjectKey === expected.firstObjectKey &&
    association.secondObjectLabel === expected.secondObjectLabel &&
    association.secondObjectKey === expected.secondObjectKey;
  if (!exact) return { state: 'collision', reason: `Association ${expected.key} is incompatible` };
  return { state: 'exact', value: association };
}

function customFieldPrefixFromReadback(manifest, v2Fields, objectDetails) {
  const suffix = 'rr_assignment_id';
  const sources = [
    v2Fields.map((field) => field?.fieldKey),
    objectDetails.fields.map((field) => field?.fieldKey),
    [objectDetails.object?.primaryDisplayProperty]
  ];
  const candidates = sources
    .map((source) => source.filter(
      (fieldKey) => typeof fieldKey === 'string' && fieldKey.endsWith(`.${suffix}`)
    ))
    .find((source) => source.length > 0) || [];
  const prefixes = [...new Set(candidates.map((fieldKey) => fieldKey.slice(0, -suffix.length)))];
  if (!prefixes.length) return { state: 'unknown' };
  if (prefixes.length !== 1 || !/^custom_objects?\.rr_lead_assignment\.$/.test(prefixes[0])) {
    return {
      state: 'collision',
      reason: 'Server readback returned an incompatible or ambiguous custom-object field prefix'
    };
  }
  return { state: 'exact', prefix: prefixes[0] };
}

async function discoverSchema(client, manifest, receipt) {
  const pipelines = await readPipelines(client, manifest, receipt);
  const legacyFields = await readLegacyFields(client, manifest, receipt, 'all');
  const objects = await readObjects(client, manifest, receipt);
  const businessV2 = await readV2Fields(client, manifest, receipt, manifest.business.objectKey);
  const associations = await readAssociations(client, manifest, receipt);
  const objectMatch = findObject(objects, manifest.customObject);
  let customV2 = { fields: [], folders: [] };
  let objectDetails = null;
  let customFieldPrefix = { state: 'unknown' };
  if (objectMatch.state === 'exact') {
    customV2 = await readV2Fields(client, manifest, receipt, objectMatch.value.key);
    objectDetails = await readObjectDetails(client, manifest, receipt, objectMatch.value.key);
    customFieldPrefix = customFieldPrefixFromReadback(
      manifest,
      customV2.fields,
      objectDetails
    );
  }
  return {
    pipelines,
    legacyFields,
    objects,
    businessV2,
    associations,
    objectMatch,
    customV2,
    objectDetails,
    customFieldPrefix
  };
}

function addPlanResult(plan, result, action) {
  if (result.state === 'exact') {
    plan.existing += 1;
    plan.actions.push({ ...action, status: 'exists' });
  } else if (result.state === 'missing') {
    plan.plannedCreates += 1;
    plan.actions.push({ ...action, status: 'create' });
  } else {
    plan.collisions.push({ resource: action.resource, key: action.key, reason: result.reason });
    plan.actions.push({ ...action, status: 'collision' });
  }
}

function planSchema(manifest, discovery) {
  const plan = {
    existing: 0,
    plannedCreates: 0,
    actions: [],
    collisions: [],
    blockers: [],
    notProven: []
  };

  for (const pipeline of manifest.pipelines) {
    addPlanResult(plan, findPipeline(discovery.pipelines, pipeline), {
      resource: 'pipeline',
      key: pipeline.name,
      method: 'POST',
      path: '/opportunities/pipelines'
    });
  }

  for (const model of ['contact', 'opportunity']) {
    for (const name of manifest.legacyFields[model]) {
      addPlanResult(plan, findLegacyField(discovery.legacyFields, model, name), {
        resource: `${model}Field`,
        key: name,
        method: 'POST',
        path: `/locations/${manifest.identity.locationId}/customFields`
      });
    }
  }

  addPlanResult(
    plan,
    findFolder(discovery.businessV2.folders, manifest.business.objectKey, manifest.business.folder),
    {
      resource: 'businessFieldFolder',
      key: manifest.business.folder,
      method: 'POST',
      path: '/custom-fields/folder'
    }
  );
  for (const field of manifest.business.fields) {
    addPlanResult(plan, findV2Field(discovery.businessV2.fields, field), {
      resource: 'businessField',
      key: field.fieldKey,
      method: 'POST',
      path: '/custom-fields/'
    });
  }

  addPlanResult(plan, discovery.objectMatch, {
    resource: 'customObject',
    key: manifest.customObject.key,
    method: 'POST',
    path: '/objects/'
  });

  if (discovery.objectMatch.state === 'exact') {
    if (discovery.customFieldPrefix.state === 'collision') {
      plan.blockers.push({
        resource: 'customObjectFieldPrefix',
        reason: discovery.customFieldPrefix.reason
      });
    } else if (discovery.customFieldPrefix.state !== 'exact') {
      plan.blockers.push({
        resource: 'customObjectFieldPrefix',
        reason: 'Server readback did not expose a usable custom-object field prefix'
      });
    }
    addPlanResult(
      plan,
      findFolder(
        discovery.customV2.folders,
        discovery.objectMatch.value.key,
        manifest.customObject.folder
      ),
      {
        resource: 'customObjectFieldFolder',
        key: manifest.customObject.folder,
        method: 'POST',
        path: '/custom-fields/folder'
      }
    );
    for (const field of manifest.customObject.fields) {
      addPlanResult(plan, findV2Field(discovery.customV2.fields, field, { bySuffix: true }), {
        resource: 'customObjectField',
        key: field.suffix,
        method: 'POST',
        path: '/custom-fields/'
      });
    }
  } else if (discovery.objectMatch.state === 'missing') {
    plan.notProven.push(
      'Custom Fields V2 prefix and dependent folder/fields require post-create server readback; no singular/plural prefix was guessed.'
    );
    plan.actions.push({
      resource: 'customObjectFieldPrefix',
      key: manifest.customObject.key,
      method: 'GET',
      path: `/objects/${manifest.customObject.key}`,
      status: 'deferred-until-readback'
    });
    plan.plannedCreates += 1 + manifest.customObject.fields.length;
  }

  addPlanResult(plan, findAssociation(discovery.associations, manifest.association), {
    resource: 'association',
    key: manifest.association.key,
    method: 'POST',
    path: '/associations/'
  });

  return plan;
}

function requireNoCollision(result) {
  if (result.state === 'collision') {
    throw new GuardError('INCOMPATIBLE_COLLISION', result.reason);
  }
  return result;
}

function recordCompletedCreate(receipt, resource, key, endpoint) {
  receipt.completed.push({ resource, key, method: 'POST', path: endpoint, status: 'created' });
}

function pipelinePayload(manifest, pipeline) {
  return {
    name: pipeline.name,
    locationId: manifest.identity.locationId,
    stages: pipeline.stages.map((name, index) => ({
      name,
      position: index + 1,
      showInFunnel: true
    }))
  };
}

async function ensurePipeline(client, manifest, receipt, expected) {
  let result = requireNoCollision(findPipeline(await readPipelines(client, manifest, receipt), expected));
  if (result.state === 'exact') return result.value;
  await client.request('POST', '/opportunities/pipelines', {
    mutating: true,
    body: pipelinePayload(manifest, expected)
  });
  recordCompletedCreate(receipt, 'pipeline', expected.name, '/opportunities/pipelines');
  result = requireNoCollision(findPipeline(await readPipelines(client, manifest, receipt), expected));
  if (result.state !== 'exact') {
    throw new GuardError('CREATE_READBACK_FAILED', `Pipeline ${expected.name} was not confirmed after create`);
  }
  return result.value;
}

async function ensureLegacyField(client, manifest, receipt, model, name) {
  let fields = await readLegacyFields(client, manifest, receipt, model);
  let result = requireNoCollision(findLegacyField(fields, model, name));
  if (result.state === 'exact') return result.value;
  const endpoint = `/locations/${encodeURIComponent(manifest.identity.locationId)}/customFields`;
  await client.request('POST', endpoint, {
    mutating: true,
    body: { name, dataType: 'TEXT', model }
  });
  recordCompletedCreate(receipt, `${model}Field`, name, endpoint);
  fields = await readLegacyFields(client, manifest, receipt, model);
  result = requireNoCollision(findLegacyField(fields, model, name));
  if (result.state !== 'exact') {
    throw new GuardError('CREATE_READBACK_FAILED', `${model} field ${name} was not confirmed after create`);
  }
  return result.value;
}

async function ensureFolder(client, manifest, receipt, objectKey, name) {
  let current = await readV2Fields(client, manifest, receipt, objectKey);
  let result = requireNoCollision(findFolder(current.folders, objectKey, name));
  if (result.state === 'exact') return result.value;
  await client.request('POST', '/custom-fields/folder', {
    mutating: true,
    body: { objectKey, name, locationId: manifest.identity.locationId }
  });
  recordCompletedCreate(receipt, 'customFieldFolder', `${objectKey}:${name}`, '/custom-fields/folder');
  current = await readV2Fields(client, manifest, receipt, objectKey);
  result = requireNoCollision(findFolder(current.folders, objectKey, name));
  if (result.state !== 'exact') {
    throw new GuardError('CREATE_READBACK_FAILED', `Folder ${name} for ${objectKey} was not confirmed`);
  }
  return result.value;
}

async function ensureV2Field(client, manifest, receipt, objectKey, folderId, expected, fieldKey) {
  const bySuffix = Boolean(expected.suffix);
  let current = await readV2Fields(client, manifest, receipt, objectKey);
  let result = requireNoCollision(findV2Field(current.fields, expected, { bySuffix }));
  if (result.state === 'exact') return result.value;
  await client.request('POST', '/custom-fields/', {
    mutating: true,
    body: {
      locationId: manifest.identity.locationId,
      name: expected.name,
      showInForms: false,
      ...(expected.options ? { options: expected.options } : {}),
      dataType: expected.dataType,
      fieldKey,
      objectKey,
      parentId: folderId
    }
  });
  recordCompletedCreate(receipt, 'customField', fieldKey, '/custom-fields/');
  current = await readV2Fields(client, manifest, receipt, objectKey);
  result = requireNoCollision(findV2Field(current.fields, expected, { bySuffix }));
  if (result.state !== 'exact') {
    throw new GuardError('CREATE_READBACK_FAILED', `V2 field ${expected.name} was not confirmed`);
  }
  return result.value;
}

async function ensureCustomObject(client, manifest, receipt) {
  let objects = await readObjects(client, manifest, receipt);
  let result = requireNoCollision(findObject(objects, manifest.customObject));
  if (result.state === 'exact') return result.value;
  await client.request('POST', '/objects/', {
    mutating: true,
    body: {
      labels: manifest.customObject.labels,
      key: manifest.customObject.key,
      description: manifest.customObject.description,
      locationId: manifest.identity.locationId,
      primaryDisplayPropertyDetails: manifest.customObject.primaryDisplayPropertyDetails
    }
  });
  recordCompletedCreate(receipt, 'customObject', manifest.customObject.key, '/objects/');
  objects = await readObjects(client, manifest, receipt);
  result = requireNoCollision(findObject(objects, manifest.customObject));
  if (result.state !== 'exact') {
    throw new GuardError('CREATE_READBACK_FAILED', 'Custom object was not confirmed after create');
  }
  return result.value;
}

async function resolveCustomObjectFieldPrefix(client, manifest, receipt, objectKey) {
  const v2 = await readV2Fields(client, manifest, receipt, objectKey);
  const details = await readObjectDetails(client, manifest, receipt, objectKey);
  const result = customFieldPrefixFromReadback(manifest, v2.fields, details);
  if (result.state !== 'exact') {
    throw new GuardError(
      'CUSTOM_OBJECT_PREFIX_NOT_PROVEN',
      result.reason || 'Server did not expose the custom-object field prefix after readback'
    );
  }
  return result.prefix;
}

async function ensureAssociation(client, manifest, receipt) {
  let associations = await readAssociations(client, manifest, receipt);
  let result = requireNoCollision(findAssociation(associations, manifest.association));
  if (result.state === 'exact') return result.value;
  await client.request('POST', '/associations/', {
    mutating: true,
    body: { locationId: manifest.identity.locationId, ...manifest.association }
  });
  recordCompletedCreate(receipt, 'association', manifest.association.key, '/associations/');
  associations = await readAssociations(client, manifest, receipt);
  result = requireNoCollision(findAssociation(associations, manifest.association));
  if (result.state !== 'exact') {
    throw new GuardError('CREATE_READBACK_FAILED', 'Association was not confirmed after create');
  }
  return result.value;
}

async function applySchema(client, manifest, receipt) {
  for (const pipeline of manifest.pipelines) {
    await ensurePipeline(client, manifest, receipt, pipeline);
  }
  for (const model of ['contact', 'opportunity']) {
    for (const name of manifest.legacyFields[model]) {
      await ensureLegacyField(client, manifest, receipt, model, name);
    }
  }

  const businessFolder = await ensureFolder(
    client,
    manifest,
    receipt,
    manifest.business.objectKey,
    manifest.business.folder
  );
  for (const field of manifest.business.fields) {
    await ensureV2Field(
      client,
      manifest,
      receipt,
      manifest.business.objectKey,
      businessFolder.id,
      field,
      field.fieldKey
    );
  }

  const customObject = await ensureCustomObject(client, manifest, receipt);
  if (customObject.key !== manifest.customObject.key) {
    throw new GuardError('CUSTOM_OBJECT_KEY_MISMATCH', 'Server returned an unexpected custom-object key');
  }
  const fieldPrefix = await resolveCustomObjectFieldPrefix(
    client,
    manifest,
    receipt,
    customObject.key
  );
  const customFolder = await ensureFolder(
    client,
    manifest,
    receipt,
    customObject.key,
    manifest.customObject.folder
  );
  for (const field of manifest.customObject.fields) {
    await ensureV2Field(
      client,
      manifest,
      receipt,
      customObject.key,
      customFolder.id,
      field,
      `${fieldPrefix}${field.suffix}`
    );
  }
  await ensureAssociation(client, manifest, receipt);
}

function testIds(suffix) {
  return {
    homeownerExternalId: `rr_test_homeowner_${suffix}`,
    providerExternalId: `rr_test_provider_${suffix}`,
    requestExternalId: `rr_test_request_${suffix}`,
    assignmentExternalId: `rr_test_assignment_${suffix}`,
    sourceEventId: `rr_test_event_${suffix}`,
    homeownerName: `RR TEST Homeowner ${suffix}`,
    providerName: `RR TEST Provider Contact ${suffix}`,
    businessName: `RR TEST Provider Business ${suffix}`,
    homeownerOpportunityName: `RR TEST Homeowner Request ${suffix}`,
    providerOpportunityName: `RR TEST Provider Sale ${suffix}`
  };
}

function customValues(fieldIds, values) {
  return Object.entries(values)
    .filter(([, value]) => value !== undefined && value !== null)
    .map(([name, fieldValue]) => {
      const id = fieldIds[name];
      if (!id) throw new GuardError('FIELD_ID_MISSING', `No confirmed field ID for ${name}`);
      return { id, fieldValue };
    });
}

function buildContactPayloads({ manifest, suffix, fieldIds }) {
  const ids = testIds(suffix);
  const shared = {
    locationId: manifest.identity.locationId,
    dnd: true,
    tags: manifest.testRecords.tags,
    source: 'RestoreRadar schema verification'
  };
  return {
    homeowner: {
      ...shared,
      name: ids.homeownerName,
      customFields: customValues(fieldIds, {
        'RR | Homeowner External ID': ids.homeownerExternalId,
        'RR | Environment': manifest.testRecords.environment,
        'RR | Consent Status': manifest.testRecords.consentStatus,
        'RR | Consent Version': 'NOT_APPLICABLE',
        'RR | Source Event ID': ids.sourceEventId,
        'RR | Projection Version': manifest.testRecords.projectionVersion
      })
    },
    provider: {
      ...shared,
      name: ids.providerName,
      customFields: customValues(fieldIds, {
        'RR | Environment': manifest.testRecords.environment,
        'RR | Consent Status': manifest.testRecords.consentStatus,
        'RR | Consent Version': 'NOT_APPLICABLE',
        'RR | Source Event ID': ids.sourceEventId,
        'RR | Projection Version': manifest.testRecords.projectionVersion
      })
    }
  };
}

function buildBusinessRecordPayload({ manifest, suffix }) {
  const ids = testIds(suffix);
  return {
    locationId: manifest.identity.locationId,
    properties: {
      name: ids.businessName,
      rr_external_provider_id: ids.providerExternalId,
      rr_provider_slug: `rr-test-provider-${suffix.toLowerCase()}`,
      rr_environment: manifest.testRecords.environment,
      rr_source_event_id: ids.sourceEventId,
      rr_projection_version: manifest.testRecords.projectionVersion
    }
  };
}

function buildOpportunityPayloads({
  manifest,
  suffix,
  nowIso,
  fieldIds,
  pipelines,
  homeownerContactId,
  providerContactId,
  businessId
}) {
  const ids = testIds(suffix);
  const homeownerPipeline = pipelines[manifest.pipelines[0].name];
  const providerPipeline = pipelines[manifest.pipelines[1].name];
  if (!homeownerPipeline?.id || !homeownerPipeline?.stageId || !providerPipeline?.id || !providerPipeline?.stageId) {
    throw new GuardError('PIPELINE_ID_MISSING', 'Confirmed pipeline/stage IDs are required for TEST opportunities');
  }
  return {
    homeowner: {
      locationId: manifest.identity.locationId,
      pipelineId: homeownerPipeline.id,
      pipelineStageId: homeownerPipeline.stageId,
      name: ids.homeownerOpportunityName,
      status: 'open',
      contactId: homeownerContactId,
      customFields: customValues(fieldIds, {
        'RR | Request External ID': ids.requestExternalId,
        'RR | Environment': manifest.testRecords.environment,
        'RR | Request Service': 'TEST_ONLY',
        'RR | Request City': 'TEST_ONLY',
        'RR | Request ZIP': '00000',
        'RR | Request Urgency': 'TEST_ONLY',
        'RR | Consent Status': manifest.testRecords.consentStatus,
        'RR | Consent Version': 'NOT_APPLICABLE',
        'RR | Attribution Source': 'TEST_ONLY',
        'RR | Attribution Medium': 'TEST_ONLY',
        'RR | Attribution Campaign': 'RR_SCHEMA_VERIFICATION',
        'RR | UTM Source': 'TEST_ONLY',
        'RR | UTM Medium': 'TEST_ONLY',
        'RR | UTM Campaign': 'RR_SCHEMA_VERIFICATION',
        'RR | UTM Term': 'TEST_NOT_APPLICABLE',
        'RR | UTM Content': 'TEST_NOT_APPLICABLE',
        'RR | Referrer URL': 'TEST_NOT_APPLICABLE',
        'RR | Landing Page': 'TEST_NOT_APPLICABLE',
        'RR | GCLID': 'TEST_NOT_APPLICABLE',
        'RR | FBCLID': 'TEST_NOT_APPLICABLE',
        'RR | MSCLKID': 'TEST_NOT_APPLICABLE',
        'RR | Form Version': 'rr-schema-verification/v1',
        'RR | Source Event ID': ids.sourceEventId,
        'RR | Source Recorded At UTC': nowIso,
        'RR | Projection Version': manifest.testRecords.projectionVersion
      })
    },
    provider: {
      locationId: manifest.identity.locationId,
      pipelineId: providerPipeline.id,
      pipelineStageId: providerPipeline.stageId,
      name: ids.providerOpportunityName,
      status: 'open',
      contactId: providerContactId,
      customFields: customValues(fieldIds, {
        'RR | Provider External ID': ids.providerExternalId,
        'RR | GHL Business ID': businessId,
        'RR | Environment': manifest.testRecords.environment,
        'RR | Source Event ID': ids.sourceEventId,
        'RR | Source Recorded At UTC': nowIso,
        'RR | Projection Version': manifest.testRecords.projectionVersion
      })
    }
  };
}

function buildAssignmentRecordPayload({
  manifest,
  suffix,
  nowIso,
  homeownerContactId,
  homeownerOpportunityId,
  businessId
}) {
  const ids = testIds(suffix);
  return {
    locationId: manifest.identity.locationId,
    properties: {
      rr_assignment_id: ids.assignmentExternalId,
      rr_external_request_id: ids.requestExternalId,
      rr_external_provider_id: ids.providerExternalId,
      rr_ghl_contact_id: homeownerContactId,
      rr_ghl_opportunity_id: homeownerOpportunityId,
      rr_ghl_business_id: businessId,
      rr_environment: manifest.testRecords.environment,
      rr_assignment_state: 'Queued',
      rr_source_event_id: ids.sourceEventId,
      rr_projection_version: manifest.testRecords.projectionVersion,
      rr_queued_at_utc: nowIso
    }
  };
}

function assertNoProhibitedPayloadData(payload, manifest) {
  const forbidden = new Set(manifest.prohibitedProjectionFields.map((key) => key.toLowerCase()));
  function walk(value) {
    if (!value || typeof value !== 'object') return;
    for (const [key, nested] of Object.entries(value)) {
      if (forbidden.has(key.toLowerCase())) {
        throw new GuardError('PROHIBITED_PROJECTION_FIELD', `Payload contains prohibited field ${key}`);
      }
      walk(nested);
    }
  }
  walk(payload);
}

function assertTestContact(payload) {
  if (!payload?.name?.startsWith('RR TEST ') || payload.dnd !== true) {
    throw new GuardError('TEST_RECORD_GUARD', 'TEST contact must be unmistakably named and DND');
  }
  if ('email' in payload || 'phone' in payload) {
    throw new GuardError('TEST_RECORD_GUARD', 'TEST contact must not contain email or phone channels');
  }
}

async function searchContact(client, manifest, receipt, name) {
  const payload = await client.request('POST', '/contacts/search', {
    body: { locationId: manifest.identity.locationId, pageLimit: 25, query: name }
  });
  const contacts = requireArray(payload, ['contacts', 'data.contacts'], 'contacts.search', receipt)
    .filter((contact) => contact?.name === name);
  if (contacts.length > 1) throw new GuardError('INCOMPATIBLE_COLLISION', `Multiple TEST contacts named ${name}`);
  return contacts[0] || null;
}

async function readContact(client, receipt, contactId) {
  const payload = await client.request('GET', `/contacts/${encodeURIComponent(contactId)}`);
  return requireObject(payload, ['contact', 'data.contact', '$'], 'contact.readback', receipt);
}

function customFieldValuesMatch(actualFields, expectedFields) {
  if (!Array.isArray(actualFields)) return false;
  return expectedFields.every((expected) => actualFields.some((actual) =>
    actual?.id === expected.id &&
    (actual?.fieldValue ?? actual?.field_value ?? actual?.value) === expected.fieldValue
  ));
}

function exactTestContactReadback(contact, expected) {
  const tags = Array.isArray(contact?.tags) ? contact.tags : [];
  return contact?.name === expected.name &&
    contact?.dnd === true &&
    !contact?.email &&
    !contact?.phone &&
    expected.tags.every((tag) => tags.includes(tag)) &&
    customFieldValuesMatch(contact?.customFields, expected.customFields);
}

async function ensureTestContact(client, manifest, receipt, name, payload) {
  assertTestContact(payload);
  assertNoProhibitedPayloadData(payload, manifest);
  let contact = await searchContact(client, manifest, receipt, name);
  if (contact) {
    const readback = await readContact(client, receipt, contact.id);
    if (!exactTestContactReadback(readback, payload)) {
      throw new GuardError('INCOMPATIBLE_COLLISION', `TEST contact ${name} is not an exact safe match`);
    }
    return readback;
  }
  await client.request('POST', '/contacts/', { mutating: true, body: payload });
  recordCompletedCreate(receipt, 'testContact', name, '/contacts/');
  contact = await searchContact(client, manifest, receipt, name);
  if (!contact?.id) throw new GuardError('CREATE_READBACK_FAILED', `TEST contact ${name} was not confirmed`);
  const readback = await readContact(client, receipt, contact.id);
  if (!exactTestContactReadback(readback, payload)) {
    throw new GuardError('CREATE_READBACK_FAILED', `TEST contact ${name} failed safe readback validation`);
  }
  return readback;
}

async function readBusinesses(client, manifest, receipt) {
  const payload = await client.request('GET', '/businesses/', {
    query: { locationId: manifest.identity.locationId, limit: 100, skip: 0 }
  });
  return requireArray(payload, ['businesses', 'data.businesses'], 'businesses', receipt);
}

async function readObjectRecord(client, receipt, schemaKey, recordId) {
  const payload = await client.request(
    'GET',
    `/objects/${encodeURIComponent(schemaKey)}/records/${encodeURIComponent(recordId)}`
  );
  return requireObject(payload, ['record', 'data.record'], `record.readback.${schemaKey}`, receipt);
}

function propertiesMatch(actual, expected) {
  if (!actual || typeof actual !== 'object' || Array.isArray(actual)) return false;
  return Object.entries(expected).every(([key, value]) => actual[key] === value);
}

async function ensureTestBusiness(client, manifest, receipt, name, payload) {
  assertNoProhibitedPayloadData(payload, manifest);
  if (!name.startsWith('RR TEST ') || payload.properties?.rr_environment !== 'TEST') {
    throw new GuardError('TEST_RECORD_GUARD', 'TEST business must be unmistakably named and marked TEST');
  }
  if ('email' in payload.properties || 'phone' in payload.properties) {
    throw new GuardError('TEST_RECORD_GUARD', 'TEST business must not contain communication channels');
  }
  let businesses = await readBusinesses(client, manifest, receipt);
  let matches = businesses.filter((business) => business?.name === name);
  if (matches.length > 1) throw new GuardError('INCOMPATIBLE_COLLISION', `Multiple TEST businesses named ${name}`);
  if (matches.length === 1) {
    const readback = await readObjectRecord(client, receipt, 'business', matches[0].id);
    if (!propertiesMatch(readback.properties, payload.properties)) {
      throw new GuardError('INCOMPATIBLE_COLLISION', `TEST business ${name} is not an exact TEST match`);
    }
    return { ...matches[0], ...readback };
  }
  await client.request('POST', '/objects/business/records', { mutating: true, body: payload });
  recordCompletedCreate(receipt, 'testBusiness', name, '/objects/business/records');
  businesses = await readBusinesses(client, manifest, receipt);
  matches = businesses.filter((business) => business?.name === name);
  if (matches.length !== 1 || !matches[0]?.id) {
    throw new GuardError('CREATE_READBACK_FAILED', `TEST business ${name} was not confirmed`);
  }
  const readback = await readObjectRecord(client, receipt, 'business', matches[0].id);
  if (!propertiesMatch(readback.properties, payload.properties)) {
    throw new GuardError('CREATE_READBACK_FAILED', `TEST business ${name} failed exact readback`);
  }
  return { ...matches[0], ...readback };
}

async function searchOpportunity(client, manifest, receipt, name, pipelineId) {
  const payload = await client.request('GET', '/opportunities/search', {
    query: { locationId: manifest.identity.locationId, q: name, pipelineId, limit: 100 }
  });
  const opportunities = requireArray(
    payload,
    ['opportunities', 'data.opportunities'],
    'opportunities.search',
    receipt
  ).filter((opportunity) => opportunity?.name === name && opportunity?.pipelineId === pipelineId);
  if (opportunities.length > 1) {
    throw new GuardError('INCOMPATIBLE_COLLISION', `Multiple TEST opportunities named ${name}`);
  }
  return opportunities[0] || null;
}

async function readOpportunity(client, receipt, opportunityId) {
  const payload = await client.request('GET', `/opportunities/${encodeURIComponent(opportunityId)}`);
  return requireObject(
    payload,
    ['opportunity', 'data.opportunity', '$'],
    'opportunity.readback',
    receipt
  );
}

function exactTestOpportunityReadback(opportunity, expected) {
  return opportunity?.name === expected.name &&
    opportunity?.pipelineId === expected.pipelineId &&
    opportunity?.pipelineStageId === expected.pipelineStageId &&
    opportunity?.contactId === expected.contactId &&
    opportunity?.status === expected.status &&
    customFieldValuesMatch(opportunity?.customFields, expected.customFields);
}

async function ensureTestOpportunity(client, manifest, receipt, name, payload) {
  assertNoProhibitedPayloadData(payload, manifest);
  if (!name.startsWith('RR TEST ') || payload.status !== 'open') {
    throw new GuardError('TEST_RECORD_GUARD', 'TEST opportunity must be unmistakably named and open');
  }
  let opportunity = await searchOpportunity(client, manifest, receipt, name, payload.pipelineId);
  if (opportunity) {
    const readback = await readOpportunity(client, receipt, opportunity.id);
    if (!exactTestOpportunityReadback(readback, payload)) {
      throw new GuardError('INCOMPATIBLE_COLLISION', `TEST opportunity ${name} is not an exact TEST match`);
    }
    return readback;
  }
  await client.request('POST', '/opportunities/', { mutating: true, body: payload });
  recordCompletedCreate(receipt, 'testOpportunity', name, '/opportunities/');
  opportunity = await searchOpportunity(client, manifest, receipt, name, payload.pipelineId);
  if (!opportunity?.id) {
    throw new GuardError('CREATE_READBACK_FAILED', `TEST opportunity ${name} was not confirmed`);
  }
  const readback = await readOpportunity(client, receipt, opportunity.id);
  if (!exactTestOpportunityReadback(readback, payload)) {
    throw new GuardError('CREATE_READBACK_FAILED', `TEST opportunity ${name} failed exact readback`);
  }
  return readback;
}

async function searchObjectRecord(client, manifest, receipt, schemaKey, query) {
  const payload = await client.request('POST', `/objects/${encodeURIComponent(schemaKey)}/records/search`, {
    body: {
      locationId: manifest.identity.locationId,
      page: 1,
      pageLimit: 10,
      query,
      searchAfter: []
    }
  });
  return requireArray(payload, ['records', 'data.records'], `records.${schemaKey}`, receipt);
}

async function ensureTestAssignment(client, manifest, receipt, externalId, payload) {
  assertNoProhibitedPayloadData(payload, manifest);
  if (
    !externalId.startsWith('rr_test_assignment_') ||
    payload.properties?.rr_environment !== 'TEST' ||
    payload.properties?.rr_assignment_state !== 'Queued'
  ) {
    throw new GuardError('TEST_RECORD_GUARD', 'Assignment verification record must be TEST and Queued');
  }
  const query = `rr_assignment_id:${externalId}`;
  let records = await searchObjectRecord(
    client,
    manifest,
    receipt,
    manifest.customObject.key,
    query
  );
  let matches = records.filter((record) =>
    record?.properties?.rr_assignment_id === externalId &&
    propertiesMatch(record.properties, payload.properties)
  );
  const sameIdIncompatible = records.some((record) =>
    record?.properties?.rr_assignment_id === externalId &&
    !propertiesMatch(record.properties, payload.properties)
  );
  if (sameIdIncompatible) {
    throw new GuardError('INCOMPATIBLE_COLLISION', 'Existing TEST assignment has incompatible properties');
  }
  if (matches.length > 1) throw new GuardError('INCOMPATIBLE_COLLISION', 'Duplicate TEST assignments exist');
  if (matches.length === 1) return matches[0];
  await client.request('POST', `/objects/${encodeURIComponent(manifest.customObject.key)}/records`, {
    mutating: true,
    body: payload
  });
  recordCompletedCreate(receipt, 'testAssignment', externalId, `/objects/${manifest.customObject.key}/records`);
  records = await searchObjectRecord(client, manifest, receipt, manifest.customObject.key, query);
  matches = records.filter((record) =>
    record?.properties?.rr_assignment_id === externalId &&
    propertiesMatch(record.properties, payload.properties)
  );
  if (matches.length !== 1 || !matches[0]?.id) {
    throw new GuardError('CREATE_READBACK_FAILED', 'TEST assignment was not confirmed');
  }
  return matches[0];
}

async function readRelations(client, manifest, receipt, recordId, associationId) {
  const payload = await client.request('GET', `/associations/relations/${encodeURIComponent(recordId)}`, {
    query: {
      locationId: manifest.identity.locationId,
      skip: 0,
      limit: 100,
      associationIds: [associationId]
    }
  });
  return requireArray(payload, ['relations', 'data.relations'], 'relations', receipt);
}

async function ensureTestRelation(client, manifest, receipt, association, homeownerId, assignmentId) {
  let relations = await readRelations(client, manifest, receipt, homeownerId, association.id);
  let matches = relations.filter((relation) =>
    relation?.associationId === association.id &&
    relation?.firstRecordId === homeownerId &&
    relation?.secondRecordId === assignmentId
  );
  if (matches.length > 1) throw new GuardError('INCOMPATIBLE_COLLISION', 'Duplicate TEST relations exist');
  if (matches.length === 1) return matches[0];
  const body = {
    locationId: manifest.identity.locationId,
    associationId: association.id,
    firstRecordId: homeownerId,
    secondRecordId: assignmentId
  };
  await client.request('POST', '/associations/relations', { mutating: true, body });
  recordCompletedCreate(receipt, 'testRelation', `${homeownerId}:${assignmentId}`, '/associations/relations');
  relations = await readRelations(client, manifest, receipt, homeownerId, association.id);
  matches = relations.filter((relation) =>
    relation?.associationId === association.id &&
    relation?.firstRecordId === homeownerId &&
    relation?.secondRecordId === assignmentId
  );
  if (matches.length !== 1) throw new GuardError('CREATE_READBACK_FAILED', 'TEST relation was not confirmed');
  return matches[0];
}

function legacyFieldIdMap(fields, model) {
  const map = {};
  for (const field of fields) {
    if (field?.model === model && field?.name && field?.id) map[field.name] = field.id;
  }
  return map;
}

function pipelineIdMap(pipelines, manifest) {
  const map = {};
  for (const expected of manifest.pipelines) {
    const result = requireNoCollision(findPipeline(pipelines, expected));
    if (result.state !== 'exact' || !result.value?.id) {
      throw new GuardError('PIPELINE_ID_MISSING', `Pipeline ${expected.name} is not confirmed`);
    }
    const orderedStages = [...result.value.stages].sort(
      (left, right) => Number(left.position || 0) - Number(right.position || 0)
    );
    if (!orderedStages[0]?.id) {
      throw new GuardError('PIPELINE_STAGE_ID_MISSING', `First stage for ${expected.name} has no ID`);
    }
    map[expected.name] = { id: result.value.id, stageId: orderedStages[0].id };
  }
  return map;
}

async function applyTestRecords(client, manifest, receipt, suffix, nowIso) {
  const ids = testIds(suffix);
  const fields = await readLegacyFields(client, manifest, receipt, 'all');
  const contactFieldIds = legacyFieldIdMap(fields, 'contact');
  const opportunityFieldIds = legacyFieldIdMap(fields, 'opportunity');
  const pipelines = pipelineIdMap(await readPipelines(client, manifest, receipt), manifest);
  const contacts = buildContactPayloads({ manifest, suffix, fieldIds: contactFieldIds });
  const homeowner = await ensureTestContact(client, manifest, receipt, ids.homeownerName, contacts.homeowner);
  const provider = await ensureTestContact(client, manifest, receipt, ids.providerName, contacts.provider);
  const business = await ensureTestBusiness(
    client,
    manifest,
    receipt,
    ids.businessName,
    buildBusinessRecordPayload({ manifest, suffix })
  );
  const opportunities = buildOpportunityPayloads({
    manifest,
    suffix,
    nowIso,
    fieldIds: opportunityFieldIds,
    pipelines,
    homeownerContactId: homeowner.id,
    providerContactId: provider.id,
    businessId: business.id
  });
  const homeownerOpportunity = await ensureTestOpportunity(
    client,
    manifest,
    receipt,
    ids.homeownerOpportunityName,
    opportunities.homeowner
  );
  await ensureTestOpportunity(
    client,
    manifest,
    receipt,
    ids.providerOpportunityName,
    opportunities.provider
  );
  const assignment = await ensureTestAssignment(
    client,
    manifest,
    receipt,
    ids.assignmentExternalId,
    buildAssignmentRecordPayload({
      manifest,
      suffix,
      nowIso,
      homeownerContactId: homeowner.id,
      homeownerOpportunityId: homeownerOpportunity.id,
      businessId: business.id
    })
  );
  const associations = await readAssociations(client, manifest, receipt);
  const associationResult = requireNoCollision(findAssociation(associations, manifest.association));
  if (associationResult.state !== 'exact' || !associationResult.value?.id) {
    throw new GuardError('ASSOCIATION_ID_MISSING', 'Homeowner/Lead Assignment association has no confirmed ID');
  }
  await ensureTestRelation(
    client,
    manifest,
    receipt,
    associationResult.value,
    homeowner.id,
    assignment.id
  );
}

function createReceipt(manifest, options, nowIso) {
  return {
    receiptVersion: 'rr-ghl-crm-schema-receipt/v1',
    schemaVersion: manifest.schemaVersion,
    generatedAt: nowIso,
    mode: options.apply ? 'apply' : 'dry-run',
    verdict: 'HALTED',
    baseUrl: OFFICIAL_BASE_URL,
    apiVersion: API_VERSION,
    expectedIdentity: { ...manifest.identity },
    observedIdentity: { companyId: null, locationId: null },
    credential: { source: null, printed: false, persisted: false },
    summary: { existing: 0, plannedCreates: 0, completedCreates: 0, collisions: 0 },
    actions: [],
    completed: [],
    collisions: [],
    blockers: [],
    requests: [],
    responseShapes: [],
    notProven: [],
    safety: {
      updatesAttempted: 0,
      deletesAttempted: 0,
      communicationsAttempted: 0,
      workflowWritesAttempted: 0,
      snapshotLoadsAttempted: 0,
      containsCredentials: false,
      containsProjectedIpOrUserAgent: false,
      containsRawHomeownerNarrative: false
    }
  };
}

async function runSchemaTool({
  argv,
  fetchImpl = global.fetch,
  env = process.env,
  now = () => new Date(),
  keychainReader,
  manifestPath = DEFAULT_MANIFEST_PATH
}) {
  const manifest = loadManifest(manifestPath);
  let options;
  try {
    options = parseArgs(argv, manifest);
  } catch (error) {
    const receipt = createReceipt(manifest, { apply: argv.includes('--apply') }, now().toISOString());
    receipt.haltReason = sanitizeError(error);
    return { receipt, exitCode: 2 };
  }
  if (options.help) return { help: true, exitCode: 0, options };

  const nowIso = now().toISOString();
  const receipt = createReceipt(manifest, options, nowIso);
  try {
    const credential = resolveCredential({ env, manifest, keychainReader });
    receipt.credential.source = credential.source;
    const client = new HighLevelClient({
      token: credential.token,
      fetchImpl,
      apply: options.apply,
      receipt,
      locationId: manifest.identity.locationId
    });
    await verifyIdentity(client, manifest, receipt);
    const discovery = await discoverSchema(client, manifest, receipt);
    const plan = planSchema(manifest, discovery);
    receipt.actions = plan.actions;
    receipt.collisions = plan.collisions;
    receipt.blockers = plan.blockers;
    receipt.notProven = plan.notProven;
    receipt.summary.existing = plan.existing;
    receipt.summary.plannedCreates = plan.plannedCreates;
    receipt.summary.collisions = plan.collisions.length;

    if (plan.collisions.length || plan.blockers.length) {
      throw new GuardError(
        'SCHEMA_PLAN_HALTED',
        'Incompatible collisions or unresolved existing-resource contracts halted the schema plan'
      );
    }

    if (!options.apply) {
      receipt.verdict = 'READY';
      receipt.notProven.push(
        'The v3 custom-object record create documentation exposes an open request body schema; TEST record property-key behavior remains unproven until a controlled apply and exact readback.'
      );
      if (!options.testSuffix) {
        receipt.notProven.push(
          'No TEST verification records were read or written; apply requires an explicit stable UTC test suffix.'
        );
      }
      return { receipt, exitCode: 0 };
    }

    await applySchema(client, manifest, receipt);
    const finalDiscovery = await discoverSchema(client, manifest, receipt);
    const finalPlan = planSchema(manifest, finalDiscovery);
    if (
      finalPlan.collisions.length ||
      finalPlan.blockers.length ||
      finalPlan.actions.some((action) => action.status !== 'exists')
    ) {
      throw new GuardError('FINAL_SCHEMA_NOT_EXACT', 'Post-create readback did not match the exact manifest');
    }
    await applyTestRecords(client, manifest, receipt, options.testSuffix, nowIso);
    receipt.verdict = 'APPLIED';
    receipt.notProven = [];
    receipt.summary.existing = finalPlan.existing;
    receipt.summary.plannedCreates = 0;
    receipt.summary.completedCreates = receipt.completed.length;
    return { receipt, exitCode: 0 };
  } catch (error) {
    receipt.verdict = 'HALTED';
    receipt.summary.completedCreates = receipt.completed.length;
    receipt.haltReason = sanitizeError(error);
    return { receipt, exitCode: 2 };
  }
}

function helpText() {
  return [
    'RestoreRadar HighLevel CRM schema tool (dry-run by default)',
    '',
    'Required:',
    '  --company-id <QrtXvBAldeRz6qcMX1Xt>',
    '  --location-id <a7Caoa2IgRnZOazJLyAm>',
    '',
    'Apply only:',
    '  --apply --test-suffix <YYYYMMDDTHHMMSSZ>',
    '',
    'Optional:',
    '  --receipt <path>',
    '',
    'No update, delete, workflow, snapshot, email, SMS, or conversation endpoint is permitted.'
  ].join('\n');
}

module.exports = {
  API_VERSION,
  DEFAULT_MANIFEST_PATH,
  OFFICIAL_BASE_URL,
  GuardError,
  HighLevelClient,
  applySchema,
  assertNoProhibitedPayloadData,
  buildAssignmentRecordPayload,
  buildBusinessRecordPayload,
  buildContactPayloads,
  buildOpportunityPayloads,
  createReceipt,
  customFieldPrefixFromReadback,
  discoverSchema,
  helpText,
  loadManifest,
  parseArgs,
  planSchema,
  resolveCredential,
  runSchemaTool,
  testIds
};
