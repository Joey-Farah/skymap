/**
 * Feedback intake.
 *
 * Plain JavaScript on purpose. Vercel compiles `api/*.ts` with its own
 * toolchain, and this project's TypeScript 7 makes that step fail — a
 * failure whose symptom is a 404 here and a silent fall back to `mailto:`
 * for every web user, which is the bug this endpoint exists to fix. Not
 * worth the static types on one small file. Verified with `vercel build`. Receives a report from the app and mails it on.
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
const recent = new Map();

function rateLimited(ip) {
  const now = Date.now();
  // Sweep expired callers as we go — Fluid Compute keeps an instance alive
  // for a long time, and a Map that only ever grows is a slow leak.
  for (const [key, times] of recent) {
    if (times.every((t) => now - t >= RATE_WINDOW_MS)) recent.delete(key);
  }
  const hits = (recent.get(ip) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
  const limited = hits.length >= RATE_LIMIT;
  // A rejected attempt isn't recorded: otherwise someone who hits the limit
  // keeps extending their own block with every retry and never gets out.
  if (!limited) {
    hits.push(now);
    recent.set(ip, hits);
  }
  return limited;
}

export async function POST(req) {
  let body;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Malformed request." }, 400);
  }

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "unknown";

  // A hidden field a person never sees and a bot fills in. Answered with a
  // success shape, since telling a bot it failed just teaches it to retry —
  // but logged, because a false positive here means a real person was told
  // "sent" and wasn't, and that has to be recoverable rather than invisible.
  if (typeof body.website === "string" && body.website.trim()) {
    console.warn("feedback: honeypot filled, message dropped", {
      ip,
      preview: typeof body.message === "string" ? body.message.slice(0, 200) : "",
    });
    // Counted against the rate limit too — otherwise filling the honeypot
    // buys unlimited free requests.
    rateLimited(ip);
    return json({ ok: true }, 202);
  }

  const message = typeof body.message === "string" ? body.message.trim() : "";
  if (!message) return json({ error: "A message is required." }, 400);
  if (message.length > MAX_MESSAGE) return json({ error: "That message is too long." }, 413);

  if (rateLimited(ip)) return json({ error: "Too many reports just now — try again shortly." }, 429);

  const key = process.env.RESEND_API_KEY;
  if (!key) {
    // Loud on the server, honest to the client: the app falls back to
    // mailto: on a failure, so the report still has somewhere to go.
    console.error("RESEND_API_KEY is not set — feedback cannot be delivered");
    return json({ error: "Feedback delivery isn't configured." }, 503);
  }

  // Everything below is attacker-controlled on a public endpoint, so none of
  // it is trusted just because the app's own form happens to send it well-
  // formed. Newlines are stripped from anything that reaches a mail header:
  // a `ref` of "x\nBcc: someone@example.com" is a header-injection attempt.
  const header = (v, max) =>
    typeof v === "string" ? v.replace(/[\r\n]+/g, " ").trim().slice(0, max) : "";

  const rawEmail = header(body.email, 254);
  // Only used as Reply-To if it's actually shaped like an address —
  // otherwise a stranger could make mail land in a personal inbox with a
  // Reply-To of their choosing, which is a tidy phishing setup against the
  // one person who reads it.
  const email = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rawEmail) ? rawEmail : "";
  const ref = header(body.ref, 120);
  const build = header(body.build, 40);

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

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });
}
