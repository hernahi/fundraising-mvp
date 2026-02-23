# Production Runbook (Fundraising MVP)

## Scope
This runbook covers production operations for:
- Frontend: Vercel
- Backend: Firebase Functions + Firestore
- Payments: Stripe Checkout + Stripe Webhook
- Messaging: Mailgun API + Mailgun Webhook

## Owners
- Primary operator: Admin/Founder
- Backup operator: Designated coach/admin

## Critical Systems
- Stripe webhook: `stripeWebhook`
- Mailgun webhook: `mailgunEventWebhook`
- Drip scheduler: `runAthleteDrip`
- Webhook alert monitor: `webhookFailureMonitor`

## Daily Checks (5-10 min)
1. Vercel deployment status = healthy.
2. Stripe recent webhook deliveries = no sustained failures.
3. Mailgun webhook events flowing into Firestore `message_events`.
4. Firebase Functions logs have no sustained `handler failed` spikes.
5. Alert inbox has no unresolved webhook alert emails.

## Incident Severity
- Sev 1: Payments blocked or data corruption risk.
- Sev 2: Email delivery impaired, partial user impact.
- Sev 3: Minor UI/ops issue, workaround exists.

## Incident Response Template
1. Detect
- What failed, when, and user impact.
2. Contain
- Stop unsafe actions; preserve data integrity.
3. Mitigate
- Apply low-risk rollback or config fix.
4. Verify
- Confirm end-to-end behavior with test transaction.
5. Communicate
- Update team/admin notes and log timeline.
6. Follow-up
- Add root cause + prevention action.

---

## Playbook A: Stripe Webhook Failure

### Symptoms
- Donations paid in Stripe but missing/late in Firestore.
- `stripeWebhook` logs show signature or handler failures.

### Triage
1. Check Stripe Dashboard -> Webhooks -> recent deliveries.
2. Confirm response codes for `checkout.session.completed`.
3. Check Firebase logs:
   - `stripeWebhook: received event`
   - `stripeWebhook: about to write donation`
   - `stripeWebhook: donation saved`
   - `stripeWebhook: handler failed`

### Mitigation
1. Verify `STRIPE_WEBHOOK_SECRET` and `STRIPE_SECRET_KEY`.
2. Redeploy only affected function:
   - `firebase deploy --only functions:stripeWebhook --project fundraising-mvp-auth-payments`
3. Replay failed Stripe events from Stripe Dashboard.

### Recovery Validation
1. Firestore has one `donations/{sessionId}` doc only (idempotent).
2. Campaign totals updated correctly.
3. Confirmation receipt path still works.

---

## Playbook B: Mailgun Webhook / Delivery Failure

### Symptoms
- Athlete contact status not updating.
- Missing `message_events` entries.
- Alert email reports mailgun webhook failures.

### Triage
1. Check Firestore `message_events` (source=`mailgun`).
2. Check `webhook_failures` for `source=mailgun`.
3. Verify `MAILGUN_WEBHOOK_SIGNING_KEY` in `functions/.env`.

### Mitigation
1. Correct webhook signing key mismatch.
2. Redeploy:
   - `firebase deploy --only functions:mailgunEventWebhook --project fundraising-mvp-auth-payments`
3. Send one test message and verify event ingestion.

### Recovery Validation
1. New `message_events` docs appear with eventType/recipient.
2. `athlete_contacts` delivery fields update as expected.

---

## Playbook C: Vercel Frontend Failure / Bad Deploy

### Symptoms
- Public pages 404, login failures, broken routes/UI.

### Mitigation
1. In Vercel Deployments, identify last known good deployment.
2. Promote/redeploy known good deployment.
3. Validate:
   - `/login`
   - `/donate/:campaignId`
   - `/donate/:campaignId/athlete/:athleteId`
   - `/messages`

### Recovery Validation
1. Critical routes load.
2. Donation checkout starts successfully.
3. No console-breaking errors on core flows.

---

## Playbook D: Firebase Service Degradation

### Symptoms
- Auth/session issues, Firestore read/write failures, function timeouts.

### Mitigation
1. Check Firebase status page and GCP status.
2. Pause high-risk operational changes.
3. Inform internal users of temporary degraded mode.
4. Resume after platform health recovers.

### Recovery Validation
1. Run one Stripe checkout test.
2. Run one Mailgun invite test.
3. Confirm logs and Firestore writes return to normal.

---

## Post-Incident Review (required)
Capture:
- Start/end time
- Root cause
- User impact
- What fixed it
- Preventive change to implement next

