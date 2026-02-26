# SMS Data Model Changes (Fundraising MVP)

This document defines exact schema additions for SMS support.
All additions preserve existing org scoping and RBAC.

## 1) Collection: `athlete_contacts`

Existing contact records remain valid. New fields are additive.

### New fields
- `phone` (`string | null`)
  - E.164 format required for sending (example: `+15551234567`)
- `phoneE164` (`string | null`)
  - normalized canonical phone for dedupe and provider send
- `phoneLast4` (`string | null`)
  - optional UI display helper
- `smsOptIn` (`boolean`)
  - default `false`
- `smsOptInAt` (`timestamp | null`)
- `smsOptInSource` (`string | null`)
  - allowed values: `manual_admin`, `manual_athlete`, `import`, `keyword`, `webform`
- `smsOptOutAt` (`timestamp | null`)
- `smsOptOutSource` (`string | null`)
  - allowed values: `stop_keyword`, `admin`, `support`, `provider`
- `smsStatus` (`string`)
  - allowed values:
    - `draft`
    - `ready`
    - `sent`
    - `delivered`
    - `failed`
    - `undeliverable`
    - `unsubscribed`
    - `complained`
- `smsLastSentAt` (`timestamp | null`)
- `smsLastEventAt` (`timestamp | null`)
- `smsLastEventType` (`string | null`)
- `smsLastError` (`string | null`)
- `smsBounceCount` (`number`)
  - default `0`
- `smsSuppressed` (`boolean`)
  - default `false`
- `smsSuppressedReason` (`string | null`)

### Notes
- Existing `status` and email delivery fields remain email-channel behavior.
- `smsStatus` is channel-specific and must not overwrite email `status`.

## 2) Collection: `messages`

Use this collection for unified outbound log by channel.

### Required fields for SMS records
- `orgId` (`string`)
- `athleteId` (`string`)
- `contactId` (`string | null`)
- `channel` (`string`) = `sms`
- `to` (`string`) - destination phone E.164
- `toName` (`string | null`)
- `subject` (`string | null`) - optional for sms, keep null
- `body` (`string`) - rendered final message
- `templateKey` (`string | null`) - `week1a`, `week2`, etc
- `provider` (`string`) - example: `twilio`
- `providerMessageId` (`string | null`)
- `deliveryStatus` (`string`) - `queued`, `sent`, `delivered`, `failed`, etc
- `createdAt` (`timestamp`)
- `updatedAt` (`timestamp`)
- `createdByUid` (`string`)

### Optional fields
- `campaignId` (`string | null`)
- `teamId` (`string | null`)
- `errorCode` (`string | null`)
- `errorMessage` (`string | null`)
- `cost` (`number | null`)
- `segments` (`number | null`)

## 3) Collection: `message_events`

Webhook ingestion and delivery timeline for all channels.

### Required fields for SMS events
- `orgId` (`string`)
- `source` (`string`) = `sms_provider`
- `eventType` (`string`) - provider event normalized type
- `provider` (`string`)
- `providerEventId` (`string`)
- `providerMessageId` (`string | null`)
- `recipient` (`string`) - E.164
- `contactId` (`string | null`)
- `athleteId` (`string | null`)
- `messageId` (`string | null`) - local `messages` doc id if resolved
- `timestamp` (`timestamp`) - provider event time normalized
- `createdAt` (`timestamp`) - ingestion time
- `payload` (`map`) - raw payload subset needed for audit

### Idempotency rule
- Enforce unique event processing by `providerEventId` at function layer.
- Ignore duplicates and return success (200) to stop retries.

## 4) Collection: `organizations`

Org-level SMS configuration (admin controlled).

### New fields
- `smsEnabled` (`boolean`) default `false`
- `smsProvider` (`string | null`) example: `twilio`
- `smsFromNumber` (`string | null`) E.164 sender
- `smsOptInRequired` (`boolean`) default `true`
- `smsQuietHoursEnabled` (`boolean`) default `true`
- `smsQuietHoursStart` (`string | null`) example `20:00`
- `smsQuietHoursEnd` (`string | null`) example `08:00`
- `smsDailyLimitPerAthlete` (`number | null`)
- `smsDailyLimitPerOrg` (`number | null`)
- `smsTemplateDefault` (`string | null`)
- `smsTemplateByPhase` (`map`) keyed by phase name
- `updatedAt` (`timestamp`)

## 5) Firestore Indexes

Add/verify these indexes:
1. `athlete_contacts`
   - `orgId ASC`, `athleteId ASC`, `smsStatus ASC`
2. `athlete_contacts`
   - `orgId ASC`, `athleteId ASC`, `phoneE164 ASC`
3. `messages`
   - `orgId ASC`, `channel ASC`, `createdAt DESC`
4. `messages`
   - `orgId ASC`, `athleteId ASC`, `channel ASC`, `createdAt DESC`
5. `message_events`
   - `orgId ASC`, `source ASC`, `createdAt DESC`
6. `message_events`
   - `provider ASC`, `providerEventId ASC`

## 6) Rules Impact (High Level)

Update rules only for additive fields:
- `athlete_contacts`: allow existing roles to update SMS metadata fields.
- `messages`: allow create via current trusted path only (or function-only pattern).
- `message_events`: keep write restricted to backend/admin SDK flow.
- `organizations`: only admin/super-admin can update SMS org settings.

Do not loosen org scoping. Do not allow cross-org read/write.

## 7) Function Contracts

## Callable: `sendAthleteSmsMessage`
### Input
- `athleteId` (`string`)
- `contactIds` (`string[]`)
- `templateKey` (`string`)
- `messageBody` (`string | null`)

### Output
- `requested` (`number`)
- `sent` (`number`)
- `failed` (`number`)
- `skipped` (`number`)
- `results` (`array`) with contact-level status

## HTTP/Webhook: `smsEventWebhook`
### Input
- provider payload + signature headers

### Output
- `200` on accepted/duplicate
- `400/401` on invalid signature

### Side effects
- append `message_events`
- update `messages.deliveryStatus`
- update `athlete_contacts.smsStatus` and related timestamps

## 8) Migration Plan

## Step 1: schema-safe defaults
- No destructive changes.
- Existing records remain valid with SMS disabled.

## Step 2: backfill script
- For each `athlete_contacts` doc in org:
  - set missing fields:
    - `smsOptIn: false`
    - `smsStatus: "draft"`
    - `smsBounceCount: 0`
    - `smsSuppressed: false`

## Step 3: optional normalization
- If phone exists, normalize to `phoneE164`.
- Mark invalid formats in `smsLastError`.

## Step 4: verification query
- Ensure 100 percent of contact docs have default SMS fields.

## 9) Acceptance Criteria

1. No regression in current email sends.
2. SMS sends blocked when:
   - org SMS disabled
   - contact missing opt-in
   - phone invalid
3. STOP/unsubscribe event sets:
   - `smsOptIn = false`
   - `smsStatus = "unsubscribed"`
4. Duplicate webhook events do not duplicate writes.
5. `messages` and `message_events` agree on final delivery state.

