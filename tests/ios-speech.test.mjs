import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

// The voice's speech plugin lives in the app target, like the tip jar's, so
// nothing but these checks keeps it wired in. Unregistered, every call
// rejects, voice.ts swallows that, and the app just never talks.

const PLUGIN = "ios/App/App/SpeechPlugin.swift";

test("SpeechPlugin.swift is compiled into the app target", () => {
  const project = readFileSync("ios/App/App.xcodeproj/project.pbxproj", "utf8");
  assert.match(project, /SpeechPlugin\.swift in Sources \*\/,/, "SpeechPlugin.swift is not in the Sources build phase");
});

test("the bridge registers the speech plugin under the name voice.ts calls", () => {
  const bridge = readFileSync("ios/App/App/SkyMapBridgeViewController.swift", "utf8");
  assert.match(bridge, /registerPluginInstance\(SpeechPlugin\(\)\)/);
  assert.ok(existsSync(PLUGIN));
  assert.match(readFileSync(PLUGIN, "utf8"), /jsName = "Speech"/);
  assert.match(readFileSync("src/voice.ts", "utf8"), /registerPlugin<[\s\S]*?>\("Speech"\)/);
});

test("prompts play with the ringer off, duck other audio, and hand it back", () => {
  // .playback is what plays through the silent switch, as Apple Maps does;
  // the default category would leave a phone on silent mute mid-walk.
  // Deactivating with notifyOthersOnDeactivation is what brings music back
  // up, and a paused podcast back on, instead of leaving them down.
  const plugin = readFileSync(PLUGIN, "utf8");
  assert.match(plugin, /setCategory\(\.playback, mode: \.voicePrompt/);
  assert.match(plugin, /\.duckOthers/);
  assert.match(plugin, /notifyOthersOnDeactivation/);
});
