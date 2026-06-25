import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const agentId = process.argv[2] || "ss-monitor";
const agentRoot = resolve(repoRoot, "agents", agentId);
const outputPath = resolve(repoRoot, "out", "wdcloud", `${agentId}-source-files.json`);

const skipNames = new Set(["node_modules", ".git", "__pycache__"]);
const sourceFiles = [];

function walk(dir) {
  for (const name of readdirSync(dir)) {
    if (skipNames.has(name)) continue;
    const absolute = join(dir, name);
    const stat = statSync(absolute);
    if (stat.isDirectory()) {
      walk(absolute);
      continue;
    }
    if (!stat.isFile()) continue;
    const rel = relative(repoRoot, absolute).replaceAll("\\", "/");
    sourceFiles.push({
      path: rel,
      content: readFileSync(absolute, "utf8")
    });
  }
}

walk(agentRoot);
sourceFiles.sort((left, right) => left.path.localeCompare(right.path));
mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, JSON.stringify({ sourceFiles }, null, 2) + "\n", "utf8");
console.log(`Wrote ${sourceFiles.length} files to ${relative(repoRoot, outputPath)}`);
