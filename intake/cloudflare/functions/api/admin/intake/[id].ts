/**
 * GET /api/admin/intake/:id - Fetch a single intake submission
 *
 * Returns ciphertext + metadata. Never returns plaintext.
 * Updates viewed_at on first access.
 */

import { adminJson, logEvent, type AdminEnv } from "../../../_shared/admin-auth";

interface Env extends AdminEnv {}

const ID_HEX_REGEX = /^[a-f0-9]{64}$/;

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const id = (context.params.id as string || "").toLowerCase();

  if (!ID_HEX_REGEX.test(id)) {
    return adminJson({ ok: false, error: "Invalid ID format" }, 400);
  }

  try {
    const row = await context.env.DB.prepare(`
      SELECT id, v, received_at, encrypted_json, ip_hash, ua, ref,
             status, processed_at, note, viewed_at
      FROM intake_requests
      WHERE id = ?
    `).bind(id).first();

    if (!row) {
      return adminJson({ ok: false, error: "Not found" }, 404);
    }

    // Update viewed_at on first view
    const r = row as Record<string, unknown>;
    if (!r.viewed_at) {
      const actor = (context.data as Record<string, unknown>).adminEmail as string || "unknown";
      context.waitUntil(
        Promise.all([
          context.env.DB.prepare(
            `UPDATE intake_requests SET viewed_at = datetime('now') WHERE id = ?`
          ).bind(id).run(),
          logEvent(context.env.DB, id, "viewed", actor),
        ])
      );
    }

    return adminJson({
      ok: true,
      item: {
        id: r.id,
        v: r.v,
        received_at: r.received_at,
        encrypted_json: r.encrypted_json,
        ip_hash: r.ip_hash,
        ua: r.ua,
        ref: r.ref,
        status: r.status || "new",
        processed_at: r.processed_at,
        note: r.note,
        viewed_at: r.viewed_at,
      },
    });
  } catch {
    return adminJson({ ok: false, error: "Database error" }, 500);
  }
};
