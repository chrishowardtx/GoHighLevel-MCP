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
create requires HTTP 200 and accepts the documented flat pipeline object.
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
exact non-standard/location/key/labels/description/primary-property contract.
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
key, labels, description, and primary property before any later POST can run.
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
Business has no channel fields. Environment is `TEST`, homeowner consent is
`NOT_GRANTED`, and no consent timestamp is fabricated. Assignment state starts
at `Queued`; Resend IDs and sent/delivered timestamps are absent.

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
idempotent match.

Pipelines, legacy fields, custom objects, associations, V2 folders, and V2
fields are never considered exact without nonempty server IDs. After apply,
the receipt replaces planned-create actions with the final all-existing
readback plan. The stateful verification contract expects exactly 75 additive
creates from an empty RestoreRadar schema; the custom object is first and every
create uses the location credential. A replay of that exact state performs zero
mutations.

An existing custom object is exact only when it is explicitly non-standard
(`standard: false`), belongs to the pinned RestoreRadar location, and matches
the complete namespaced object contract. A same-key or same-label standard
object, or an object from another location, is an incompatible collision.

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

Once the final schema readback is exact, the receipt replaces the preliminary
plan and its summary before any TEST write begins. A later partial TEST halt
therefore retains all schema actions as existing, zero planned creates, zero
collisions/blockers, and only the final schema `notProven` state; it never
leaves the pre-create counts or deferred-prefix note behind.
