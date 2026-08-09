import type {
  GHLApiResponse,
  GHLConfig,
  GHLLocationDetailsResponse,
} from './types/ghl-types.js';

const OFFICIAL_GHL_BASE_URL = 'https://services.leadconnectorhq.com';

// Fail closed: a newly-added tool is not available in audit mode until it is
// reviewed and deliberately added to this exact read-only allowlist.
export const READ_ONLY_LOCATION_TOOL_NAMES = [
  'check_url_slug',
  'download_transcription',
  'get_all_objects',
  'get_appointment',
  'get_appointment_notes',
  'get_blocked_slots',
  'get_blog_authors',
  'get_blog_categories',
  'get_blog_posts',
  'get_blog_sites',
  'get_calendar',
  'get_calendar_events',
  'get_calendar_groups',
  'get_calendar_notification',
  'get_calendar_notifications',
  'get_calendar_resource_equipment',
  'get_calendar_resource_room',
  'get_calendar_resources_equipments',
  'get_calendar_resources_rooms',
  'get_calendars',
  'get_contact',
  'get_contact_appointments',
  'get_contact_note',
  'get_contact_notes',
  'get_contact_task',
  'get_contact_tasks',
  'get_contacts_by_business',
  'get_conversation',
  'get_coupon',
  'get_csv_upload_status',
  'get_custom_provider_config',
  'get_duplicate_contact',
  'get_email_campaigns',
  'get_email_message',
  'get_email_templates',
  'get_free_slots',
  'get_invoice',
  'get_invoice_schedule',
  'get_invoice_template',
  'get_location',
  'get_location_custom_field',
  'get_location_custom_fields',
  'get_location_custom_value',
  'get_location_custom_values',
  'get_location_tag',
  'get_location_tags',
  'get_location_templates',
  'get_media_files',
  'get_message',
  'get_message_recording',
  'get_message_transcription',
  'get_object_record',
  'get_object_schema',
  'get_opportunity',
  'get_order_by_id',
  'get_pipelines',
  'get_platform_accounts',
  'get_recent_messages',
  'get_social_accounts',
  'get_social_categories',
  'get_social_category',
  'get_social_post',
  'get_social_tags',
  'get_social_tags_by_ids',
  'get_subscription_by_id',
  'get_timezones',
  'get_transaction_by_id',
  'ghl_get_all_associations',
  'ghl_get_association_by_id',
  'ghl_get_association_by_key',
  'ghl_get_association_by_object_key',
  'ghl_get_available_shipping_rates',
  'ghl_get_custom_field_by_id',
  'ghl_get_custom_fields_by_object_key',
  'ghl_get_product',
  'ghl_get_relations_by_record',
  'ghl_get_shipping_carrier',
  'ghl_get_shipping_rate',
  'ghl_get_shipping_zone',
  'ghl_get_store_setting',
  'ghl_get_survey_submissions',
  'ghl_get_surveys',
  'ghl_get_workflows',
  'ghl_list_inventory',
  'ghl_list_prices',
  'ghl_list_product_collections',
  'ghl_list_products',
  'ghl_list_shipping_carriers',
  'ghl_list_shipping_rates',
  'ghl_list_shipping_zones',
  'list_coupons',
  'list_estimates',
  'list_invoice_schedules',
  'list_invoice_templates',
  'list_invoices',
  'list_order_fulfillments',
  'list_orders',
  'list_subscriptions',
  'list_transactions',
  'list_whitelabel_integration_providers',
  'search_contacts',
  'search_conversations',
  'search_location_tasks',
  'search_object_records',
  'search_opportunities',
  'search_social_posts',
  'validate_group_slug',
] as const;

const readOnlyToolNames = new Set<string>(READ_ONLY_LOCATION_TOOL_NAMES);

export interface LocationProfileConfig {
  apiConfig: GHLConfig;
  expectedCompanyId: string;
  expectedLocationId: string;
  mutationsEnabled: boolean;
}

export interface LocationIdentityClient {
  getLocationById(
    locationId: string,
  ): Promise<GHLApiResponse<GHLLocationDetailsResponse>>;
}

export function createLocationProfileConfig(
  env: NodeJS.ProcessEnv = process.env,
): LocationProfileConfig {
  const accessToken = env.GHL_API_KEY || '';
  const locationId = env.GHL_LOCATION_ID || '';
  const expectedLocationId = env.GHL_EXPECTED_LOCATION_ID || '';
  const expectedCompanyId = env.GHL_EXPECTED_COMPANY_ID || '';

  if (!accessToken) {
    throw new Error('GHL_API_KEY environment variable is required');
  }
  if (!locationId) {
    throw new Error('GHL_LOCATION_ID environment variable is required');
  }
  if (!expectedLocationId) {
    throw new Error('GHL_EXPECTED_LOCATION_ID environment variable is required');
  }
  if (!expectedCompanyId) {
    throw new Error('GHL_EXPECTED_COMPANY_ID environment variable is required');
  }
  if (locationId !== expectedLocationId) {
    throw new Error('Configured location does not match expected location');
  }

  return {
    apiConfig: {
      accessToken,
      baseUrl: OFFICIAL_GHL_BASE_URL,
      version: '2021-07-28',
      locationId,
    },
    expectedCompanyId,
    expectedLocationId,
    mutationsEnabled: env.GHL_ENABLE_MUTATIONS === 'true',
  };
}

export function filterLocationToolDefinitions<T extends { name: string }>(
  definitions: T[],
  mutationsEnabled: boolean,
): T[] {
  if (mutationsEnabled) {
    return definitions;
  }

  return definitions.filter((tool) => readOnlyToolNames.has(tool.name));
}

function isKnownMutationName(name: string): boolean {
  return /^(add_|bulk_|cancel_|create_|delete_|disable_|disconnect_|generate_|live_chat_|remove_|send_|set_|start_|update_|upload_|upsert_|verify_|ghl_(create|delete|update)_)/.test(
    name,
  );
}

function assertScopedArguments(
  value: unknown,
  profile: Pick<LocationProfileConfig, 'expectedCompanyId' | 'expectedLocationId'>,
): void {
  if (Array.isArray(value)) {
    for (const item of value) {
      assertScopedArguments(item, profile);
    }
    return;
  }
  if (!value || typeof value !== 'object') {
    return;
  }

  const record = value as Record<string, unknown>;
  for (const [key, nested] of Object.entries(record)) {
    if (
      (key === 'locationId' || key === 'location_id') &&
      typeof nested === 'string' &&
      nested !== profile.expectedLocationId
    ) {
      throw new Error('Cross-location tool arguments are not allowed');
    }
    if (
      key === 'locationIds' &&
      Array.isArray(nested) &&
      nested.some((id) => id !== profile.expectedLocationId)
    ) {
      throw new Error('Cross-location tool arguments are not allowed');
    }
    if (
      (key === 'companyId' || key === 'company_id') &&
      typeof nested === 'string' &&
      nested !== profile.expectedCompanyId
    ) {
      throw new Error('Cross-company tool arguments are not allowed');
    }
    if (key === 'altType' && typeof nested === 'string' && nested !== 'location') {
      throw new Error('Cross-profile alternate scope is not allowed');
    }
    if (
      key === 'altId' &&
      typeof nested === 'string' &&
      nested !== profile.expectedLocationId
    ) {
      throw new Error('Cross-location tool arguments are not allowed');
    }

    assertScopedArguments(nested, profile);
  }
}

export function assertLocationToolExecutionAllowed(
  name: string,
  args: unknown,
  profile: LocationProfileConfig,
): void {
  assertScopedArguments(args, profile);

  if (profile.mutationsEnabled) {
    return;
  }
  if (readOnlyToolNames.has(name)) {
    return;
  }
  if (isKnownMutationName(name)) {
    throw new Error('Mutation tools are disabled for this location profile');
  }
  throw new Error('Tool is not allowlisted for audit mode');
}

export async function verifyLocationIdentity(
  client: LocationIdentityClient,
  expectedLocationId: string,
  expectedCompanyId: string,
): Promise<{ locationId: string; companyId: string }> {
  const result = await client.getLocationById(expectedLocationId);
  if (!result.success || !result.data?.location) {
    throw new Error(result.error?.message || 'Location identity probe failed');
  }

  const { id: actualLocationId, companyId: actualCompanyId } = result.data.location;
  if (actualLocationId !== expectedLocationId) {
    throw new Error('Location identity mismatch');
  }
  if (actualCompanyId !== expectedCompanyId) {
    throw new Error('Company identity mismatch');
  }

  return { locationId: actualLocationId, companyId: actualCompanyId };
}
