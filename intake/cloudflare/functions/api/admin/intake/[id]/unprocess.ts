/**
 * POST /api/admin/intake/:id/unprocess
 *
 * Reverts a submission back to "new" status. Writes metadata only.
 */

import { adminJson, logEvent, type AdminEnv } from "../../../../_shared/admin-auth";

interface Env extends AdminEnv {}

const ID_HEX_REGEX = /^[a-f0-9]{64}$/;

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const id = (context.params.id as string || "").toLowerCase();
  if (!ID_HEX_REGEX.test(id)) {
    return adminJson({ ok: false, error: "Invalid ID format" }, 400);
  }

  const actor = (context.data as Record<string, unknown>).adminEmail as string || "unknown";

  try {
    const result = await context.env.DB.prepare(
      `UPDATE intake_requests SET status = 'new', processed_at = NULL WHERE id = ?`
    ).bind(id).run();

    if (!result.meta.changes) {
      return adminJson({ ok: false, error: "Not found" }, 404);
    }

    await logEvent(context.env.DB, id, "unprocessed", actor);

    return adminJson({ ok: true });
  } catch {
    return adminJson({ ok: false, error: "Database error" }, 500);
  }
};
