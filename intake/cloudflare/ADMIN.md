# Secure Intake Admin

Operator-facing admin UI and workflow layer for the sealed intake boundary.

## Architecture

```
Browser (Admin)              Cloudflare Pages + D1
├─ Load identity key file    ├─ Cloudflare Access (SSO)
├─ Fetch ciphertext via API  ├─ Admin API (ciphertext only)
├─ Decrypt locally (memory)  ├─ Workflow metadata (D1)
└─ Export to local file      └─ No plaintext. Ever.
```

The server never decrypts. The admin decrypts locally in the browser.

## Deployment

### 1. Run the admin migration

```bash
# Local
npm run db:migrate

# Remote
npm run db:migrate:remote
```

### 2. Set admin environment variables

```bash
# Comma-separated operator emails for defense-in-depth
wrangler pages secret put ADMIN_EMAILS --project-name secure-intake
# Enter: admin@example.com,operator@example.com

# Optional: webhook for new submission notifications (metadata only)
wrangler pages secret put NOTIFY_WEBHOOK_URL --project-name secure-intake
# Enter: https://discord.com/api/webhooks/... or https://hooks.slack.com/...
```

### 3. Protect with Cloudflare Access

Create a Cloudflare Access application to protect admin routes:

1. Go to **Cloudflare Zero Trust > Access > Applications**
2. Create a **Self-hosted** application
3. Set the application domain to your Pages domain
4. Add a path rule for `/admin/*` and `/api/admin/*`
5. Create an Access policy:
   - **Action**: Allow
   - **Include**: Emails matching your operator list
6. Save and deploy

This ensures SSO authentication before any admin content is served.

### 4. Deploy

```bash
npm run deploy
```

### 5. Access the admin UI

Visit `https://your-project.pages.dev/admin/intake` (Cloudflare Access will prompt for SSO login).

## Admin API

All admin API endpoints require Cloudflare Access identity headers.
All responses include `Cache-Control: no-store`.

### List submissions

```
GET /api/admin/intake?limit=50&cursor=<cursor>
```

### Fetch submission (ciphertext)

```
GET /api/admin/intake/:id
```

### Mark processed

```
POST /api/admin/intake/:id/mark-processed
Body: { "note": "optional" }
```

### Update note

```
POST /api/admin/intake/:id/note
Body: { "note": "required" }
```

### Revert to new

```
POST /api/admin/intake/:id/unprocess
```

## Notifications

When `NOTIFY_WEBHOOK_URL` is set, new submissions trigger a best-effort webhook with metadata only:

```json
{
  "content": "New intake submission `abc123def456…` (loggie.intake.v1) at 2026-01-01T00:00:00Z"
}
```

The webhook payload contains **zero plaintext**. It includes only the submission ID, version, and timestamp.

## Key File Format

The admin UI accepts identity key files in these formats:

1. **Nested format** (`org.identity.json`):
   ```json
   { "keys": { "x25519": { "secret": "0x..." }, "kyber": { "secret": "base64..." } } }
   ```

2. **Flat format** (HybridIdentity):
   ```json
   { "x25519SecHex": "0x...", "kyberSecB64": "base64..." }
   ```

3. **Vault format** (decrypted vault):
   ```json
   { "identities": [{ "x25519SecHex": "0x...", "kyberSecB64": "base64..." }] }
   ```

The key file is **never uploaded** to the server. It is read into browser memory only and cleared when the page is closed or the "Clear key" button is pressed.
