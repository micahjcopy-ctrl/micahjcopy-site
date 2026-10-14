# micahjcopy-site

Personal marketing site for Micah Jacobi. Static site, auto-deployed to Vercel.

Motion v4 (GSAP studio layer, site-wide) — deployed 2026-07-10.

## Call CRM — `/crm`

Cold-call CRM for appointment setting (tap-to-call from the caller's own phone, outcome logging, follow-up queue, custom columns, CSV import/export). Files: `crm.html`, `crm.js`, `crm.css`, `api/crm.js`, `crm.sql`.

**One-time setup**
1. Supabase → SQL Editor → paste `crm.sql` → Run (creates `crm_leads`, `crm_calls`, `crm_settings`).
2. Vercel → micahjcopy → Settings → Environment Variables → add `CRM_USERS` = `hayden:<long random string>` (more callers: `name:token,name:token`). Your existing `REVIEWS_ADMIN_TOKEN` already signs you in as "micah".
3. Redeploy. Open https://micahjacobi.me/crm and sign in with the token.

Pipeline stages, custom columns, retry timing and the booking link are all editable inside the app under Settings.
