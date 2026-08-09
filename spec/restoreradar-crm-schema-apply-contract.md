# RestoreRadar HighLevel schema apply contract

This tool is additive and dry-run by default. It is pinned to company
`QrtXvBAldeRz6qcMX1Xt`, location `a7Caoa2IgRnZOazJLyAm`,
`https://services.leadconnectorhq.com`, and the endpoint-specific header
`Version: v3`. It ignores any inherited base-URL override.

Apply requires all three explicit confirmations:

- `--apply`
- the exact pinned `--company-id` and `--location-id`
- a reusable `--test-suffix YYYYMMDDTHHMMSSZ`

The stable suffix makes the TEST record names and external IDs repeatable. A
rerun reads and validates the exact TEST resources before deciding whether a
create is necessary. Verification timestamps are derived from that suffix, not
the wall clock, so the same suffix remains identical across later retries.

Two credentials are independently required: `GHL_AGENCY_API_KEY` for the
agency company preflight and custom-object schema create, and
`GHL_RESTORERADAR_API_KEY` for the RestoreRadar location preflight plus every
location read/create. Both identities and all discovery reads must succeed
before the first POST. The custom-object schema POST is deliberately first so
an agency-scope failure cannot follow a batch of location creates.

## Create-only surface

The only mutating method is `POST`, and only these resource families are
allowlisted: RR-namespaced pipelines, contact/opportunity legacy custom fields,
Business/Custom Object V2 field folders and fields, the RR Lead Assignment
object, the one Contact-to-Lead-Assignment association, and unmistakable TEST
records plus their one supported relation. There is no `PUT`, `PATCH`, or
`DELETE` path.

Conversation, message, email, SMS, campaign, workflow, and snapshot endpoints
are locally rejected before network dispatch. The tool creates no sender,
workflow, channel, or homeowner communication configuration.

## Current official endpoint authority

- [Create pipeline](https://marketplace.gohighlevel.com/docs/ghl/opportunities/create-pipeline/)
- [Location custom fields](https://marketplace.gohighlevel.com/docs/ghl/locations/create-custom-field/)
- [Custom Fields V2](https://marketplace.gohighlevel.com/docs/ghl/custom-fields/create-custom-field/)
- [Custom Field V2 folders](https://marketplace.gohighlevel.com/docs/ghl/custom-fields/create-custom-field-folder/)
- [Create custom object](https://marketplace.gohighlevel.com/docs/ghl/objects/create-custom-object-schema/)
- [Create/search object records](https://marketplace.gohighlevel.com/docs/ghl/objects/create-object-record/)
- [Create association](https://marketplace.gohighlevel.com/docs/ghl/associations/create-association/)
- [Create relation](https://marketplace.gohighlevel.com/docs/ghl/associations/create-relation/)
- [Create contact](https://marketplace.gohighlevel.com/docs/ghl/contacts/create-contact/)
- [Create opportunity](https://marketplace.gohighlevel.com/docs/ghl/opportunities/create-opportunity/)
- [Business API](https://marketplace.gohighlevel.com/docs/ghl/businesses/businesses/)

The current pages label these contracts `v3` and require the `Version: v3`
header.

## Fail-closed ambiguities

The Objects API documents plural keys such as `custom_objects.pet`. The Custom
Fields V2 create page still illustrates field keys with the singular prefix
`custom_object.pet.name`, while its read endpoint requires the plural object
key. The tool always reads the schema/V2 endpoint with the plural schema key,
then reconciles every V2 `objectKey`, `fieldKey`, and folder `objectKey` into one
server-returned write namespace. Folder/field POSTs use only that resolved
namespace; missing or conflicting evidence halts the run.

The agency credential may call only company identity GET and custom-object
schema POST. The location credential handles all other reads and creates.
Protocol-relative paths, alternate origins, cross-company/location payloads,
and role-crossing endpoints are rejected before network dispatch. A successful
object schema create must be HTTP 201 with the exact server object ID, location,
key, labels, description, and primary property before any later POST can run.
Every create response must expose a server-assigned ID. The tool matches that
ID against a direct record read where the API supports one, otherwise against
the exact collection readback. Object-schema visibility gets a bounded direct
read retry; if it remains unavailable, the run halts without repeating the
object POST or proceeding to bulk creates.

The v3 create-record page currently exposes an open request-body schema. The
tool uses the documented `properties` record shape, creates only TEST-marked
records, and requires exact post-create readback. A dry-run reports this request
contract as `NOT PROVEN`; no live HighLevel mutation was used to paper over the
documentation gap.

## TEST record safety

Every verification name starts with `RR TEST` and every external ID starts with
`rr_test_`. Contacts have no email or phone and set global DND. The provider
Business has no channel fields. Environment is `TEST`, homeowner consent is
`NOT_GRANTED`, and no consent timestamp is fabricated. Assignment state starts
at `Queued`; Resend IDs and sent/delivered timestamps are absent.

The projection contains no IP address, user agent, or raw homeowner narrative.
Only the Contact-to-RR-Lead-Assignment relation is created. Opportunity and
Business references remain scalar IDs on the assignment record.
