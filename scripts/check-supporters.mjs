// Fails the build when data/supporters.json can't ship: a place that's gone
// from the map, renamed, not Coffee or Food, a bad date, or a category or
// building over its cap. Runs first in `npm run build`, which is also what
// Xcode Cloud runs for every release. The rules are in src/supporters.ts.
import { readFileSync } from "node:fs";
import { checkSupporters } from "../src/supporters.ts";

// A path argument checks another file instead (the tests use it).
const file = process.argv[2] ?? "data/supporters.json";
const list = JSON.parse(readFileSync(file, "utf8")).supporters;
const data = JSON.parse(readFileSync("public/data/skymap-data.json", "utf8"));
const problems = checkSupporters(list, data.pois);
if (problems.length) {
  console.error(`${file} can't ship:\n${problems.map((p) => `  - ${p}`).join("\n")}`);
  process.exit(1);
}
console.log(`supporters: ${list.length} ${list.length === 1 ? "entry" : "entries"}, all sound`);
