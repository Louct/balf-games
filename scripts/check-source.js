import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Script } from "node:vm";
import { spawnSync } from "node:child_process";

let checked = 0;
const failures = [];
function walk(path) {
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    const file = join(path, entry.name);
    if (entry.isDirectory()) {
      if (
        !["node_modules", "database", "games", "images", ".git"].includes(
          entry.name,
        )
      )
        walk(file);
      continue;
    }
    try {
      if (file.endsWith(".js")) {
        const result = spawnSync(process.execPath, ["--check", file], {
          encoding: "utf8",
        });
        if (result.status !== 0) throw new Error(result.stderr.trim());
        checked++;
      } else if (file.endsWith(".html")) {
        const html = readFileSync(file, "utf8");
        let index = 0;
        for (const script of html.matchAll(
          /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi,
        )) {
          if (
            /\bsrc\s*=|\btype\s*=\s*["'](?:application\/ld\+json|application\/json)/i.test(
              script[1],
            )
          )
            continue;
          new Script(script[2], { filename: file + ":inline-" + ++index });
          checked++;
        }
      } else if (file.endsWith(".json") && file.includes("assets/data")) {
        const data = JSON.parse(readFileSync(file, "utf8"));
        if (!Array.isArray(data) && !Array.isArray(data.games))
          throw new Error("Unexpected catalog format.");
        checked++;
      }
    } catch (error) {
      failures.push(file + ": " + error.message);
    }
  }
}
walk("public");
for (const file of [
  "index.js",
  "monitor.js",
  "movie-relay.js",
  "lc-relay.js",
]) {
  const result = spawnSync(process.execPath, ["--check", file], {
    encoding: "utf8",
  });
  if (result.status !== 0) failures.push(result.stderr);
  checked++;
}
if (failures.length) {
  console.error(failures.join("\n"));
  process.exitCode = 1;
} else
  console.log(
    `Checked ${checked} scripts, inline blocks, and catalogs; no syntax/JSON errors.`,
  );
