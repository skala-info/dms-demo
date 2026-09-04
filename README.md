# DMS demo1

A **trimmed, runnable slice** of the DMS specification, in JavaScript, with **zero npm
dependencies**.

It implements one user flow end to end:

> **Register a donor → record a donation → keep that donor informed, by email, of how far
> the campaign has got towards its goal** — plus the awkward scenarios that make that
> hard: opt-outs, reversals, retries, duplicates, and closing a campaign.

The full specification set lives at the repository root (`00-glossary.md` …
`21-agent-task-protocol.md`) and targets Python/FastAPI/PostgreSQL. The trimmed
specification that *this* code satisfies is in [`../docs/demo1/`](../docs/demo1/).

---

## Run it

```bash
cd demo1
npm run demo     # the whole flow, narrated, with assertions
npm run seed     # fill data/db.json with the console's demo dataset
npm test         # 64 tests: domain, HTTP contract, notification scenarios, stats, layering, console
npm start        # the HTTP API on :3000, with the console at http://localhost:3000/
                 # (the console also runs with no server at all - see "Hosting it with no backend")
```

No install step. Node 18.17+ (developed on 20).

`npm run demo` writes every generated email to `demo1/outbox/*.eml` — open one in a mail
client or a browser to see the rendered progress bar — and leaves the database at
`demo1/data/db.json`.

```
S3. Record a donation — receipt issued, progress reported back to the donor
------------------------------------------------------------------------
   OK  donation 5000.00 USD posted, receipt R2026000001 issued
   OK  email sent: "Thank you for your gift of USD 5,000.00"
   includes: receipt number, deductible amount, and "10% of the goal is funded"
```

## The console

`npm start` also serves a small operator console at **<http://localhost:3000/>** — open it
in a browser. It is one HTML page, one stylesheet and one script, with no framework and no
build step, and it is a *client* of `/api/v1` like any other: same API key, same auth, same
envelopes. No rule is re-implemented in it, because a rule the UI needed would be a rule in
the wrong place.

| Screen | What it is for |
|---|---|
| Overview | Money raised, campaign progress bars, two share rings, the latest gifts and the latest mail |
| Donors | Register a donor, edit contact preferences, read one donor's giving and message history |
| Donations | Record a split gift (with a live allocation balance), reverse one |
| Campaigns | Create funds and campaigns, watch progress and milestones, send an update, close it |
| Stats | Charts: money by month, gift sizes, payment methods, what happened to the mail |
| Communications | Every message queued, sent or **suppressed** — with the rendered email and the reason |
| Activity | The transactional outbox and the audit trail |

`data/db.json` is a real, persistent store: `npm start` provisions an organisation only
when the database is empty, so it will **not** re-seed a file that already exists. After
the demo content changes, run `npm run seed` (or delete `data/db.json`) to see the new
world locally. The static build has no such file — it seeds itself on every load, from
the same definition.

The dashboard carries two donuts — **raised by campaign** and **how the money arrives** —
because those are the two questions on it that are genuinely *part-to-whole*: one total,
split a handful of ways, with the slices far enough apart to be read at a glance. That is
the only case a ring is honest, so the rest of the charts stayed bars. Gift-size bands sit
within a gift or two of each other and message outcomes are two states in practice; as
rings, both would hide precisely the thing the reader is trying to see. Past four
categories the tail folds into "Other" rather than growing new colours.

The **Stats** page draws its charts as hand-written inline SVG — no charting library, no
CDN, nothing to install — from a single `GET /api/v1/stats`. The aggregation lives in
`src/domain/stats.js` and is unit-tested, because a chart looks convincing whatever it is
drawn from: "raised" there is the same `countsTowardsSummary` rule the progress bars and
the donor summaries use, so a reversed gift leaves the charts exactly as it leaves the
ledger. Each chart carries a hover/focus readout and a **Table** switch, so no value is
reachable only by pointing at it; message outcomes wear the reserved status colours and
are always named as well as coloured. The range presets scope every chart below them —
progress-to-goal sits above the filter because a goal is cumulative, not a period figure.

**Run jobs** in the top right drains the outbox and sends the queued mail, so the whole
notification story is visible without waiting for a scheduler. The API key box in the
bottom-left corner is pre-filled with `demo-key` and remembered in `localStorage`; the
console's files are public, everything it then asks for is not.

## Hosting it with no backend

The demo also runs as **pure static files** — Netlify, GitHub Pages, or a folder opened
over any static server — with no Node process anywhere.

It is not a mock. When nothing answers `/health`, `src/web/public/boot.js` loads demo1's
own request handler into the page and points `fetch` at it, so the router, the services,
the domain rules, the receipt numbering, the idempotency keys, the outbox and the seven
email templates are the same modules `npm start` loads. Two things swap, and both were
already swappable: the store keeps its rows in memory instead of flushing to `data/db.json`,
and the email adapter is the in-memory one. Every visitor gets a private dataset, seeded
through the public API by `seed.js`, and a reload gives them a fresh one.

The `node:` imports that the source makes are resolved by an **import map** in
`index.html` onto small browser shims in `src/web/public/shims/` — so there is still no
build step, and not one line of the server code had to change.

`netlify.toml` publishes this folder as-is (the page imports `/src/...` at runtime, so the
source has to ship too) and maps `/ui/*` onto the page's directory:

```toml
[build]
  publish = "."

[[redirects]]
  from = "/ui/*"
  to = "/src/web/public/:splat"
  status = 200

[[redirects]]
  from = "/*"
  to = "/src/web/public/index.html"
  status = 200
```

Point Netlify's base directory at `demo1` and deploy — there is no build command.

