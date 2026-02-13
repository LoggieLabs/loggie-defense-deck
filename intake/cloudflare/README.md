# @omnituum/secure-intake-cloudflare

Cloudflare Pages + D1 backend for encrypted intake submissions.

**Server complement to [@omnituum/secure-intake-client](https://github.com/Omnituum/secure-intake-client).**

## Core Invariant

**The server stores ciphertext ONLY.**

- Server **never** decrypts payloads (no private key)
- Server **never** recomputes ID (trusts client hash)
- Server **never** logs plaintext (impossible - no key)
- Encrypted JSON blob stored verbatim in D1
- Deduplication via `UNIQUE(id)` constraint

## Threat Model

```
┌─────────────────┐          ┌─────────────────┐
│   Browser       │          │   Cloudflare    │
│   (Client)      │   POST   │   Pages + D1    │
│                 │ ───────► │                 │
│  - Encrypts     │  { v,    │  - Validates    │
│  - Hashes ID    │    id,   │  - Stores       │
│                 │   enc }  │  - Dedupes      │
└─────────────────┘          └─────────────────┘
        │                            │
        │ Holds keys                 │ No keys
        │ Sees plaintext             │ Sees ciphertext only
        ▼                            ▼
   PII visible                  PII opaque
```

**Trust boundary:** All sensitive data is encrypted before leaving the browser. The server is a "dumb pipe" that stores and deduplicates ciphertext.

## Quick Start

### Bootstrap (Interactive)

```bash
npm install
npm run bootstrap
```

This will:
1. Create D1 database
2. Run schema migration
3. Configure secrets
4. Guide you through deployment

### Manual Setup

```bash
# 1. Create D1 database
wrangler d1 create intake-db

# 2. Update wrangler.toml with database_id

# 3. Run migration
wrangler d1 execute intake-db --file migrations/0001_create_intake_requests.sql --remote

# 4. Create Pages project
wrangler pages project create secure-intake

# 5. Set secrets
echo "https://your-app.com" | wrangler pages secret put ALLOWED_ORIGINS --project-name secure-intake
echo "$(openssl rand -hex 32)" | wrangler pages secret put INTAKE_IP_SALT --project-name secure-intake

# 6. Deploy
wrangler pages deploy --project-name secure-intake
```

### Local Development

```bash
# Create .dev.vars
cat > .dev.vars << EOF
ALLOWED_ORIGINS=http://localhost:3000,http://localhost:5173
INTAKE_IP_SALT=$(openssl rand -hex 32)
EOF

# Initialize local D1
npm run db:init

# Start dev server
npm run dev

# Run smoke test
npm run smoke
```

## API

### `POST /api/intake`

Submit an encrypted intake request.

**Request:**
```json
{
  "v": "loggie.intake.v1",
  "id": "abc123...64-char-hex...",
  "encrypted": "{\"x25519Ciphertext\":\"...\",\"kyberCiphertext\":\"...\",\"nonce\":\"...\",\"ciphertext\":\"...\"}"
}
```

**Success Response (201 Created):**
```json
{
  "ok": true,
  "id": "abc123...",
  "status": "created"
}
```

**Duplicate Response (200 OK):**
```json
{
  "ok": true,
  "id": "abc123...",
  "status": "duplicate"
}
```

**Error Response (4xx/5xx):**
```json
{
  "ok": false,
  "error": "Description of error"
}
```

### Response Codes

| Code | Meaning |
|------|---------|
| 201  | Created - new submission stored |
| 200  | Duplicate - ID already exists |
| 400  | Bad Request - validation failed |
| 401  | Unauthorized - HMAC missing/invalid (when `INTAKE_HMAC_SECRET` set) |
| 405  | Method Not Allowed - not POST |
| 413  | Payload Too Large |
| 415  | Unsupported Media Type - not JSON |
| 500  | Server Error |

## Environment Variables

### Required

| Variable | Description |
|----------|-------------|
| `ALLOWED_ORIGINS` | Comma-separated list of allowed CORS origins. Exact match only (no wildcards in URLs). |
| `INTAKE_IP_SALT` | Secret salt for hashing client IPs. Generate with `openssl rand -hex 32`. |

### Optional

| Variable | Default | Description |
|----------|---------|-------------|
| `MAX_BODY_BYTES` | `65536` (64KB) | Maximum request body size |
| `ALLOWED_VERSIONS` | `loggie.intake.v1` | Comma-separated list of allowed wire protocol versions |
| `INTAKE_HMAC_SECRET` | *(none)* | If set, requires `X-Intake-HMAC` header on all requests |

## HMAC Authentication (Recommended)

To prevent spam/abuse from arbitrary sources, enable HMAC verification:

```bash
# Generate and set secret
openssl rand -hex 32 | wrangler pages secret put INTAKE_HMAC_SECRET --project-name secure-intake
```

Client must compute and send:
```
X-Intake-HMAC: HMAC_SHA256(secret, id + "." + encrypted_json)
```

### HMAC Contract (Critical for Client Implementation)

1. **`encrypted` MUST be a string** when HMAC is enabled. Object payloads are rejected with `400 Bad Request`. This ensures deterministic byte-level matching between client and server.

2. **HMAC input uses normalized (lowercase) ID:**
   ```
   HMAC_SHA256(secret, lowercase(id) + "." + encrypted)
   ```
   Clients must HMAC the **lowercased** ID to match server-side normalization. If you HMAC the original casing, verification will fail.

### HMAC Error Responses

| Condition | Status | Error |
|-----------|--------|-------|
| Missing `X-Intake-HMAC` header | 401 | `Missing X-Intake-HMAC header` |
| Invalid HMAC signature | 401 | `Invalid HMAC` |
| `encrypted` is object (not string) | 400 | `When HMAC is enabled, 'encrypted' must be a string` |

### What HMAC Does

This does NOT:
- Decrypt anything
- Require user accounts
- Add complexity to the threat model

It DOES:
- Prevent random internet POSTs
- Require shared secret between client and server
- Block replay from different origins (if combined with CORS)

## D1 Schema

```sql
CREATE TABLE intake_requests (
  id TEXT PRIMARY KEY,           -- Client-provided BLAKE3 hash
  v TEXT NOT NULL,               -- Wire protocol version
  encrypted_json TEXT NOT NULL,  -- Encrypted payload (ciphertext)
  received_at TEXT NOT NULL,     -- ISO 8601 timestamp
  ip_hash TEXT,                  -- Hashed client IP
  ua TEXT,                       -- User agent
  ref TEXT                       -- Referrer
);
```

## CORS

- Only origins in `ALLOWED_ORIGINS` receive `Access-Control-Allow-Origin`
- All responses include `Vary: Origin`
- OPTIONS preflight handled automatically

## Validation

The server validates:
- HTTP method is POST
- Content-Type is application/json
- Body size within limits
- Required fields: `v`, `id`, `encrypted`
- `v` is in allowed versions list
- `id` is 64-character hex string (BLAKE3 hash format)

## Privacy

- Client IPs are hashed with a secret salt before storage
- Raw IPs are never stored or logged
- User agent and referrer stored for operational use (can be disabled by modifying handler)

## Security

See [SECURITY.md](./SECURITY.md) for:
- Detailed security model
- Rate limiting recommendations
- Cloudflare WAF configuration

## Cloudflare Deployment Checklist

When deploying to Cloudflare Pages:

1. **Create D1 database and get the `database_id`**
   ```bash
   wrangler d1 create intake-db
   ```

2. **Update `wrangler.toml`** with the correct `database_id`

3. **Set secrets at the Pages project scope:**
   ```bash
   wrangler pages secret put ALLOWED_ORIGINS --project-name secure-intake
   wrangler pages secret put INTAKE_IP_SALT --project-name secure-intake
   # Optional:
   wrangler pages secret put INTAKE_HMAC_SECRET --project-name secure-intake
   ```

4. **Verify D1 binding** is attached in the deployed environment. Pages sometimes needs a redeploy after binding changes:
   ```bash
   wrangler pages deploy --project-name secure-intake
   ```

5. **Run smoke test against production:**
   ```bash
   node scripts/smoke-post.mjs https://your-project.pages.dev
   # With HMAC:
   node scripts/smoke-post.mjs https://your-project.pages.dev --hmac-secret=YOUR_SECRET
   ```

## License

MIT
