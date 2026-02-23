# Disaster Recovery Checklist (Weekly)

Use this every week. Mark each line: `Green`, `Yellow`, or `Red`.

## A. Backup Readiness
- [ ] Firestore backup/export process documented and current.
- [ ] Most recent backup date verified.
- [ ] Backup storage location/access confirmed.
- [ ] Required IAM permissions for restore confirmed.

## B. Restore Readiness
- [ ] Restore steps documented for critical collections:
  - `donations`
  - `campaigns`
  - `athletes`
  - `athlete_contacts`
  - `message_events`
- [ ] Expected RTO (restore time objective) defined.
- [ ] Expected RPO (data loss window) defined.
- [ ] Last restore tabletop drill completed this month.

## C. Payments Recovery
- [ ] Stripe webhook endpoint healthy.
- [ ] Stripe replay procedure documented and tested.
- [ ] Reconciliation procedure documented (`reconcileStripeToFirestore`).
- [ ] One replay/reconciliation test completed in non-production window.

## D. Messaging Recovery
- [ ] Mailgun webhook signing key verified.
- [ ] Mailgun webhook event ingestion verified (`message_events`).
- [ ] Drip send fallback procedure documented (manual resend path).
- [ ] Bounce/complaint handling path verified on athlete contacts.

## E. Alerting and Detection
- [ ] `webhookFailureMonitor` deployed and healthy.
- [ ] `WEBHOOK_ALERT_EMAIL` set and monitored.
- [ ] Alert cooldown/threshold behavior validated in last 30 days.
- [ ] On-call owner designated for this week.

## F. Frontend Rollback Readiness
- [ ] Last known good Vercel deployment identified.
- [ ] Rollback/promotion process documented.
- [ ] Critical route smoke test checklist current.

## G. Security and Access
- [ ] Production admin accounts reviewed (least privilege).
- [ ] Service account key hygiene verified (no keys in repo).
- [ ] Firebase rules and indexes version-controlled and deployed.
- [ ] Secrets rotation schedule tracked.

## H. Communication Readiness
- [ ] Incident template prepared (internal + stakeholder update).
- [ ] Status update channel confirmed.
- [ ] Customer-facing fallback message prepared.

## Weekly Sign-off
- Week ending:
- Reviewed by:
- Overall DR status: `Green / Yellow / Red`
- Top 3 risks:
1.
2.
3.
- Actions due before next review:
1.
2.
3.

