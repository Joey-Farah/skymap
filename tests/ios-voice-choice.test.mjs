import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";

// Which of the phone's voices says the instructions. iOS's basic voice is
// the robotic one (Joey, 2026-10-27); the natural ones are Enhanced and
// Premium, which only the walker can download, in Settings. So: the best
// English voice the phone has, else iOS's default.
//
// The app target has no unit tests, so VoiceChoice.swift is compiled here
// on the Mac with a stand-in for AVSpeechSynthesisVoice.

const dir = mkdtempSync(path.join(tmpdir(), "voice-choice-"));
const bin = path.join(dir, "pick");
writeFileSync(
  path.join(dir, "main.swift"),
  `import AVFoundation
struct Fake: SpeechVoice { let identifier: String; let language: String; let quality: AVSpeechSynthesisVoiceQuality }
let input = try! JSONSerialization.jsonObject(with: Data(CommandLine.arguments[1].utf8)) as! [String: Any]
let voices = (input["voices"] as! [[String: Any]]).map {
  Fake(identifier: $0["id"] as! String, language: $0["lang"] as! String, quality: AVSpeechSynthesisVoiceQuality(rawValue: $0["q"] as! Int)!)
}
print(VoiceChoice.best(voices, preferring: input["preferred"] as? String)?.identifier ?? "none")
`,
);
const built = spawnSync("xcrun", ["swiftc", "-o", bin, "ios/App/App/VoiceChoice.swift", path.join(dir, "main.swift")], {
  encoding: "utf8",
});

const BASIC = 1;
const ENHANCED = 2;
const PREMIUM = 3;
const voice = (id, lang, q) => ({ id, lang, q });

function pick(voices, preferred) {
  assert.equal(built.status, 0, built.stderr);
  const r = spawnSync(bin, [JSON.stringify({ voices, preferred })], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.trim();
}

const samantha = voice("samantha", "en-US", BASIC);
const daniel = voice("daniel", "en-GB", BASIC);

test("with only the basic voices, iOS's default speaks", () => {
  assert.equal(pick([samantha, daniel]), "none");
});

test("a downloaded voice beats the basic ones, and Premium beats Enhanced", () => {
  assert.equal(pick([samantha, voice("ava-e", "en-US", ENHANCED), daniel]), "ava-e");
  assert.equal(pick([voice("ava-e", "en-US", ENHANCED), voice("zoe-p", "en-US", PREMIUM)]), "zoe-p");
});

test("quality beats accent: a British Premium over an American Enhanced", () => {
  // The complaint was robotic, not British.
  assert.equal(pick([voice("ava-e", "en-US", ENHANCED), voice("serena-p", "en-GB", PREMIUM)]), "serena-p");
});

test("among equals, the voice picked in Settings, then American English", () => {
  const serena = voice("serena-p", "en-GB", PREMIUM);
  const ava = voice("ava-p", "en-US", PREMIUM);
  const zoe = voice("zoe-p", "en-US", PREMIUM);
  assert.equal(pick([serena, ava]), "ava-p");
  assert.equal(pick([serena, ava, zoe], "zoe-p"), "zoe-p");
  // The walker's pick wins over accent too: they chose it.
  assert.equal(pick([serena, ava], "serena-p"), "serena-p");
});

test("another language's voice never says English instructions", () => {
  assert.equal(pick([samantha, voice("amelie-p", "fr-CA", PREMIUM)]), "none");
});
