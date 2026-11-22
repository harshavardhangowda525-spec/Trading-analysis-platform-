import { fail, json, requireUser } from "@/lib/api";
import { db } from "@/lib/db";

const TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const MAGIC: Record<string, (b: Buffer) => boolean> = {
  "image/png": (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  "image/jpeg": (b) => b[0] === 0xff && b[1] === 0xd8,
  "image/webp": (b) => b.subarray(0, 4).toString() === "RIFF" && b.subarray(8, 12).toString() === "WEBP",
};

/** GET ?id= → the image bytes (owner only). */
export async function GET(req: Request) {
  const a = await requireUser();
  if ("res" in a) return a.res;
  const id = new URL(req.url).searchParams.get("id") ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(id)) return fail("Invalid id");
  const [r] = await db()`select encode(data, 'base64') as b64, mime_type from journal_attachments where id = ${id} and user_id = ${a.user.userId}`;
  if (!r) return fail("Not found", 404);
  return new Response(Buffer.from(r.b64, "base64"), { headers: { "Content-Type": r.mime_type, "Cache-Control": "private, max-age=3600", "X-Content-Type-Options": "nosniff" } });
}

/** POST multipart (file, tradeKey) → stores the screenshot in Postgres (≤ 5 MB). */
export async function POST(req: Request) {
  const a = await requireUser();
  if ("res" in a) return a.res;
  const uid = a.user.userId;
  const fd = await req.formData().catch(() => null);
  const file = fd?.get("file");
  const tradeKey = String(fd?.get("tradeKey") ?? "");
  if (!(file instanceof File) || !tradeKey) return fail("file and tradeKey are required");
  if (!TYPES.has(file.type)) return fail("Only PNG, JPEG or WebP images are allowed");
  if (file.size > 5 * 1024 * 1024) return fail("Image must be 5 MB or smaller");
  const buf = Buffer.from(await file.arrayBuffer());
  if (!MAGIC[file.type](buf)) return fail("File content does not match its image type");
  const q = db();
  const [trade] = await q`select id from closed_trades where user_id = ${uid} and trade_key = ${tradeKey} limit 1`;
  if (!trade) return fail("Trade not found", 404);
  const [entry] = await q`insert into journal_entries (user_id, trade_key) values (${uid}, ${tradeKey})
                          on conflict (user_id, trade_key) do update set updated_at = journal_entries.updated_at returning id`;
  const [att] = await q`insert into journal_attachments (user_id, journal_entry_id, data, mime_type)
                        values (${uid}, ${entry.id}, decode(${buf.toString("base64")}, 'base64'), ${file.type}) returning id`;
  return json({ path: att.id, url: `/api/journal/attachments?id=${att.id}` });
}
