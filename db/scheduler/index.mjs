// TRADEOS scheduler (Neon Function). Invoked by Neon schedule triggers:
//   /sync → calls the protected daily-collection endpoint after market close
//   /warm → keeps the Render web service awake during trading hours
const APP = process.env.APP_URL;
const SECRET = process.env.CRON_SECRET;

async function call(path, headers = {}) {
  let last = "";
  for (let i = 0; i < 6; i++) {
    try {
      const r = await fetch(APP + path, { headers, signal: AbortSignal.timeout(90_000) });
      last = `${r.status} ${(await r.text()).slice(0, 300)}`;
      if (r.status < 500) return last;
    } catch (e) {
      last = String(e);
    }
    await new Promise((res) => setTimeout(res, 15_000)); // free instances take up to ~60s to wake
  }
  return `failed after retries: ${last}`;
}

export default {
  async fetch(request) {
    const path = new URL(request.url).pathname;
    if (!APP) return new Response("APP_URL not set", { status: 500 });
    if (path.endsWith("/sync")) {
      if (!SECRET) return new Response("CRON_SECRET not set", { status: 500 });
      const out = await call("/api/cron/sync", { Authorization: `Bearer ${SECRET}` });
      console.log("sync", out);
      return new Response(out);
    }
    const out = await call("/api/health");
    return new Response(`warm ${out}`);
  },
};
