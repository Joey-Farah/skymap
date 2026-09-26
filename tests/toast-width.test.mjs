import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// The toast is centred with left: 50% and a transform, which leaves the
// browser only the right half of the screen to lay it out in: every message
// wrapped at 50vw, "Thank you ♥ That means a lot." onto two lines. Sizing it
// to its content (still capped by max-width) is what lets it use the width.
test("the toast sizes to its text rather than to half the screen", () => {
  const css = readFileSync("src/styles.css", "utf8");
  const rule = css.match(/\n\.toast \{([^}]*)\}/)?.[1] ?? "";
  assert.match(rule, /width:\s*max-content;/);
  assert.match(rule, /max-width:\s*min\(86vw, 420px\);/);
});
