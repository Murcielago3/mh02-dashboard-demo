# Studio MH02 — Demo

A standalone, **backend-less** demo of the Studio MH02 management app. Same UI as
production; all data lives in the browser. Nothing is sent to or stored on a
server, so it deploys as static files (Hostinger, Netlify, Cloudflare Pages…)
with no VPS, database, or API.

## Run locally

```bash
npm install
```

```bash
npm run dev
```

Sign in with any of the seeded studio emails and **any password** —
`admin1@demostudio.com` gives the full admin view.

## Using it in a pitch

- **Run demo data** — a full, internally consistent dataset is generated on
  first load (12 people, 8 projects, stages/subtasks, 10 weeks of timesheets,
  invoices, expenses, reimbursements, salary slips).
- **View as** — the floating pill (bottom-right) switches between Admin, PM and
  Employee **without logging out**, on the same data.
- **Reset demo data** — same menu; wipes localStorage and regenerates.

Data persists in `localStorage`, so a refresh mid-demo doesn't lose anything.

## What differs from production

| Area | Production | Demo |
|---|---|---|
| Data | Postgres via FastAPI | in-memory store, persisted to `localStorage` |
| Auth | JWT + bcrypt | any password; token encodes the demo user id |
| PDFs | WeasyPrint (server) | same HTML templates, printed from an isolated iframe → browser "Save as PDF" |
| Exports | server CSV/zip | CSV built client-side, bundle is one concatenated CSV |
| Uploads | saved to disk | `URL.createObjectURL` (session-only) |
| Slack/email | Celery jobs | not present |

PDF fidelity is unchanged: the templates are the production HTML, and the
browser's print engine is a superset of WeasyPrint's.

## Build & deploy

Served from a domain/subdomain root:

```bash
npm run build
```

Served from a subfolder (e.g. `example.com/demo/`):

```bash
VITE_BASE=/demo/ npm run build
```

Upload the contents of `dist/` to the web root. The router uses **hash history**
(`/#/admin/dashboard`), so deep links and refreshes work on static hosting with
no `.htaccess` rewrite needed.

## Layout

```
src/
  api/            unchanged from production, except client.js
  api/client.js   -> points at the mock router instead of axios
  demo/
    db.js         reactive store + localStorage persistence + SEED_VERSION
    seed.js       bottom-up generator (rollups summed, never assigned)
    derive.js     ported formulas: cost freezing, comp-off, reserve, slip net
    mockClient.js axios-shaped router over in-memory handlers
    handlers/     core | projects | hr | finance
    pdf/          ported invoice + salary-slip templates, iframe printing
    DemoBar.vue   role switcher + reset
  components/ views/ stores/ router/ utils/   unchanged from production
```

### Changing the seed

Edit `src/demo/seed.js`, then bump `SEED_VERSION` in `src/demo/db.js` so stale
`localStorage` data is discarded instead of breaking views that expect the new
shape. Dates are generated relative to *today*, so the demo always looks live.
