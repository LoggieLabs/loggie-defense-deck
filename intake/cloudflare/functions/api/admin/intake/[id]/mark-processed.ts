/**
 * POST /api/admin/intake/:id/mark-processed
 *
 * Marks a submission as processed. Writes metadata only.
 */

import { adminJson, logEvent, type AdminEnv } from "../../../../_shared/admin-auth";

interface Env extends AdminEnv {}

const ID_HEX_REGEX = /^[a-f0-9]{64}$/;

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const id = (context.params.id as string || "").toLowerCase();
  if (!ID_HEX_REGEX.test(id)) {
    return adminJson({ ok: false, error: "Invalid ID format" }, 400);
  }

  let note: string | null = null;
  try {
    const body = await context.request.json() as Record<string, unknown>;
    if (body.note !== undefined) {
      if (typeof body.note !== "string") {
        return adminJson({ ok: false, error: "note must be a string" }, 400);
      }
      note = body.note.slice(0, 4096);
    }
  } catch {
    // Empty body is ok - note is optional
  }

  const actor = (context.data as Record<string, unknown>).adminEmail as string || "unknown";

  try {
    const result = await context.env.DB.prepare(`
      UPDATE intake_requests
      SET status = 'processed', processed_at = datetime('now')${note !== null ? ", note = ?" : ""}
      WHERE id = ?
    `).bind(...(note !== null ? [note, id] : [id])).run();

    if (!result.meta.changes) {
      return adminJson({ ok: false, error: "Not found" }, 404);
    }

    await logEvent(context.env.DB, id, "mark-processed", actor, note ? { note } : undefined);

    return adminJson({ ok: true });
  } catch {
    return adminJson({ ok: false, error: "Database error" }, 500);
  }
};
