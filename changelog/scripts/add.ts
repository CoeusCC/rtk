#!/usr/bin/env tsx
/**
 * changelog:add — Interactive CLI to create a changelog fragment
 * Usage: pnpm changelog:add
 */
import * as readline from "readline";
import * as fs from "fs";
import * as path from "path";

const TYPES = ["feat", "fix", "perf", "refactor", "security", "docs", "chore"] as const;
type FragmentType = (typeof TYPES)[number];

const FRAGMENTS_DIR = path.resolve(process.cwd(), "changelog/fragments");

function slugify(text: string, maxLen = 40): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, maxLen);
}

function ask(rl: readline.Interface, question: string): Promise<string> {
  return new Promise((resolve) => rl.question(question, resolve));
}

async function main() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  console.log("\n📝 Create a new changelog fragment\n");

  const prStr = await ask(rl, "PR number: ");
  const pr = parseInt(prStr.trim(), 10);
  if (isNaN(pr) || pr <= 0) {
    console.error("❌ Invalid PR number");
    process.exit(1);
  }

  console.log(`Types: ${TYPES.join(" | ")}`);
  const typeInput = (await ask(rl, "Type: ")).trim() as FragmentType;
  if (!TYPES.includes(typeInput)) {
    console.error(`❌ Invalid type. Must be one of: ${TYPES.join(", ")}`);
    process.exit(1);
  }

  const scope = (await ask(rl, "Scope (e.g. hook, git, permissions): ")).trim();
  if (!scope) {
    console.error("❌ Scope is required");
    process.exit(1);
  }

  const title = (await ask(rl, "Title (< 80 chars): ")).trim();
  if (!title) {
    console.error("❌ Title is required");
    process.exit(1);
  }
  if (title.length > 80) {
    console.error(`❌ Title too long: ${title.length} chars (max 80)`);
    process.exit(1);
  }

  rl.close();

  const slug = slugify(title);
  const filename = `${pr}-${slug}.yml`;
  const filepath = path.join(FRAGMENTS_DIR, filename);

  if (fs.existsSync(filepath)) {
    console.error(`❌ File already exists: changelog/fragments/${filename}`);
    process.exit(1);
  }

  const content = [
    `pr: ${pr}`,
    `type: ${typeInput}`,
    `scope: "${scope}"`,
    `title: "${title}"`,
    `description: |`,
    `  TODO: describe the user-facing impact in 1-2 sentences.`,
    `breaking: false`,
    `migration: false`,
    `scripts: []`,
  ].join("\n") + "\n";

  fs.mkdirSync(FRAGMENTS_DIR, { recursive: true });
  fs.writeFileSync(filepath, content, "utf8");

  console.log(`\n✅ Created: changelog/fragments/${filename}`);
  console.log("\nNext steps:");
  console.log(`  1. Edit the description in changelog/fragments/${filename}`);
  console.log(`  2. git add changelog/fragments/${filename}`);
  console.log(`  3. git commit -s -m "docs(changelog): add fragment for PR #${pr}"`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
