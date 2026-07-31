/**
 * Feedback intake. Receives a report from the app and mails it on.
 *
 * The app used to hand this job to `mailto:`, which silently did nothing
 * for anyone without a mail client configured. This endpoint exists so the
 * user never leaves the app and never has to own working mail for their
 * report to reach anyone.
 *
 * Deployed as a Vercel Function alongside the static build. It is public
 * and unauthenticated by necessity — the whole point is that a stranger
 * with a complaint can use it — so it assumes it will be found and abused,
 * and holds the line with a honeypot, a size cap, and a per-IP rate limit
 * rather than with a secret.
 */

const TO = "joeyefarah+skymap@gmail.com";
// Resend's shared sender: no DNS to configure, works the moment the key
// exists. Swap for an address on a verified domain if SkyMap ever has one.
const FROM = "SkyMap Feedback <onboarding@resend.dev>";

const MAX_MESSAGE = 4000;
const RATE_LIMIT = 5; // reports per IP per window
const RATE_WINDOW_MS = 10 * 60 * 1000;

/** The iOS build is served from capacitor://localhost, so its requests are
 * cross-origin to this function and die at the preflight without these.
 * The same origin quirk is why the app needs a native geolocation shim. */
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

/** Per-instance, not shared — Fluid Compute reuses instances, so this catches
 * the repeat-submit case it's meant to catch, while a distributed flood would
 * need a real store. Worth having anyway: it's free and it stops the
 * accidental double-tap as well as the bored one. */
const recent = new Map<string, number[]>();

function rateLimited(ip: string): boolean {
  const now = Date.now();
  const hits = (recent.get(ip) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
  hits.push(now);
  recent.set(ip, hits);
  return hits.length > RATE_LIMIT;
}

export async function POST(req: Request): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Malformed request." }, 400);
  }

  // A hidden field a person never sees and a bot fills in. Accepted, not
  // rejected: telling a bot it failed just teaches it to try again.
  if (typeof body.website === "string" && body.website.trim()) return json({ ok: true }, 202);

  const message = typeof body.message === "string" ? body.message.trim() : "";
  if (!message) return json({ error: "A message is required." }, 400);
  if (message.length > MAX_MESSAGE) return json({ error: "That message is too long." }, 413);

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "unknown";
  if (rateLimited(ip)) return json({ error: "Too many reports just now — try again shortly." }, 429);

  const key = process.env.RESEND_API_KEY;
  if (!key) {
    // Loud on the server, honest to the client: the app falls back to
    // mailto: on a failure, so the report still has somewhere to go.
    console.error("RESEND_API_KEY is not set — feedback cannot be delivered");
    return json({ error: "Feedback delivery isn't configured." }, 503);
  }

  const email = typeof body.email === "string" ? body.email.trim() : "";
  const ref = typeof body.ref === "string" ? body.ref.trim() : "";
  const build = typeof body.build === "string" ? body.build.trim() : "";

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: FROM,
      to: TO,
      // Replying to the notification reaches the person who wrote in,
      // instead of requiring a copy-paste out of the body.
      ...(email ? { reply_to: email } : {}),
      subject: ref ? `SkyMap issue: ${ref}` : "SkyMap feedback",
      text: [
        message,
        "",
        "—",
        email ? `From: ${email}` : "No reply address given",
        ref ? `Ref: ${ref}` : null,
        build ? `Build: ${build}` : null,
      ]
        .filter((line) => line !== null)
        .join("\n"),
    }),
  });

  if (!res.ok) {
    console.error("Resend rejected the message:", res.status, await res.text().catch(() => ""));
    return json({ error: "Couldn't send that just now." }, 502);
  }
  return json({ ok: true }, 202);
}

export async function OPTIONS(): Promise<Response> {
  return new Response(null, { status: 204, headers: CORS });
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });
}
