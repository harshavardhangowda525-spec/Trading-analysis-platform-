import { cookies } from "next/headers";
import { json } from "@/lib/api";
import { destroySession } from "@/lib/auth/session";
import { DEMO_COOKIE } from "@/lib/data/workspace";

export async function POST() {
  await destroySession();
  (await cookies()).delete(DEMO_COOKIE);
  return json({ ok: true });
}
