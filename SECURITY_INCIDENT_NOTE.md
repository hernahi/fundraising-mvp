# Security Incident Note

## Incident

Google issued an abuse notification that the Firebase web API key for project `fundraising-mvp-client` / `fundraising-mvp-auth-payments` was publicly accessible in git history via a tracked `.env` file.

## Scope

Confirmed exposed value:

- Firebase web API key

Reviewed during incident response:

- Historical `.env` existed in public commits
- Stripe secret reference found in history appeared to be placeholder text (`sk_test_xxxxx`)
- No plain-text Mailgun private key, Stripe webhook secret, or service account private key was confirmed in tracked text history
- Tracked `ZIP_Files/` artifacts were reviewed by filename and archive listing and did not show obvious bundled secret files

## Remediation Completed

- Removed tracked `.env` from git
- Added `.env.example`
- Hardened `.gitignore` to ignore:
  - `.env`
  - `.env.*`
  - local secret/note files
  - local Stripe test secret files
  - `cors.json`
- Created a replacement Firebase web API key
- Updated the app configuration to use the replacement key
- Added HTTP referrer restrictions for:
  - `https://inetsphere.com/*`
  - `https://www.inetsphere.com/*`
  - `https://fundraising-mvp.vercel.app/*`
  - `http://localhost:5173/*`
  - `https://fundraising-mvp-auth-payments.firebaseapp.com/*`
- Applied API restrictions on the replacement key for the Firebase/Google APIs required by the app
- Deleted the old leaked API key

## Validation Completed

- App load: OK
- Google sign-in: OK
- Firestore-backed pages: OK
- Team avatar upload: OK
- Donation page load: OK
- Stripe checkout open: OK

## Residual Risk

- Repo history remains historically dirty because `.env` existed in public commits
- Current risk is reduced because the exposed API key was deleted and replaced
- Full history rewrite was assessed as optional, not required, based on current evidence

## Follow-Up

- Keep the replacement key configuration as-is unless a real production flow breaks
- Continue keeping env files and local secret artifacts out of git
- If future evidence shows a real server-side secret was committed, rotate that secret immediately and reassess history cleanup
