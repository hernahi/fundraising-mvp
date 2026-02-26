# SMS Phase Plan (Fundraising MVP)

This plan adds SMS as a production-safe channel in the existing architecture:
- Frontend: React/Vite
- Backend: Firebase Functions
- Data: Firestore org-scoped collections
- Existing messaging model: `messages`, `athlete_contacts`, `message_events`

Status values per phase: `Not Started`, `In Progress`, `Blocked`, `Done`.

## Phase 0: Provider and Compliance Setup
- Objective: enable compliant SMS sending in US production.
- Tasks:
1. Choose provider (`Twilio` recommended for first implementation path).
2. Complete A2P 10DLC registration and campaign setup.
3. Provision one sender per environment (test and production).
4. Capture credentials/secrets for Firebase Functions.
5. Define STOP/HELP response policy and support contact text.
- Go/No-Go gate:
1. Provider dashboard can send test SMS to internal numbers.
2. A2P registration status is approved (or approved for test traffic scope).
3. Secrets are available and validated in non-production project.

## Phase 1: Data Contract and Guard Rails
- Objective: prepare Firestore model for SMS consent and delivery state.
- Tasks:
1. Add SMS fields to `athlete_contacts` (see `SMS_DATA_MODEL.md`).
2. Add channel metadata to `messages` and `message_events`.
3. Add org-level SMS config in `organizations`.
4. Add Firestore rules updates for new fields only (no scope changes).
5. Add migration script for existing contacts with safe defaults.
- Go/No-Go gate:
1. Read/write still org-scoped and role-safe.
2. Existing email workflows unchanged.
3. Migration is idempotent and tested in staging.

## Phase 2: Function Layer (Send + Webhook)
- Objective: implement server-side SMS send and delivery ingestion.
- Tasks:
1. Add callable function: `sendAthleteSmsMessage`.
2. Enforce auth/org/role checks server-side:
   - athlete can send only for self
   - coach/admin can send in-org only
3. Enforce consent and suppression checks before send:
   - `smsOptIn == true`
   - not unsubscribed
   - phone is valid E.164
4. Persist outbound log in `messages` with `channel = sms`.
5. Add webhook function: `smsEventWebhook`:
   - signature validation
   - map provider statuses to internal delivery statuses
   - write `message_events`
   - update `athlete_contacts`
6. Add replay-safe idempotency keys for webhook events.
- Go/No-Go gate:
1. Controlled send to 3 contacts produces expected sent/failed counts.
2. Webhook updates contact status for delivered/failed/unsubscribed.
3. Duplicate webhook event does not duplicate state transitions.

## Phase 3: UI Enablement (Messages Page)
- Objective: expose SMS as first-class channel in current workflow.
- Tasks:
1. Add channel selector in `src/pages/Messages.jsx` (`Email`, `SMS`).
2. Add phone column/edit flow in athlete contacts UI.
3. Add consent controls:
   - opt-in state
   - opt-in timestamp/source
   - unsubscribed indicator
4. Add SMS template editor (org + athlete level) with character counter.
5. Keep existing email flow default when SMS is disabled.
6. Hide SMS send actions when org setting is off.
- Go/No-Go gate:
1. Athlete can send SMS to consented contacts only.
2. Non-consented contacts are clearly excluded from send.
3. UI shows clear status and retry/edit action for failed numbers.

## Phase 4: Reliability, Monitoring, and Runbooks
- Objective: production reliability and operator visibility.
- Tasks:
1. Add webhook failure monitor support for SMS source.
2. Add alert thresholds for SMS webhook failures and provider errors.
3. Add daily reconciliation script:
   - compare `messages` vs provider delivery logs
   - flag unresolved statuses
4. Extend `RUNBOOK_PROD.md` and `DISASTER_RECOVERY_CHECKLIST.md` with SMS playbook.
5. Add weekly QA checklist for SMS consent and unsubscribe behavior.
- Go/No-Go gate:
1. Alerts fire on simulated webhook failures.
2. Reconciliation identifies injected mismatch test case.
3. Incident runbook tested in tabletop drill.

## Phase 5: Controlled Rollout
- Objective: launch safely and expand.
- Tasks:
1. Enable SMS for one org pilot only.
2. Cap daily send volume by org and by athlete.
3. Collect deliverability, opt-out, and error rate metrics for 2 weeks.
4. Review support burden and message quality.
5. Expand to additional orgs after pilot KPI pass.
- Pilot KPIs:
1. Delivery success rate >= 95% (excluding invalid numbers).
2. Opt-out rate below threshold you define (example: < 3%).
3. No unresolved Sev1 incidents.

## Implementation Order (Repo)
1. `functions/index.js`
   - add `sendAthleteSmsMessage`
   - add `smsEventWebhook`
   - add provider client + status mapping helpers
2. `src/pages/Messages.jsx`
   - channel selector + SMS send flow + consent/status UI
3. `firestore.rules`
   - permit only required field updates for SMS metadata
4. `scripts/`
   - add migration/backfill script for contact fields
   - add reconciliation script
5. Docs
   - update launch checklist with SMS item group when feature is enabled

## Secrets and Env (Functions)
- `SMS_PROVIDER_API_KEY` (or provider equivalent)
- `SMS_PROVIDER_API_SECRET` (if required)
- `SMS_WEBHOOK_SIGNING_SECRET`
- `SMS_DEFAULT_SENDER`
- `SMS_ALERT_EMAIL` (optional, if separated from webhook alert email)

Do not store these in repo. Use Firebase Secret Manager for production.

## Weekly Tracking Template
- Current phase:
- Owner:
- Status:
- Blockers:
- Next checkpoint date:

