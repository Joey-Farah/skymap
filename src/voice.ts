import { Capacitor, registerPlugin } from "@capacitor/core";
import type { KeyValueStore } from "./storage.ts";

/**
 * Voice turn-by-turn: says the nav banner's line out loud, once each time
 * it changes.
 *
 * The banner already decides *when* there is something new to say — it
 * switches at the door, and nav-progress.ts keeps GPS drift from flapping
 * it — so this adds no timing of its own. Its whole job is not repeating
 * itself: the banner is redrawn on every fix, and nearly every redraw is
 * the line already spoken.
 */

/** Whatever actually makes the sound. */
export interface SpeechEngine {
  /** Cuts off anything still being said: a stale instruction finished is
   * worse than the current one started late. */
  speak(text: string): void;
  stop(): void;
}

export interface Voice {
  /** The banner's current line, or null when there is nothing to say. */
  say(line: string | null): void;
  /** The trip is over: go quiet, and forget the last line so the next
   * trip's first one is said even when it's the same. */
  stop(): void;
  enabled(): boolean;
  /** The walker's choice, kept across launches. */
  setEnabled(on: boolean): void;
}

/** Present only while on: off is the default, so a missing or unreadable
 * key means off. */
export const ON_KEY = "skymap.voiceOn";

export function createVoice(engine: SpeechEngine, store: KeyValueStore): Voice {
  // The banner's line is tracked while off too, so turning it on can say where
  // things stand instead of waiting silently for the next building.
  let last: string | null = null;
  let on = store.getItem(ON_KEY) !== null;
  return {
    say(line) {
      if (line === null || line === last) return;
      last = line;
      if (on) engine.speak(line);
    },
    stop() {
      last = null;
      engine.stop();
    },
    enabled: () => on,
    setEnabled(next) {
      if (next === on) return;
      on = next;
      if (on) {
        store.setItem(ON_KEY, "1");
        if (last !== null) engine.speak(last);
      } else {
        store.removeItem(ON_KEY);
        engine.stop();
      }
    },
  };
}

/** ios/App/App/SpeechPlugin.swift, registered by the app's own bridge. */
const NativeSpeech = registerPlugin<{
  speak(options: { text: string }): Promise<void>;
  stop(): Promise<void>;
}>("Speech");

/**
 * iOS's own synthesizer on the phone, through the app's plugin: only native
 * code can set the audio session, which is what lets a prompt play with the
 * ringer off and duck music instead of fighting it. The browser's Web
 * Speech elsewhere, and silence where there is neither.
 */
export function speechEngine(): SpeechEngine {
  if (Capacitor.isNativePlatform()) {
    // A binary built before the plugin existed rejects; a missing voice
    // must never surface as an error mid-walk.
    return {
      speak: (text) => void NativeSpeech.speak({ text }).catch(() => {}),
      stop: () => void NativeSpeech.stop().catch(() => {}),
    };
  }
  const synth = typeof window === "undefined" ? undefined : window.speechSynthesis;
  if (!synth) return { speak() {}, stop() {} };
  return {
    speak(text) {
      synth.cancel();
      synth.speak(new SpeechSynthesisUtterance(text));
    },
    stop: () => synth.cancel(),
  };
}
