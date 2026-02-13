/**
 * Admin API middleware - CORS + Cloudflare Access enforcement.
 *
 * Applies to all /api/admin/* routes.
 * 1. Handles CORS preflight (OPTIONS) — no auth needed for preflight.
 * 2. Verifies cf-access-authenticated-user-email header.
 * 3. Checks ADMIN_EMAILS allowlist for defense-in-depth.
 * 4. Adds CORS + Cache-Control headers to all responses.
 */

import {
  verifyAdmin,
  adminPreflight,
  adminCorsHeaders,
  type AdminEnv,
} from "../../_shared/admin-auth";

interface Env extends AdminEnv {}

export const onRequest: PagesFunction<Env> = async (context) => {
  // CORS preflight — must respond before auth check (no cookies on OPTIONS)
  if (context.request.method === "OPTIONS") {
    return adminPreflight(context.request, context.env);
  }

  const auth = verifyAdmin(context.request, context.env);
  if (!auth.ok) {
    // Add CORS headers even to auth failures so the browser can read the status
    const corsH = adminCorsHeaders(context.request, context.env);
    for (const [k, v] of Object.entries(corsH)) {
      auth.response.headers.set(k, v);
    }
    return auth.response;
  }

  // Pass verified email downstream via header
  context.data.adminEmail = auth.email;

  const response = await context.next();

  // Enforce no-store on all admin responses
  response.headers.set("Cache-Control", "no-store");

  // Add CORS headers
  const corsHeaders = adminCorsHeaders(context.request, context.env);
  for (const [k, v] of Object.entries(corsHeaders)) {
    response.headers.set(k, v);
  }

  return response;
};
