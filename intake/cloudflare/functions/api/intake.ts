/**
 * POST /api/intake - Encrypted intake submission endpoint
 *
 * Core invariant: Server stores ciphertext ONLY.
 * - Never decrypts
 * - Never recomputes ID
 * - Never logs plaintext (cannot - no key)
 */

interface Env {
  DB: D1Database;
  ALLOWED_ORIGINS?: string;
  INTAKE_IP_SALT?: string;
  INTAKE_HMAC_SECRET?: string; // Optional: enables HMAC verification
  MAX_BODY_BYTES?: string;
  ALLOWED_VERSIONS?: string;
  NOTIFY_WEBHOOK_URL?: string; // Optional: metadata-only notification webhook
}

interface IntakeEnvelope {
  v: string;
  id: string;
  encrypted: string | object;
}

// ═══════════════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════

const DEFAULT_MAX_BODY_BYTES = 65536; // 64KB
const DEFAULT_ALLOWED_VERSIONS = ["loggie.intake.v1"];
const ID_HEX_REGEX = /^[a-f0-9]{64}$/; // 64-char lowercase hex (BLAKE3)
const MAX_UA_BYTES = 512;
const MAX_REF_BYTES = 1024;

// ═══════════════════════════════════════════════════════════════════════════
// CORS
// ═══════════════════════════════════════════════════════════════════════════

function getAllowedOrigins(env: Env): Set<string> {
  if (!env.ALLOWED_ORIGINS) return new Set();
  return new Set(
    env.ALLOWED_ORIGINS.split(",")
      .map((o) => o.trim())
      .filter(Boolean)
  );
}

function isOriginAllowed(origin: string | null, env: Env): boolean {
  if (!origin) return false;
  const allowed = getAllowedOrigins(env);
  // Exact match only - no patterns, no includes
  return allowed.has(origin) || allowed.has("*");
}

function corsHeaders(origin: string | null, env: Env): HeadersInit {
  const headers: HeadersInit = {
    Vary: "Origin",
  };
  if (origin && isOriginAllowed(origin, env)) {
    headers["Access-Control-Allow-Origin"] = origin;
  }
  return headers;
}

function handleOptions(request: Request, env: Env): Response {
  const origin = request.headers.get("Origin");
  const headers: HeadersInit = {
    ...corsHeaders(origin, env),
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Intake-HMAC",
    "Access-Control-Max-Age": "86400",
  };
  return new Response(null, { status: 204, headers });
}

// ═══════════════════════════════════════════════════════════════════════════
// CRYPTO HELPERS
// ═══════════════════════════════════════════════════════════════════════════

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function hashIP(
  ip: string | null,
  salt: string | undefined
): Promise<string | null> {
  if (!ip || !salt) return null;
  const encoder = new TextEncoder();
  // Delimiter prevents ambiguity (salt="abc", ip="def" vs salt="ab", ip="cdef")
  const data = encoder.encode(salt + ":" + ip);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return bytesToHex(new Uint8Array(hashBuffer));
}

async function verifyHMAC(
  secret: string,
  id: string,
  encryptedJson: string,
  providedHmac: string
): Promise<boolean> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const message = encoder.encode(id + "." + encryptedJson);
  const signature = await crypto.subtle.sign("HMAC", key, message);
  const expectedHmac = bytesToHex(new Uint8Array(signature));
  // Constant-time comparison
  if (expectedHmac.length !== providedHmac.length) return false;
  let result = 0;
  for (let i = 0; i < expectedHmac.length; i++) {
    result |= expectedHmac.charCodeAt(i) ^ providedHmac.charCodeAt(i);
  }
  return result === 0;
}

// ═══════════════════════════════════════════════════════════════════════════
// METADATA SANITIZATION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Strip query string (and fragment) from a Referer URL.
 * Prevents storing tokens, session IDs, or PII that may appear in URL params.
 */
