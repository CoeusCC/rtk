#!/usr/bin/env tsx
/**
 * changelog:assemble — Assemble fragments into a versioned CHANGELOG section
 * Usage: pnpm changelog:assemble --version 1.3.0 [--date 2026-04-01] [--dry-run]
 */
import * as fs from "fs";
import * as path from "path";
import { parse } from "yaml";

const FRAGMENTS_DIR = path.resolve(process.cwd(), "changelog/fragments");
const CHANGELOG_PATH = path.resolve(process.cwd(), "CHANGELOG.md");

const TYPE_ORDER = ["feat", "fix", "perf", "refactor", "security", "docs", "chore"] as const;

const TYPE_LABELS: Record<string, string> = {
  feat: "✨ Nouvelles Fonctionnalités",
  fix: "🔧 Corrections de Bugs",
  perf: "⚡ Performances",
  refactor: "🔄 Refactoring",
  security: "🔒 Sécurité",
  docs: "📚 Documentation",
  chore: "🛠️ Technique",
};

interface Fragment {
  pr: number;
  type: string;
  scope: string;
  title: string;
  description?: string;
  breaking?: boolean;
  migration?: boolean;
  scripts?: string[];
}

function loadFragments(): Array<{ fragment: Fragment; file: string }> {
  if (!fs.existsSync(FRAGMENTS_DIR)) return [];
  return fs
    .readdirSync(FRAGMENTS_DIR)
    .filter((f) => f.endsWith(".yml"))
    .map((f) => {
      const filepath = path.join(FRAGMENTS_DIR, f);
      const raw = fs.readFileSync(filepath, "utf8");
      const fragment = parse(raw) as Fragment;
      return { fragment, file: f };
    });
}

function formatLine(fragment: Fragment): string {
  let line = `- **${fragment.title} (#${fragment.pr})**`;
  if (fragment.description) {
    const desc = fragment.description.trim().replace(/\n/g, " ");
    line += ` — ${desc}`;
  }
  if (fragment.migration) {
    line += " ⚠️ Migration DB.";
  }
  return line;
}

function buildSection(version: string, date: string, fragments: Array<{ fragment: Fragment; file: string }>): string {
  const breaking = fragments.filter((f) => f.fragment.breaking);
  const withScripts = fragments.filter(
    (f) => f.fragment.scripts && f.fragment.scripts.length > 0
  );

  const lines: string[] = [`## [${version}] - ${date}`, ""];

  // Breaking changes first
  if (breaking.length > 0) {
    lines.push("### 🔨 Breaking Changes", "");
    breaking.forEach(({ fragment }) => lines.push(formatLine(fragment)));
    lines.push("");
  }

  // Group by type in order
  for (const type of TYPE_ORDER) {
    const group = fragments.filter(
      (f) => f.fragment.type === type && (!f.fragment.breaking || breaking.length === 0)
    );
    if (group.length === 0) continue;
    lines.push(`### ${TYPE_LABELS[type] ?? type}`, "");
    group.forEach(({ fragment }) => lines.push(formatLine(fragment)));
    lines.push("");
  }

  // Scripts section
  if (withScripts.length > 0) {
    lines.push("### 🔧 Scripts Post-Deploy", "");
    withScripts.forEach(({ fragment }) => {
      lines.push(`**PR #${fragment.pr} — ${fragment.title}:**`);
      fragment.scripts!.forEach((s) => lines.push("```bash", s, "```"));
      lines.push("");
    });
  }

  lines.push("---", "");
  return lines.join("\n");
}

function parseArgs() {
  const args = process.argv.slice(2);
  const get = (flag: string) => {
    const i = args.indexOf(flag);
    return i !== -1 ? args[i + 1] : undefined;
  };
  return {
    version: get("--version"),
    date: get("--date") ?? new Date().toISOString().slice(0, 10),
    dryRun: args.includes("--dry-run"),
  };
}

const { version, date, dryRun } = parseArgs();

if (!version) {
  console.error("Usage: pnpm changelog:assemble --version <x.y.z> [--date YYYY-MM-DD] [--dry-run]");
  process.exit(1);
}

const entries = loadFragments();
if (entries.length === 0) {
  console.log("No fragments found in changelog/fragments/ — nothing to assemble.");
  process.exit(0);
}

console.log(`Assembling ${entries.length} fragment(s) into version ${version}...`);

const section = buildSection(version, date, entries);

if (dryRun) {
  console.log("\n--- DRY RUN OUTPUT ---\n");
  console.log(section);
  console.log("--- END DRY RUN ---\n");
  console.log("No files modified (--dry-run).");
  process.exit(0);
}

// Update CHANGELOG.md
const NEXT_RELEASE_MARKER = "## [Next Release]";
const NEXT_RELEASE_PLACEHOLDER = [
  "## [Next Release]",
  "",
  "<!-- Fragments in changelog/fragments/ will be assembled here at release time -->",
  "",
  "---",
  "",
].join("\n");

let changelog = fs.readFileSync(CHANGELOG_PATH, "utf8");

if (!changelog.includes(NEXT_RELEASE_MARKER)) {
  // Inject placeholder at top after title block
  const firstRelease = changelog.search(/^## \[/m);
  if (firstRelease !== -1) {
    changelog =
      changelog.slice(0, firstRelease) +
      NEXT_RELEASE_PLACEHOLDER +
      "\n" +
      changelog.slice(firstRelease);
  }
}

// Replace ## [Next Release] section with the new versioned section + a fresh placeholder
const markerIdx = changelog.indexOf(NEXT_RELEASE_MARKER);
if (markerIdx !== -1) {
  // Find end of the Next Release section (next ## or EOF)
  const afterMarker = changelog.indexOf("\n## ", markerIdx + 1);
  const nextSectionStart = afterMarker !== -1 ? afterMarker + 1 : changelog.length;
  changelog =
    changelog.slice(0, markerIdx) +
    NEXT_RELEASE_PLACEHOLDER +
    "\n" +
    section +
    changelog.slice(nextSectionStart);
}

fs.writeFileSync(CHANGELOG_PATH, changelog, "utf8");
console.log(`✅ CHANGELOG.md updated with version ${version}`);

// Archive fragments
const archiveDir = path.join(FRAGMENTS_DIR, "released", version);
fs.mkdirSync(archiveDir, { recursive: true });

entries.forEach(({ file }) => {
  const src = path.join(FRAGMENTS_DIR, file);
  const dst = path.join(archiveDir, file);
  fs.renameSync(src, dst);
});

// Recreate .gitkeep if fragments/ is now empty
const remaining = fs.readdirSync(FRAGMENTS_DIR).filter((f) => f.endsWith(".yml"));
if (remaining.length === 0) {
  fs.writeFileSync(path.join(FRAGMENTS_DIR, ".gitkeep"), "", "utf8");
}

console.log(`✅ ${entries.length} fragment(s) archived to changelog/fragments/released/${version}/`);
console.log("\nNext steps:");
console.log("  git add CHANGELOG.md changelog/");
console.log(`  git commit -s -m "chore(release): assemble changelog for v${version}"`);
console.log(`  git tag v${version}`);
