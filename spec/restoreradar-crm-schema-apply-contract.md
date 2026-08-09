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
Dry-run never searches or creates TEST records; its receipt records both facts
explicitly even when a suffix was supplied for preview purposes.

Two credentials are independently required: `GHL_AGENCY_API_KEY` only for the
read-only agency company preflight, and `GHL_RESTORERADAR_API_KEY` for the
RestoreRadar location preflight plus every schema read/create, including
`POST /objects/`. Both identities and all discovery reads must succeed before
the first POST. The custom-object schema POST is deliberately first so a
Sub-Account scope failure cannot follow a batch of later location creates.

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

Create success status and envelope handling are endpoint-specific. Pipeline
create requires HTTP 201 and accepts the flat pipeline object. The official
[Create Pipeline](https://marketplace.gohighlevel.com/docs/ghl/opportunities/create-pipeline/)
page still lists HTTP 200, but the controlled RestoreRadar apply on 2026-08-09
returned HTTP 201 for `POST /opportunities/pipelines`. This tool pins that live
transport contract; an HTTP 200 response is recorded as accepted transport but
halts before envelope parsing, readback, or completion.
Custom Field V2 folder and association creates require HTTP 201 and accept the
documented flat folder or association object. Legacy custom-field, Custom Field
V2 field, and custom-object creates require HTTP 201. Previously observed
wrapper envelopes remain supported for compatibility; wrapper paths are always
evaluated before the flat `$` fallback so a wrapper cannot be mistaken for the
created resource itself. Any other success status, unknown envelope, missing
server ID, or create/readback ID mismatch halts without retrying the POST.

Every TEST create is also pinned to HTTP 201: Contact, Opportunity, Business
object record, RR Lead Assignment custom-object record, and association
relation. Contact keeps the `contact`/`data.contact` envelopes, Opportunity
keeps `opportunity`/`data.opportunity`, and both object-record families keep
`record`/`data.record`; those families do not accept an undocumented flat
fallback. The current relation-create response schema is association-definition
metadata, not authoritative relation identity. The tool ignores every relation
response body shape and uses only its pinned HTTP 201 status plus two-sided list
readback. A different 2xx status is still recorded as accepted and then halts.

The current v3 [Create Contact](https://marketplace.gohighlevel.com/docs/ghl/contacts/create-contact/)
request contract uses `customFields` items shaped as `{id, fieldValue}`;
`field_value` is deprecated. Contact response, GET, and webhook representations
may instead expose `{id, value}`. The tool keeps the documented request shape,
accepts any one unambiguous readback value among `value`, `fieldValue`, and
`field_value`, and treats conflicting aliases on one returned field as an
incompatible collision. A nonempty value under any unknown readback key is
also a collision rather than an empty placeholder. Opportunity requests continue to use
`{id, fieldValue}` independently.

A controlled RestoreRadar retry on 2026-08-09 proved that a channel-less Contact
create with only `name` is rejected: the transport returned HTTP 400 with a
sanitized response body carrying `statusCode: 422` and the message `Contacts
without email, phone, firstName and lastName are not allowed.` The tool therefore
retains the deterministic full `name` and also sends deterministic `firstName`
and `lastName` values for each unmistakable TEST Contact. No email or phone is
added.

## Fail-closed ambiguities

The Objects API documents plural keys such as `custom_objects.pet`. The Custom
Fields V2 create page still illustrates field keys with the singular prefix
`custom_object.pet.name`, while its read endpoint requires the plural object
key. The tool always reads the schema/V2 endpoint with the plural schema key,
then reconciles every V2 `objectKey`, `fieldKey`, and folder `objectKey` into one
server-returned write namespace. Folder/field POSTs use only that resolved
namespace; missing or conflicting evidence halts the run.

An existing custom object must reconcile the collection result with direct
object details. Both representations must carry the same nonempty ID and the
exact location/key/labels/description/primary-property contract, and the key
must begin with `custom_objects.`. Current live v3 list, create, and direct
representations may omit `standard` and `objectType`; `standard: false`, null,
or absence is accepted, while `standard: true` or any other value is rejected.
`objectType` is not treated as authoritative when the API omits it.
Namespace proof also requires exactly one primary field matching the manifest:
nonempty ID, name `RR Assignment ID`, type `TEXT`, allowed singular-or-plural
RR object namespace, and a field key equal to that object key plus
`.rr_assignment_id`. A suffix-only, unnamed, untyped, ID-less, or conflicting
field is not namespace evidence.

The agency credential may call only the company identity GET; every mutation is
locally blocked for that role. The location credential handles all remaining
reads and every create, including custom-object schema POST.
Protocol-relative paths, alternate origins, cross-company/location payloads,
and role-crossing endpoints are rejected before network dispatch. A successful
object schema create must be HTTP 201 with the exact server object ID, location,
namespaced key, labels, description, and primary property before any later POST
can run. Its `standard` classification follows the same false/null/absent-only
rule as list and direct readback.
Every create response except relation create must expose a server-assigned ID.
The tool matches that ID against a direct record read where the API supports
one, otherwise against the exact collection readback. Object-schema visibility
gets a bounded direct read retry; if it remains unavailable, the run halts
without repeating the object POST or proceeding to bulk creates.

The v3 create-record page currently exposes an open request-body schema. The
tool uses the documented `properties` record shape, creates only TEST-marked
records, and requires exact post-create readback. A dry-run reports this request
contract as `NOT PROVEN`; no live HighLevel mutation was used to paper over the
documentation gap.

## TEST record safety

Every verification name starts with `RR TEST` and every external ID starts with
`rr_test_`. Contacts have no email or phone and set global DND. The provider
Business has no channel fields. Legacy Contact/Opportunity TEXT environment
markers remain `TEST`; Business and Lead Assignment V2 properties use the
canonical `test` option key whose label is `TEST`. Homeowner consent is
`NOT_GRANTED`, and no consent timestamp is fabricated. Assignment state starts
with the `queued` option key whose label is `Queued`; Resend IDs and
sent/delivered timestamps are absent.

Each TEST Contact uses `firstName: "RR TEST"`. The homeowner uses `lastName:
"Homeowner <test-suffix>"`; the provider Contact uses `lastName: "Provider
Contact <test-suffix>"`. Its full `name` must be the exact concatenation of
`firstName`, one space, and `lastName`. The pre-dispatch TEST-record guard
requires all three values, global DND, and the absence of email and phone. Exact
list/direct readback requires the same contract. A missing or changed first
name, last name, or full name is an incompatible collision, so replay cannot
silently adopt a differently named Contact.

Before dispatch, each TEST Contact custom-field request item is independently
guarded as an exact, unique `{id, fieldValue}` pair. Neither the response-only
`value` key nor deprecated `field_value` can enter a Contact create request.

The projection contains no IP address, user agent, or raw homeowner narrative.
Only the Contact-to-RR-Lead-Assignment relation is created. Opportunity and
Business references remain scalar IDs on the assignment record.

A TEST relation is exact only when GET
`/associations/relations/:recordId` independently returns exactly one matching
association and homeowner/assignment pair from both the homeowner and
assignment sides. Pair orientation may reverse between those views. If both
views expose relation IDs, the IDs must match; an absent ID on either view is
not itself a failure. One-sided evidence, a wrong pair/association, duplicates,
or differing two-sided IDs halts. Before create, partial evidence blocks a
duplicate POST. After an accepted HTTP 201, failed two-sided proof records the
write as accepted-but-unverified and never retries it.

Existing TEST contacts and opportunities must have exactly the expected tag or
nonempty custom-field IDs and values. Empty API placeholders are allowed, but
any unexpected controlled value collides; `false` and `0` are values, not empty.
Assignment properties follow the same rule, so a stale sent timestamp or any
other unexpected value halts. A matching TEST Business collides if either its
top level or properties contain email/phone, or if its properties contain any
unexpected nonempty value. Business discovery uses bounded 100-record requests,
advances by the accumulated returned count, requires an explicit empty page,
and halts on missing/repeated record IDs or repeated pages.

V2 field readback is exact only when the server supplies a field ID and the
field is under the resolved object namespace and intended RR folder ID. A
same-name/key field in another folder is an incompatible collision, never an
idempotent match. `SINGLE_OPTIONS` keys use the lowercase form returned by the
server (`test`, `production`, `queued`, and the remaining assignment states),
while their display labels retain the exact manifest case (`TEST`,
`PRODUCTION`, `Queued`, and so on). Key and label comparison remains exact; a
different key or label is an incompatible collision rather than a normalized
match.

Pipelines, legacy fields, custom objects, associations, V2 folders, and V2
fields are never considered exact without nonempty server IDs. After apply,
the receipt replaces planned-create actions with the final all-existing
readback plan. The stateful verification contract expects exactly 75 additive
creates from an empty RestoreRadar schema; the custom object is first and every
create uses the location credential. A replay of that exact state performs zero
mutations.

An existing custom object is exact only when it is not declared standard,
belongs to the pinned RestoreRadar location, begins with the
`custom_objects.` namespace, and matches the complete pinned object contract.
A same-key or same-label object with `standard: true`, a non-custom key prefix,
or an object from another location is an incompatible collision.

If an earlier run received an accepted object create but halted before marking
it completed, exact list/direct/primary-field evidence recovers that object
without another object POST. The live partial-state regression reports one
existing object and 67 planned schema creates in dry-run, then applies the
remaining schema and unmistakable TEST records under the same suffix. A replay
of that suffix performs zero mutations.

If an accepted V2 option-field create is later read back with the canonical
lowercase keys and exact labels, that field is recovered as existing without
another POST. The normalized-environment regression starts from the object,
its RR folder, and the six fields through `RR | Environment`, then verifies
that recovery skips Environment, creates later option fields with canonical
keys/labels, and replays with zero mutations.

The receipt distinguishes transport acceptance from verification. Every
mutating request that receives any 2xx response is appended immediately to
`acceptedCreates`, including resource, key, endpoint, status, and credential
role, before status pinning, JSON/envelope parsing, or readback. `completed`
contains only creates with exact post-create readback (and matching
server-assigned IDs wherever the endpoint provides authoritative create/read
IDs). Thus a halted run, including a partial TEST graph, reports every
accepted mutation without overstating how many resources were verified. The
summary carries separate `acceptedCreates` and `completedCreates` counts, and
`testVerification.recordsWritten` becomes true as soon as a TEST create is
accepted.

A non-2xx mutation is recorded in `requests` with its HTTP status,
`accepted2xx: false`, and the credential role, but it is never added to
`acceptedCreates` or `completed`. In particular, a 401 from the first
location-scoped `POST /objects/` halts immediately with zero accepted and zero
completed creates; no later POST is attempted and no credential value enters
the receipt.

For a non-2xx response, the halt receipt may retain only the top-level API
fields `statusCode`, `error`, and `message` (string or a bounded string list).
Diagnostic bodies and messages have fixed size limits. Credential values,
Bearer material, request-body scalar values, email-like values, phone-like
values, long token-like strings, control characters, and every non-allowlisted
response field are removed or redacted. Request bodies and headers are never
copied into the receipt. Empty, invalid JSON, and oversized error bodies retain
only the generic HTTP/method/path halt message.

Once the final schema readback is exact, the receipt replaces the preliminary
plan and its summary before any TEST write begins. A later partial TEST halt
therefore retains all schema actions as existing, zero planned creates, zero
collisions/blockers, and only the final schema `notProven` state; it never
leaves the pre-create counts or deferred-prefix note behind.
