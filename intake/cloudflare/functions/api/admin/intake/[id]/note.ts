/**
 * POST /api/admin/intake/:id/note
 *
 * Updates the note on a submission. Writes metadata only.
 */

import { adminJson, logEvent, type AdminEnv } from "../../../../_shared/admin-auth";

interface Env extends AdminEnv {}

const ID_HEX_REGEX = /^[a-f0-9]{64}$/;

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const id = (context.params.id as string || "").toLowerCase();
  if (!ID_HEX_REGEX.test(id)) {
    return adminJson({ ok: false, error: "Invalid ID format" }, 400);
  }

  let note: string;
  try {
    const body = await context.request.json() as Record<string, unknown>;
    if (typeof body.note !== "string") {
      return adminJson({ ok: false, error: "note is required and must be a string" }, 400);
    }
    note = body.note.slice(0, 4096);
  } catch {
    return adminJson({ ok: false, error: "Invalid JSON body" }, 400);
  }

  const actor = (context.data as Record<string, unknown>).adminEmail as string || "unknown";

  try {
    const result = await context.env.DB.prepare(
      `UPDATE intake_requests SET note = ? WHERE id = ?`
    ).bind(note, id).run();

    if (!result.meta.changes) {
      return adminJson({ ok: false, error: "Not found" }, 404);
    }

    await logEvent(context.env.DB, id, "note-updated", actor);

    return adminJson({ ok: true });
  } catch {
    return adminJson({ ok: false, error: "Database error" }, 500);
  }
};
