# Mail Dashboard

Send HTML email through Amazon SES from a Google-protected dashboard. Keeps full history, tracks delivery,
bounces, complaints, opens and clicks, and honours unsubscribes.

Stack: Next.js (Vercel), Auth.js (Google, allowlist), Supabase Postgres (history), AWS SES + SNS.

## Setup

### 1. Supabase
Create a **new** project, open the SQL editor and run `supabase/schema.sql`. Copy the project URL and the
service-role key into `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY`.

### 2. Google login
Google Cloud Console → Credentials → OAuth client (Web). Redirect URIs:
`https://<your-app>/api/auth/callback/google` and `http://localhost:3000/api/auth/callback/google`.
Put the ID/secret in `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET`, set `AUTH_SECRET`, and list the allowed Google
accounts in `ALLOWED_EMAILS`.

### 3. Deploy to Vercel
Add every variable from `.env.example` to the Vercel project, deploy, and set `APP_URL` to the final URL.

### 4. SES events (bounces, complaints, delivery, opens, clicks)
Replace the placeholders and run (AWS CLI, same region as SES):

```bash
# a) Topic that receives SES events
aws sns create-topic --name ses-events          # note the TopicArn

# b) Let SES publish to it
aws sns set-topic-attributes --topic-arn <TopicArn> --attribute-name Policy --attribute-value '{
  "Version":"2012-10-17",
  "Statement":[{"Effect":"Allow","Principal":{"Service":"ses.amazonaws.com"},"Action":"sns:Publish",
  "Resource":"<TopicArn>","Condition":{"StringEquals":{"AWS:SourceAccount":"<AWS_ACCOUNT_ID>"}}}]}'

# c) Configuration set + event destination
aws sesv2 create-configuration-set --configuration-set-name mail-dashboard
aws sesv2 create-configuration-set-event-destination --configuration-set-name mail-dashboard \
  --event-destination-name to-sns --event-destination \
  "Enabled=true,MatchingEventTypes=SEND,DELIVERY,BOUNCE,COMPLAINT,REJECT,OPEN,CLICK,DELIVERY_DELAY,RENDERING_FAILURE,SnsDestination={TopicArn=<TopicArn>}"

# d) Point SNS at the app (the app confirms the subscription automatically)
aws sns subscribe --topic-arn <TopicArn> --protocol https \
  --notification-endpoint https://<your-app>/api/ses/events
```

Set `SES_CONFIGURATION_SET=mail-dashboard` and `SNS_TOPIC_ARN=<TopicArn>`. In the SNS console the subscription
should show **Confirmed**.

The IAM user needs `ses:SendEmail` (on the identity and configuration set).

## How it works
- **Compose** → creates a campaign and one `messages` row per recipient. Addresses already on the suppression
  list are stored as `suppressed` and never sent.
- **Sending** runs in batches of 20 from the browser (`/api/campaigns/:id/send`); it is resumable and safe to
  run from two tabs. Failed messages can be requeued.
- **SNS webhook** (`/api/ses/events`) verifies Amazon's signature, logs every event in `ses_events`, advances the
  message status (`sent → delivered → bounced/complained`, never backwards), and suppresses permanent bounces
  and complaints. Transient bounces are recorded but not suppressed.
- **Unsubscribe**: every email gets a footer link and `List-Unsubscribe` / one-click headers.
- Everything on the dashboard requires an allowlisted Google account; the database is reachable only through
  the server.

## Local development
```bash
cp .env.example .env.local   # fill in
npm install
npm run dev
```
SNS cannot reach localhost, so bounce/complaint events only arrive on the deployed app.

## Credits
- Typeface: [Inter](https://rsms.me/inter/) (SIL Open Font License 1.1), self-hosted in `public/fonts/`.
- Icons: [Solar icon set](https://icon-sets.iconify.design/solar/) by 480 Design (CC BY 4.0), inlined in `src/app/icons.tsx`.
- Colours and type settings follow Cloudflare's [Kumo](https://github.com/cloudflare/kumo) light theme.

## Feature tour
- **Compose**: visual builder, HTML or plain text; merge fields (`{{first_name|there}}`, `{{fields.batch}}`); live pre-send checks (spam signals, broken links, Outlook/Gmail compatibility, Gmail clipping); desktop/mobile/text/images-off previews; attachments; reply-to; preview text; test sends to up to 10 people; autosaved drafts; send now or schedule.
- **Audience**: contacts with tags and custom fields, CSV import with column mapping, exports, duplicate merge; groups; rule-based segments; per-group unsubscribe; suppressions.
- **Safety**: roles (admin / sender / viewer), optional approval for large sends, daily send limit, activity log, sender-health warnings against SES thresholds.
- **Insights**: per-campaign link clicks, opens, bounces; analytics charts; CSV exports.
- **Growth**: hosted signup forms + embed snippet with double opt-in.

## Background sending (scheduled + in-progress campaigns)
Supabase `pg_cron` calls `POST /api/cron/tick` every minute with `Authorization: Bearer $CRON_SECRET`.
Set `CRON_SECRET` in Vercel, then run once in the Supabase SQL editor:

```sql
select cron.schedule('mail-dashboard-tick', '* * * * *', $$
  select net.http_post(
    url := 'https://<your-app>/api/cron/tick',
    headers := jsonb_build_object('Authorization', 'Bearer <CRON_SECRET>')
  )
$$);
```