## Try the API

```bash
npm start
KEY=demo-key
BASE=http://localhost:3000/api/v1

curl -sX POST $BASE/funds -H "Authorization: Bearer $KEY" -H 'Content-Type: application/json' \
  -d '{"code":"TRAIN","name":"Training & Discipleship Fund"}'

curl -sX POST $BASE/campaigns -H "Authorization: Bearer $KEY" -H 'Content-Type: application/json' \
  -d '{"code":"ALS26","name":"Africa Leadership Summit","goal":"25000.00","currency":"USD","end_date":"2026-12-31"}'

curl -sX POST $BASE/donors -H "Authorization: Bearer $KEY" -H 'Content-Type: application/json' \
  -d '{"first_name":"Jane","last_name":"Okonkwo","email":"jane@example.com","welcome_campaign_id":"<campaign-id>"}'

curl -sX POST $BASE/donations -H "Authorization: Bearer $KEY" -H 'Content-Type: application/json' \
  -H "Idempotency-Key: $(uuidgen)" \
  -d '{"donor_id":"<donor-id>","amount":"5000.00","currency":"USD","donation_date":"2026-08-27",
       "method":"CHECK","allocations":[{"fund_id":"<fund-id>","campaign_id":"<campaign-id>","amount":"5000.00"}]}'

# drain the outbox and send the queued mail (these are scheduled workers in production)
curl -sX POST $BASE/jobs/run -H "Authorization: Bearer $KEY" -H 'Content-Type: application/json' -d '{}'

curl -s $BASE/campaigns/<campaign-id>/progress -H "Authorization: Bearer $KEY"

# everything the stats page charts, in one aggregate; ?from=&to= narrow the period
curl -s "$BASE/stats?from=2026-01-01" -H "Authorization: Bearer $KEY"
curl -s $BASE/donors/<donor-id>/communications -H "Authorization: Bearer $KEY"
```

## Layout

```
demo1/
├── src/
│   ├── main.js                 process entry point
│   ├── app.js                  request lifecycle: auth -> route -> service -> envelope
│   ├── core/                   config, errors, money, dates, ids, audit, events, idempotency, logging, http
│   ├── db/                     store.js (the whole persistence layer), seed.js (provisioning)
│   ├── domain/                 PURE rules: donor.js, allocation.js, campaign.js, summary.js, receipt.js
│   ├── repositories/           the only place a query is written; enforces tenant scoping
│   ├── services/               use cases + the transaction boundary
│   ├── api/v1/                 routers and presenters
│   ├── integrations/email/     the email port + console / file / memory / failing adapters
│   ├── workers/                outbox drain, mailer with retry, campaign digests
│   ├── templates/              sandboxed renderer + the seven email templates
│   ├── web/                    static.js + public/ — the operator console
│   └── testing/harness.js      in-process server + HTTP client
├── scripts/demo.js             the narrated walkthrough
└── tests/                      domain, api, scenarios, architecture
```

The layering rule — `api → services → domain → repositories → db`, with `core/` available
to everyone — is **enforced by `tests/architecture.test.js`**, not by convention.

## What was kept from the full spec, and what was cut

| Kept (because the flow depends on it) | Cut (documented as out of scope) |
|---|---|
| Donor record with derived `display_name`/`sort_name`, contact preferences | Households, relationships, flags, notes, attachments, merge/dedupe UI |
| Donation with **split allocations that must sum exactly** | Pledges, recurring gifts, batch entry, soft credits, tributes, multi-currency |
| Fund + Campaign coding, campaign progress to goal | Appeal and Package (the 3rd and 4th coding axes), custom fields |
| Receipts: sequential numbering, immutable snapshot, void-and-reissue | Consolidated annual receipting, PDF rendering, mailing labels |
| Derived giving summary, rebuildable | LYBUNT/SYBUNT, donor scores, the report engine |
| One aggregate (`GET /stats`) behind the console's charts | Scheduled reports, saved views, exports, drill-down |
| Transactional outbox + domain events + idempotent consumers | Webhooks out to tenants, automation rules, search indexing |
| The email port, suppression service, template sandbox, retry/dead-letter | ESP integration, mass marketing mail, bounce webhooks |
| RFC 9457 errors, cursor pagination, ETag concurrency, Idempotency-Key, audit trail | OAuth2/JWT (an API key stands in), RBAC, field-level security, RLS |

Money is an integer of minor units everywhere inside the system and a decimal **string**
with a sibling `currency` on the wire. There is no float anywhere in the codebase.

## Where the interesting decisions live

| Question | File |
|---|---|
| What counts as "raised"? | `src/domain/campaign.js` — POSTED, not excluded, allocation-level |
| When does a milestone email fire? | `src/domain/campaign.js` `newlyCrossedMilestones` — upward only, once, durable |
| Who may be emailed, and about what? | `src/domain/donor.js` `suppressionReason` — one function, three message kinds |
| How is a double-charge prevented? | `src/core/idempotency.js` + `POST /donations` requiring `Idempotency-Key` |
| Why did this donor not get that email? | `GET /api/v1/donors/{id}/communications` — suppressed messages are recorded, not skipped |
| Why does the UI hold no rules? | `src/web/` — it serves files; the page it serves calls `/api/v1` |
| How does it run without a server? | `src/web/public/boot.js` — the real handler, in the page, behind `fetch` |
| Where do the charts get their numbers? | `src/domain/stats.js` — aggregated server-side, off the same `countsTowardsSummary` rule |
| When is a pie chart allowed? | `donutChart` in `src/web/public/app.js` — part-to-whole, few slices, well separated; everything else is a bar |
