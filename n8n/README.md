# WhatsApp Evaluation Reminder System — Setup Guide

Two importable n8n workflows in this folder:
- `evaluation-reminder-outbound.json` — sends the reminder 2 hours before each evaluation
- `evaluation-reminder-inbound.json` — replies to anyone who texts back, redirecting them to their agent

Everything below is the order to actually get this running, start to finish.

## 1. Get Meta WhatsApp Cloud API access (you don't have this yet)

1. **Meta Business Account** — [business.facebook.com](https://business.facebook.com), create one for Shelley Residential if you don't already have one. Needs your real business details; only you can do this step.
2. **Create a Meta App** — [developers.facebook.com/apps](https://developers.facebook.com/apps) → Create App → type **Business** → link it to the Business Account from step 1.
3. **Add the WhatsApp product** — in the App Dashboard, "Add Product" → WhatsApp. This immediately gives you a **free test phone number** — no need to buy or port a real number yet. The test number can message up to 5 phone numbers you manually add as verified recipients, which is exactly what you want for testing before this touches real sellers.
4. **Phone Number ID** — WhatsApp → API Setup page shows it directly. This is the `whatsappPhoneNumberId` value in both workflows' CONFIG node.
5. **A token that doesn't expire** — the API Setup page hands you a temporary 24-hour token (fine for a first curl test, useless for a scheduled n8n workflow). For a real one: Business Settings → Users → System Users → Add → give it Admin access to the WhatsApp app with `whatsapp_business_messaging` + `whatsapp_business_management` permissions → Generate Token. Treat this exactly like a password — it's what goes into n8n's credential manager.
6. **Add test recipients** — WhatsApp → API Setup → add your own number and a couple of teammates' numbers as verified recipients, so you can send real test messages before this goes anywhere near an actual seller.
7. **Business Verification** — only needed once you want to message people *beyond* those 5 test numbers (i.e. to go live). Meta reviews real business documents; can take a few days. Not required to build or test anything else here — start it early since it's the slowest step, but everything else works fine on the test number in the meantime.

## 2. Create the message template

WhatsApp → Message Templates → Create Template:

| Field | Value |
|---|---|
| Name | `evaluation_reminder` (exact, lowercase, this exact spelling — it's referenced literally in the workflow) |
| Category | **Utility** |
| Language | English (or your choice — see note below) |
| Buttons | None |

**Body:**
> Hi {{1}}, this is {{2}} confirming our property evaluation appointment on {{3}} at {{4}}. If you have any questions before then, please contact me directly on {{5}}.

**Sample values** (Meta requires one example per variable for review):
1. Sarah Johnson
2. Luke Allnatt
3. Thursday, 14 Aug at 14:00
4. 20 David Mclean Drive, Dawncrest
5. +27 64 073 6726

Submit for review — usually approved within minutes to a few hours. It won't send until approved.

> If you pick a language other than English, change `"code": "en_US"` in both places in the outbound workflow's "Send WhatsApp Template" node to match (e.g. `en_GB`, `en`) — it has to match the template's configured language exactly or the send will fail.

## 3. Import both workflows into n8n

Once you've set up n8n: **Workflows → Import from File** → pick each JSON. You'll see two workflows appear, each starting with a yellow "Setup Notes" sticky note on the canvas — read those first, they repeat the steps below in context.

## 4. Set up credentials (n8n's Credential Manager)

Two credentials, used by both workflows:

1. **Supabase** — Credentials → New → search "Supabase" → Host = your project URL (`https://xxxxx.supabase.co`), Service Role Secret = your Supabase service_role key (Project Settings → API in Supabase). Name it "Supabase account" (or whatever — you'll pick it from a dropdown on each HTTP Request node either way).
2. **Meta access token** — Credentials → New → search "Header Auth" → Name field: `Authorization` → Value field: `Bearer YOUR_LONG_LIVED_TOKEN` (the System User token from step 1.5, with the literal word `Bearer` and a space before it). Name the credential "Meta WhatsApp Access Token".

Then open each HTTP Request node that needs one and pick your credential from its dropdown (they're pre-wired to expect a credential, they just need you to select which one).

## 5. Fill in the CONFIG node (each workflow has one)

Not a secret, just plain settings — click the **CONFIG** node in each workflow and replace the placeholder values:

- `supabaseUrl` → your real project URL
- `whatsappPhoneNumberId` → from step 1.4
- `whatsappGraphVersion` → leave as `v21.0` unless Meta's deprecated it by the time you read this
- *(inbound only)* `generalOfficeNumber` → your office's general contact number, used as the fallback reply when no matching contact/evaluation is found

## 6. Set the inbound webhook's verify token

Open the inbound workflow's **"Verify Token Matches?"** node and replace `REPLACE_WITH_YOUR_VERIFY_TOKEN` with any string you make up (a random password works fine — it's not secret exactly, just needs to match).

## 7. Activate the inbound workflow, then wire it into Meta

1. Toggle the inbound workflow **Active**.
2. Click the "Receive Inbound Message" webhook node → copy the **Production URL**.
3. Meta App Dashboard → WhatsApp → Configuration → Webhook → paste that URL as the Callback URL, and enter the *same* verify token you just set in step 6.
4. Subscribe to the `messages` field.
5. Meta will immediately hit your webhook with the verification handshake — if the token matches, it goes green/subscribed.

## 8. Test both workflows manually before turning on the schedule

Both workflows have a **Manual Trigger** node alongside the real one — click "Test Workflow" (bottom of the n8n canvas) to run each on demand, without waiting for the schedule or a real WhatsApp message:

- **Outbound**: manually running it queries whatever's actually due right now (nothing, most likely, until you create a test evaluation scheduled ~2 hours out with a Seller contact that has a phone number in your 5 verified test recipients). Check the "Build Send List" node's output to see exactly what it would have sent, and "Ready To Send?" to confirm it correctly finds (or skips) that evaluation.
- **Inbound**: the Manual Trigger runs against a canned sample message (since there's no real webhook payload to replay) — good enough to confirm the contact lookup → evaluation lookup → agent redirect chain resolves correctly for a contact that actually exists in your data. For a *real* end-to-end test, text your WhatsApp test number from a verified recipient's phone once the webhook is wired up.

Re-running either workflow multiple times against the same data is safe:
- Outbound only sends to evaluations where `reminder_sent = false`, and flips that immediately after a successful send — a second run finds nothing left to do for that evaluation, so no double-sends.
- Inbound doesn't write anything to the database at all, so re-running it (or getting the same message twice) just sends the same reply again — no state to get out of sync.

## 9. Turn it on

Toggle the outbound workflow **Active**. It'll fire every 15 minutes from then on.

---

### Why the outbound query looks the way it does

A couple of non-obvious things baked into `Fetch Due Evaluations`, worth knowing if you ever need to touch it:

- **The two-hour window is actually 15 minutes wide** (1h50m out to 2h05m), not a single instant — sized to comfortably straddle the 15-minute poll interval so no evaluation ever falls through the gap between two runs, while `reminder_sent` prevents it from being caught (and sent) twice by two overlapping runs.
- **The Seller is found via a tag, not a direct column** — evaluations link to contacts through a join table (`evaluation_contacts`), because one evaluation can have several contacts (seller, attorney, managing agent, tenant). The workflow picks whichever contact is tagged "Seller", falling back to whoever's marked primary if there's no explicit tag — same logic the app itself uses everywhere else.
- **"Most recent evaluation" for a contact is sorted in code, not in the query** — Supabase's REST API can't sort a list by a column on a *joined* table (it can only reorder items *within* a nested relation, not the outer rows), so the inbound workflow fetches all of a contact's evaluations and picks the latest one itself.