function stripRefQuery(ref: string): string {
  try {
    const url = new URL(ref);
    return url.origin + url.pathname;
  } catch {
    // Not a valid URL — strip from ? or # onwards as fallback
    const cut = ref.search(/[?#]/);
    return cut >= 0 ? ref.slice(0, cut) : ref;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// VALIDATION
// ═══════════════════════════════════════════════════════════════════════════

function getAllowedVersions(env: Env): Set<string> {
  if (!env.ALLOWED_VERSIONS) return new Set(DEFAULT_ALLOWED_VERSIONS);
  return new Set(
    env.ALLOWED_VERSIONS.split(",")
      .map((v) => v.trim())
      .filter(Boolean)
  );
}

function validateEnvelope(
  body: unknown,
  env: Env
): { ok: true; envelope: IntakeEnvelope } | { ok: false; error: string } {
  if (!body || typeof body !== "object") {
    return { ok: false, error: "Invalid request body" };
  }

  const obj = body as Record<string, unknown>;

  // Required fields
  if (typeof obj.v !== "string" || !obj.v) {
    return { ok: false, error: "Missing or invalid 'v' field" };
  }
  if (typeof obj.id !== "string" || !obj.id) {
    return { ok: false, error: "Missing or invalid 'id' field" };
  }
  if (obj.encrypted === undefined || obj.encrypted === null) {
    return { ok: false, error: "Missing 'encrypted' field" };
  }

  // Version check
  const allowedVersions = getAllowedVersions(env);
  if (!allowedVersions.has(obj.v)) {
    return { ok: false, error: "Unsupported version" };
  }

  // Normalize ID to lowercase before validation
  const normalizedId = obj.id.toLowerCase();

  // ID format check (64-char lowercase hex)
  if (!ID_HEX_REGEX.test(normalizedId)) {
    return { ok: false, error: "Invalid 'id' format" };
  }

  // Encrypted payload - accept string or object
  const encrypted = obj.encrypted;
  if (typeof encrypted !== "string" && typeof encrypted !== "object") {
    return { ok: false, error: "Invalid 'encrypted' field type" };
  }

  return {
    ok: true,
    envelope: {
      v: obj.v,
      id: normalizedId, // Store normalized lowercase
      encrypted,
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// RESPONSE HELPERS
// ═══════════════════════════════════════════════════════════════════════════

function jsonResponse(
  data: object,
  status: number,
  origin: string | null,
  env: Env
): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders(origin, env),
    },
  });
}

function errorResponse(
  error: string,
  status: number,
  origin: string | null,
  env: Env
): Response {
  return jsonResponse({ ok: false, error }, status, origin, env);
}

// ═══════════════════════════════════════════════════════════════════════════
// NOTIFICATION (metadata only)
// ═══════════════════════════════════════════════════════════════════════════

async function notifyWebhook(
  url: string,
  payload: { id: string; v: string; received_at: string }
): Promise<void> {
  try {
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: `New intake submission: ${payload.id.slice(0, 12)}…`,
        embeds: [{
          title: "Secure Intake Submission",
          fields: [
            { name: "ID", value: payload.id },
            { name: "Version", value: payload.v },
            { name: "Received", value: payload.received_at },
          ],
        }],
        // Discord-compatible format
        content: `New intake submission \`${payload.id.slice(0, 12)}…\` (${payload.v}) at ${payload.received_at}`,
      }),
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    // Best-effort - never fail the intake on webhook error
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN HANDLER
// ═══════════════════════════════════════════════════════════════════════════

export const onRequest: PagesFunction<Env> = async (context) => {
  const { request, env } = context;
  const origin = request.headers.get("Origin");

  // Handle CORS preflight
  if (request.method === "OPTIONS") {
    return handleOptions(request, env);
  }

  // Only allow POST
  if (request.method !== "POST") {
    return errorResponse("Method not allowed", 405, origin, env);
  }

  // Check content-type
  const contentType = request.headers.get("Content-Type") || "";
  if (!contentType.includes("application/json")) {
    return errorResponse("Content-Type must be application/json", 415, origin, env);
  }

  const maxBytes =
    parseInt(env.MAX_BODY_BYTES || "", 10) || DEFAULT_MAX_BODY_BYTES;

  // True byte-length enforcement via arrayBuffer
  // Do NOT trust Content-Length header alone
  let rawBytes: ArrayBuffer;
  try {
    rawBytes = await request.arrayBuffer();
  } catch {
    return errorResponse("Failed to read request body", 400, origin, env);
  }

  if (rawBytes.byteLength > maxBytes) {
    return errorResponse(
      `Request body too large (max ${maxBytes} bytes)`,
      413,
      origin,
      env
    );
  }

  // Parse body
  let body: unknown;
  try {
    const decoder = new TextDecoder();
    const text = decoder.decode(rawBytes);
    body = JSON.parse(text);
  } catch {
    return errorResponse("Invalid JSON", 400, origin, env);
  }

  // Validate envelope
  const validation = validateEnvelope(body, env);
  if (!validation.ok) {
    return errorResponse(validation.error, 400, origin, env);
  }

  const { envelope } = validation;

  // Serialize encrypted payload (for storage/size check)
  // When HMAC is enabled, we require string (validated below)
  const encryptedJson =
    typeof envelope.encrypted === "string"
      ? envelope.encrypted
      : JSON.stringify(envelope.encrypted);

  // Check encrypted payload size BEFORE HMAC verification
  // Avoids spending HMAC CPU on oversized garbage
  const encryptedBytes = new TextEncoder().encode(encryptedJson);
  if (encryptedBytes.byteLength > maxBytes) {
    return errorResponse("Encrypted payload too large", 413, origin, env);
  }

  // HMAC verification (if secret configured)
  // IMPORTANT: When HMAC is enabled, encrypted MUST be a string to ensure
  // deterministic canonicalization. Re-serializing objects is non-deterministic.
  if (env.INTAKE_HMAC_SECRET) {
    if (typeof envelope.encrypted !== "string") {
      return errorResponse(
        "When HMAC is enabled, 'encrypted' must be a string",
        400,
        origin,
        env
      );
    }
    const providedHmac = request.headers.get("X-Intake-HMAC");
    if (!providedHmac) {
      return errorResponse("Missing X-Intake-HMAC header", 401, origin, env);
    }
    const valid = await verifyHMAC(
      env.INTAKE_HMAC_SECRET,
      envelope.id,
      envelope.encrypted,
      providedHmac.toLowerCase()
    );
    if (!valid) {
      return errorResponse("Invalid HMAC", 401, origin, env);
    }
  }

  // Hash client IP
  const clientIP = request.headers.get("CF-Connecting-IP");
  const ipHash = await hashIP(clientIP, env.INTAKE_IP_SALT);

  // Optional metadata (clamped to prevent abuse)
  const ua = request.headers.get("User-Agent")?.slice(0, MAX_UA_BYTES) || null;

  // Strip query string from Referer before storing — prevents accidental
  // persistence of tokens, session IDs, or PII in URL parameters.
  const rawRef = request.headers.get("Referer");
  const ref = rawRef ? stripRefQuery(rawRef).slice(0, MAX_REF_BYTES) : null;

  // Insert to D1
  try {
    await env.DB.prepare(
      `INSERT INTO intake_requests (id, v, encrypted_json, ip_hash, ua, ref)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
      .bind(envelope.id, envelope.v, encryptedJson, ipHash, ua, ref)
      .run();

    // Best-effort notification (metadata only - no plaintext)
    if (env.NOTIFY_WEBHOOK_URL) {
      const receivedAt = new Date().toISOString();
      context.waitUntil(
        notifyWebhook(env.NOTIFY_WEBHOOK_URL, {
          id: envelope.id,
          v: envelope.v,
          received_at: receivedAt,
        })
      );
    }

    return jsonResponse(
      { ok: true, id: envelope.id, status: "created" },
      201,
      origin,
      env
    );
  } catch (err: unknown) {
    // Check for unique constraint violation (duplicate ID)
    const message = err instanceof Error ? err.message : "";
    if (
      message.includes("UNIQUE constraint failed") ||
      message.includes("SQLITE_CONSTRAINT")
    ) {
      return jsonResponse(
        { ok: true, id: envelope.id, status: "duplicate" },
        200,
        origin,
        env
      );
    }

    // Generic error - do not leak internals
    return errorResponse("Database error", 500, origin, env);
  }
};
