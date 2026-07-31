/** The feedback dialog: collects a report and posts it, so nobody needs a
 * configured mail client to tell us something is wrong. */

import { Capacitor } from "@capacitor/core";
import { buildFeedbackPayload, feedbackProblem, sendFeedback } from "./feedback.ts";
import { feedbackUrl, reportIssueUrl } from "./share.ts";

const BUILD = typeof __BUILD_HASH__ === "undefined" ? "dev" : __BUILD_HASH__;

/**
 * Where to post. On the web the function sits alongside the app, so a
 * relative path is right. The iOS build is served from
 * capacitor://localhost — there is no server behind that origin, so a
 * relative path would post into the void and it needs the deployed
 * absolute URL, supplied at build time as VITE_FEEDBACK_ENDPOINT.
 *
 * Null when a native build has no endpoint configured. The caller then
 * falls back to `mailto:` — today's behaviour, which is imperfect but
 * real, rather than a form that silently drops what someone typed.
 */
function endpoint(): string | null {
  if (!Capacitor.isNativePlatform()) return "/api/feedback";
  return import.meta.env.VITE_FEEDBACK_ENDPOINT || null;
}

interface Target {
  name: string;
  id: string;
}

export class FeedbackForm {
  private root = document.getElementById("feedback-form") as HTMLElement;
  private backdrop = document.getElementById("feedback-backdrop") as HTMLElement;
  private title = document.getElementById("feedback-title") as HTMLElement;
  private sub = document.getElementById("feedback-sub") as HTMLElement;
  private message = document.getElementById("feedback-message") as HTMLTextAreaElement;
  private email = document.getElementById("feedback-email") as HTMLInputElement;
  private honeypot = document.getElementById("feedback-website") as HTMLInputElement;
  private error = document.getElementById("feedback-error") as HTMLElement;
  private sendBtn = document.getElementById("feedback-send") as HTMLButtonElement;
  private cancelBtn = document.getElementById("feedback-cancel") as HTMLButtonElement;

  private target: Target | null = null;
  private hours: string | undefined;
  /** Restored on close: a dialog that steals focus and doesn't give it back
   * strands anyone navigating by keyboard or switch control. */
  private returnFocusTo: HTMLElement | null = null;

  constructor(private toast: (text: string) => void) {
    this.sendBtn.addEventListener("click", () => void this.submit());
    this.cancelBtn.addEventListener("click", () => this.close());
    this.backdrop.addEventListener("click", () => this.close());
    this.root.addEventListener("keydown", (e) => {
      if (e.key === "Escape") this.close();
      // Enter submits from the single-line email field, matching every other
      // form; the textarea keeps Enter for newlines, where it belongs.
      if (e.key === "Enter" && e.target === this.email) void this.submit();
    });
  }

  /** General feedback, or a report about one place when `target` is given. */
  open(target?: Target, hours?: string) {
    this.target = target ?? null;
    this.hours = hours;
    this.returnFocusTo = document.activeElement as HTMLElement | null;
    this.title.textContent = target ? "Report an issue" : "Send feedback";
    this.sub.textContent = target
      ? `What's wrong with ${target.name}? Closed, wrong hours, wrong place, doesn't exist…`
      : "What's working, what's not, what would make this better?";
    this.message.value = "";
    this.error.hidden = true;
    this.setBusy(false);
    this.root.hidden = false;
    this.backdrop.hidden = false;
    this.message.focus();
  }

  close() {
    this.root.hidden = true;
    this.backdrop.hidden = true;
    this.returnFocusTo?.focus();
    this.returnFocusTo = null;
  }

  private setBusy(busy: boolean) {
    this.sendBtn.disabled = busy;
    this.sendBtn.textContent = busy ? "Sending…" : "Send";
  }

  private fail(text: string) {
    this.error.textContent = text;
    this.error.hidden = false;
  }

  private async submit() {
    const draft = { message: this.message.value, email: this.email.value, ref: this.target?.id };
    const problem = feedbackProblem(draft);
    if (problem) return this.fail(problem);

    const url = endpoint();
    // Nothing to post to: hand off to mail rather than swallow the report.
    if (!url) return this.handOffToMail();

    this.setBusy(true);
    this.error.hidden = true;
    const payload = {
      ...buildFeedbackPayload(draft, BUILD),
      // Sent as typed; the server treats any value as a bot and quietly
      // drops the message.
      website: this.honeypot.value,
    };
    const sent = await sendFeedback(url, payload, (u, init) => fetch(u, init as RequestInit));
    this.setBusy(false);

    if (sent) {
      this.close();
      this.toast("Thanks — that's been sent.");
      return;
    }
    // Offline, or the endpoint is down. The typed message is still in the
    // box, and mail can carry it — losing it here would be the original bug
    // wearing a different hat.
    this.fail("Couldn't send that just now.");
    this.handOffToMail();
  }

  private handOffToMail() {
    const url = this.target ? reportIssueUrl(this.target, this.hours) : feedbackUrl();
    window.location.href = url;
  }
}
