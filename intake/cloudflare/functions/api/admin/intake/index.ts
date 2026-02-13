/**
 * GET /api/admin/intake - List intake submissions
 *
 * Returns metadata + ciphertext length. Never returns plaintext.
 * Supports cursor-based pagination via received_at + id.
 */

import { adminJson, type AdminEnv } from "../../../_shared/admin-auth";

interface Env extends AdminEnv {}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const url = new URL(context.request.url);
  const limit = Math.min(Math.max(parseInt(url.searchParams.get("limit") || "50", 10) || 50, 1), 200);
  const cursor = url.searchParams.get("cursor"); // format: "received_at|id"

  let query: string;
  let params: unknown[];

  if (cursor) {
    const [cursorAt, cursorId] = cursor.split("|");
    if (!cursorAt || !cursorId) {
      return adminJson({ ok: false, error: "Invalid cursor format" }, 400);
    }
    query = `
      SELECT id, v, received_at, length(encrypted_json) as ciphertext_len,
             ip_hash, ua, ref, status, processed_at, note
      FROM intake_requests
      WHERE (received_at < ? OR (received_at = ? AND id < ?))
      ORDER BY received_at DESC, id DESC
      LIMIT ?
    `;
    params = [cursorAt, cursorAt, cursorId, limit + 1];
  } else {
    query = `
      SELECT id, v, received_at, length(encrypted_json) as ciphertext_len,
             ip_hash, ua, ref, status, processed_at, note
      FROM intake_requests
      ORDER BY received_at DESC, id DESC
      LIMIT ?
    `;
    params = [limit + 1];
  }

  try {
    const result = await context.env.DB.prepare(query).bind(...params).all();
    const rows = result.results || [];

    let nextCursor: string | undefined;
    if (rows.length > limit) {
      const last = rows[limit - 1] as Record<string, unknown>;
      nextCursor = `${last.received_at}|${last.id}`;
      rows.length = limit; // trim extra row
    }

    return adminJson({
      ok: true,
      items: rows,
      ...(nextCursor ? { nextCursor } : {}),
    });
  } catch {
    return adminJson({ ok: false, error: "Database error" }, 500);
  }
};
