/**
 * Admin authentication and response utilities.
 *
 * Defense-in-depth: even though Cloudflare Access protects /admin/*,
 * we also verify Access identity headers in code.
 */

export interface AdminEnv {
  DB: D1Database;
  ADMIN_EMAILS?: string;
  ADMIN_UI_ORIGIN?: string; // e.g. "https://admin.omnituum.com"
}

type AuthResult =
  | { ok: true; email: string }
  | { ok: false; response: Response };

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store",
  "Content-Type": "application/json",
} as const;

/**
 * Verify the request came through Cloudflare Access and
 * the authenticated user is in the ADMIN_EMAILS allowlist.
 */
export function verifyAdmin(request: Request, env: AdminEnv): AuthResult {
  // Headers.get() is case-insensitive per Fetch spec — handles any casing
  // Cloudflare sends, including Cf-Access-Authenticated-User-Email.
  const email = request.headers.get("cf-access-authenticated-user-email");

  if (!email) {
    return {
      ok: false,
      response: adminJson({ ok: false, error: "unauthorized" }, 401),
    };
  }

  // If ADMIN_EMAILS is set, enforce allowlist
  if (env.ADMIN_EMAILS) {
    const allowed = new Set(
      env.ADMIN_EMAILS.split(",").map((e) => e.trim().toLowerCase()).filter(Boolean)
    );
    if (!allowed.has(email.toLowerCase())) {
      return {
        ok: false,
        response: adminJson({ ok: false, error: "unauthorized" }, 403),
      };
    }
  }

  return { ok: true, email };
}

/**
 * JSON response with Cache-Control: no-store.
 */
export function adminJson(data: object, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: NO_STORE_HEADERS,
  });
}

/**
 * Return CORS headers for admin API responses.
 * Only reflects the configured ADMIN_UI_ORIGIN — never wildcards.
 */
export function adminCorsHeaders(
  request: Request,
  env: AdminEnv
): Record<string, string> {
  const origin = request.headers.get("Origin");
  const headers: Record<string, string> = { Vary: "Origin" };

  if (origin && env.ADMIN_UI_ORIGIN && origin === env.ADMIN_UI_ORIGIN) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Access-Control-Allow-Credentials"] = "true";
  }

  return headers;
}

/**
 * Handle CORS preflight (OPTIONS) for admin API routes.
 * Preflight does not carry cookies, so no auth check needed.
 */
export function adminPreflight(
  request: Request,
  env: AdminEnv
): Response {
  return new Response(null, {
    status: 204,
    headers: {
      ...adminCorsHeaders(request, env),
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Max-Age": "86400",
    },
  });
}

/**
 * Log an admin event to the audit trail.
 */
export async function logEvent(
  db: D1Database,
  intakeId: string,
  event: string,
  actor: string,
  meta?: Record<string, unknown>
): Promise<void> {
  try {
    await db.prepare(
      `INSERT INTO intake_events (intake_id, event, actor, meta) VALUES (?, ?, ?, ?)`
    ).bind(
      intakeId,
      event,
      actor,
      meta ? JSON.stringify(meta) : null
    ).run();
  } catch {
    // Best-effort audit logging - do not fail the request
  }
}
