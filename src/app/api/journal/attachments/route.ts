import { randomUUID } from "node:crypto";
import { fail, json, requireUser } from "@/lib/api";

const TYPES: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };

export async function POST(req: Request) {
  const a = await requireUser();
  if ("res" in a) return a.res;
  const fd = await req.formData().catch(() => null);
  const file = fd?.get("file");
  const tradeKey = String(fd?.get("tradeKey") ?? "");
  if (!(file instanceof File) || !tradeKey) return fail("file and tradeKey are required");
  if (!TYPES[file.type]) return fail("Only PNG, JPEG or WebP images are allowed");
  if (file.size > 10 * 1024 * 1024) return fail("Image must be 10 MB or smaller");

  const { data: entry } = await a.sb.from("journal_entries").select("id").eq("trade_key", tradeKey).maybeSingle();
  let entryId = entry?.id as string | undefined;
  if (!entryId) {
    const { data: trade } = await a.sb.from("closed_trades").select("id").eq("trade_key", tradeKey).limit(1).maybeSingle();
    if (!trade) return fail("Trade not found", 404);
    const { data: created, error } = await a.sb.from("journal_entries").insert({ user_id: a.user.id, trade_key: tradeKey }).select("id").single();
    if (error) return fail(error.message, 500);
    entryId = created.id;
  }
  const path = `${a.user.id}/${entryId}/${randomUUID()}.${TYPES[file.type]}`;
  const { error: upErr } = await a.sb.storage.from("journal-attachments").upload(path, file, { contentType: file.type, upsert: false });
  if (upErr) return fail(upErr.message, 500);
  await a.sb.from("journal_attachments").insert({ user_id: a.user.id, journal_entry_id: entryId, storage_path: path, mime_type: file.type });
  const { data: signed } = await a.sb.storage.from("journal-attachments").createSignedUrl(path, 3600);
  return json({ path, url: signed?.signedUrl ?? null });
}
