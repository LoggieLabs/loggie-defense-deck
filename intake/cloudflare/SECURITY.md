# Security Policy

## Core Security Model

### Ciphertext-Only Boundary

This server implements a **ciphertext-only storage boundary**:

1. **No plaintext storage** - All submitted data is pre-encrypted by the client
2. **No decryption capability** - Server has no access to private keys
3. **No plaintext logging** - Server cannot log what it cannot read
4. **Verbatim storage** - Encrypted payload stored exactly as received

### Trust Model

| Component | Trust Level | Has Access To |
|-----------|-------------|---------------|
| Client browser | Full | Plaintext, encryption keys |
| This server | Minimal | Ciphertext, metadata only |
| D1 database | Minimal | Ciphertext, metadata only |
| Cloudflare | Infrastructure | Encrypted traffic in transit |

### What the Server Stores

```
┌─────────────────────────────────────────────────────────────┐
│ intake_requests table                                       │
├─────────────────────────────────────────────────────────────┤
│ id              │ Client-provided hash (not PII)            │
│ v               │ Protocol version (not PII)                │
│ encrypted_json  │ CIPHERTEXT ONLY - opaque to server        │
│ received_at     │ Timestamp (operational)                   │
│ ip_hash         │ Hashed IP (privacy-preserving)            │
│ ua              │ User agent (operational)                  │
│ ref             │ Referrer (operational)                    │
└─────────────────────────────────────────────────────────────┘
```

## Admin Security

### Authentication Layers

1. **Cloudflare Access (SSO)**: All `/admin/*` and `/api/admin/*` routes are protected by Cloudflare Access. Users must authenticate via SSO before reaching any admin content.

2. **Defense-in-depth header check**: Admin API endpoints verify the `cf-access-authenticated-user-email` header and check against the `ADMIN_EMAILS` allowlist. Even if Access is misconfigured, unauthorized users cannot access admin APIs.

### Local-Only Decryption

The admin UI decrypts submissions **entirely in the browser**:

- The operator loads their identity key file from disk via the browser File API
- The key is stored **only in JavaScript memory** (never localStorage, sessionStorage, or IndexedDB)
- Decryption uses tweetnacl (X25519 + NaCl secretbox) and optionally kyber-crystals (ML-KEM-768)
- Decrypted plaintext exists only in browser memory and is never sent to any server
- The key is cleared when the page closes or via the "Clear key" button

### Notifications

When `NOTIFY_WEBHOOK_URL` is configured, new submissions trigger a webhook with **metadata only** (`{id, v, received_at}`). Zero plaintext is included. Webhook failure never fails the intake.

### Admin Response Headers

All admin API responses include `Cache-Control: no-store`.

### Audit Trail

Admin actions (view, mark-processed, note updates) are logged to the `intake_events` table with actor email and timestamp.

## CORS Allowlist

The server enforces a strict CORS allowlist:

- Only origins explicitly listed in `ALLOWED_ORIGINS` receive CORS headers
- Requests from unlisted origins will fail browser CORS checks
- Use specific origins in production (avoid `*`)

**Recommended configuration:**
```
ALLOWED_ORIGINS=https://your-app.com,https://www.your-app.com
```

## Rate Limiting

This server does **not** implement rate limiting directly. Use Cloudflare's built-in protections:

### Recommended Cloudflare WAF Rules

1. **Rate Limiting Rule** (Cloudflare Dashboard → Security → WAF → Rate limiting rules)
   ```
   When: URI Path equals "/api/intake"
   And: Request Method equals "POST"
   Rate: 10 requests per minute per IP
   Action: Block for 1 hour
   ```

2. **Bot Protection** (if on Pro+ plan)
   - Enable Bot Fight Mode
   - Challenge suspected bots

3. **Geographic Restrictions** (if applicable)
   - Block countries where you don't operate

### Client-Side Rate Limiting

The companion client (`@omnituum/secure-intake-client`) implements client-side rate limiting as defense-in-depth. This is **not** a security boundary - always enforce server-side limits.

## Input Validation

The server validates all inputs before storage:

| Field | Validation |
|-------|------------|
| `v` | Must be in `ALLOWED_VERSIONS` list |
| `id` | Must be 64-character hex string (normalized to lowercase) |
| `encrypted` | Must be string or object, within size limit |
| Body size | True byte-length enforcement via `arrayBuffer()` (not `Content-Length`) |
| User-Agent | Clamped to 512 bytes |
| Referer | Clamped to 1024 bytes |

**ID Normalization:** IDs are normalized to lowercase before storage and comparison. This prevents `ABC...` vs `abc...` bypass of `UNIQUE(id)` constraint.

Invalid requests are rejected with 400 status before any database write.

## HMAC Authentication

When `INTAKE_HMAC_SECRET` is configured, the server requires:

```
X-Intake-HMAC: HMAC_SHA256(secret, id + "." + encrypted_json)
```

This provides:
- **Spam prevention** - Random POSTs rejected
- **Origin binding** - Only clients with the shared secret can submit
- **No decryption** - Server still cannot read content

HMAC verification uses constant-time comparison to prevent timing attacks.

**Important:** HMAC does NOT replace encryption. It's an additional layer to prevent abuse.

## IP Privacy

Client IPs are **never** stored in plaintext:

1. IP is hashed with `INTAKE_IP_SALT` using SHA-256
2. Only the hash is stored
3. The salt must be kept secret
4. Without the salt, hashes cannot be reversed to IPs

**Important:** Rotate `INTAKE_IP_SALT` periodically if IP correlation over time is a concern.

## Error Handling

Error responses are designed to avoid information leakage:

- Generic error messages (no stack traces)
- No internal state exposure
- Database errors return "Database error" only
- Validation errors indicate which field failed (safe for debugging)

## Supported Versions

| Version | Supported |
|---------|-----------|
| 0.1.x   | Yes       |

## Reporting a Vulnerability

If you discover a security vulnerability:

1. **Do not** open a public GitHub issue
2. Email: security@omnituum.com
3. Include:
   - Description of the vulnerability
   - Steps to reproduce
   - Potential impact

We aim to acknowledge reports within 48 hours.

## Incident Response

In case of a security incident:

1. The ciphertext-only design limits exposure - server compromise does not expose plaintext PII
2. Rotate `INTAKE_IP_SALT` to invalidate IP hashes
3. Review Cloudflare access logs for suspicious activity
4. Notify affected parties per applicable regulations

## Compliance Notes

This architecture supports compliance with:

- **GDPR**: Minimization via encryption, IP hashing
- **CCPA**: No plaintext PII storage
- **HIPAA**: Ciphertext-only storage (verify with counsel)

**Note:** Compliance depends on your overall system, not just this component. Consult legal counsel for your specific requirements.
