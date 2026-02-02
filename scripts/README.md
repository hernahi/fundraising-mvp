Scripts Notes

- `phase13_fix.js` supports `--backfillDonors` to backfill `donorId`, `totalDonations`, and `lastDonationAt` from the donations collection.
  - Dry run: `node scripts/phase13_fix.js --projectId YOUR_PROJECT_ID --backfillDonors`
  - Apply: `node scripts/phase13_fix.js --projectId YOUR_PROJECT_ID --backfillDonors --apply`
- `backfill_campaign_public.js` sets `isPublic: true` on all existing campaigns.
  - Dry run: `node scripts/backfill_campaign_public.js --projectId YOUR_PROJECT_ID`
  - Apply: `node scripts/backfill_campaign_public.js --projectId YOUR_PROJECT_ID --apply`
- `backfill_public_donors.js` creates `campaigns/{campaignId}/public_donors` entries for paid donations.
  - Dry run: `node scripts/backfill_public_donors.js --projectId YOUR_PROJECT_ID`
  - Apply: `node scripts/backfill_public_donors.js --projectId YOUR_PROJECT_ID --apply`
