#!/usr/bin/env tsx
/**
 * changelog:audit — Detect merged PRs without a changelog fragment
 * Usage: pnpm changelog:audit [--since v1.2.0] [--repo owner/repo] [--json]
 * Exit 0 if all covered, exit 1 if gaps found.
 */
import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { parse } from "yaml";

const FRAGMENTS_DIR = path.resolve(process.cwd(), "changelog/fragments");
const BYPASS_LABELS = ["skip-changelog", "dependencies", "release", "chore: deps"];

interface PrInfo {
  number: number;
  title: string;
  mergedAt: string;
  labels: Array<{ name: string }>;
  url: string;
}

interface Fragment {
  pr: number;
  [key: string]: unknown;
}

function run(cmd: string): string {
  return execSync(cmd, { encoding: "utf8" }).trim();
}

function parseArgs() {
  const args = process.argv.slice(2);
  const get = (flag: string) => {
    const i = args.indexOf(flag);
    return i !== -1 ? args[i + 1] : undefined;
  };
  return {
    since: get("--since"),
    repo: get("--repo"),
    json: args.includes("--json"),
  };
}

function detectRepo(argRepo?: string): string {
  if (argRepo) return argRepo;
  try {
    const remote = run("git remote get-url origin");
    const match = remote.match(/github\.com[:/]([^/]+\/[^/.]+)/);
    if (match) return match[1];
  } catch {
    // ignore
  }
  console.error("❌ Could not detect repo. Use --repo owner/repo");
  process.exit(1);
}

function detectSinceDate(sinceTag?: string): string {
  if (sinceTag) {
    try {
      return run(`git log -1 --format=%aI ${sinceTag}`);
    } catch {
      console.error(`❌ Tag not found: ${sinceTag}`);
      process.exit(1);
    }
  }
  try {
    const lastTag = run("git describe --tags --abbrev=0");
    return run(`git log -1 --format=%aI ${lastTag}`);
  } catch {
    // No tags — use epoch
    return "1970-01-01T00:00:00Z";
  }
}

function loadAllFragmentPrs(): Set<number> {
  const prNums = new Set<number>();
  const scanDir = (dir: string) => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        scanDir(path.join(dir, entry.name));
      } else if (entry.name.endsWith(".yml")) {
        try {
          const raw = fs.readFileSync(path.join(dir, entry.name), "utf8");
          const frag = parse(raw) as Partial<Fragment>;
          if (typeof frag.pr === "number") prNums.add(frag.pr);
        } catch {
          // ignore malformed fragments
        }
      }
    }
  };
  scanDir(FRAGMENTS_DIR);
  return prNums;
}

async function main() {
  const { since, repo: argRepo, json } = parseArgs();
  const repo = detectRepo(argRepo);
  const sinceDate = detectSinceDate(since);

  if (!json) console.log(`🔍 Auditing merged PRs in ${repo} since ${sinceDate}...\n`);

  // Fetch merged PRs via gh CLI
  let prs: PrInfo[];
  try {
    const raw = run(
      `gh pr list --repo ${repo} --state merged --base develop --json number,title,mergedAt,labels,url --limit 200`
    );
    const all: PrInfo[] = JSON.parse(raw);
    prs = all.filter((pr) => pr.mergedAt >= sinceDate);
  } catch (e) {
    console.error(`❌ Failed to fetch PRs: ${e}`);
    process.exit(1);
  }

  const coveredPrs = loadAllFragmentPrs();

  const covered: PrInfo[] = [];
  const bypassed: PrInfo[] = [];
  const missing: PrInfo[] = [];
  const orphans: number[] = [];

  for (const pr of prs) {
    const labels = pr.labels.map((l) => l.name);
    if (coveredPrs.has(pr.number)) {
      covered.push(pr);
    } else if (BYPASS_LABELS.some((b) => labels.includes(b))) {
      bypassed.push(pr);
    } else {
      missing.push(pr);
    }
  }

  // Orphan detection: fragments referencing PRs not in the merged list
  const mergedNums = new Set(prs.map((p) => p.number));
  for (const pr of coveredPrs) {
    if (!mergedNums.has(pr)) orphans.push(pr);
  }

  if (json) {
    console.log(
      JSON.stringify(
        {
          summary: {
            total: prs.length,
            covered: covered.length,
            bypassed: bypassed.length,
            missing: missing.length,
            orphans: orphans.length,
          },
          missing: missing.map((p) => ({ number: p.number, title: p.title, url: p.url })),
          orphans,
        },
        null,
        2
      )
    );
  } else {
    console.log(`Total PRs merged: ${prs.length}`);
    console.log(`  ✅ Covered:  ${covered.length}`);
    console.log(`  ⏭️  Bypassed: ${bypassed.length}`);
    console.log(`  ❌ Missing:  ${missing.length}`);
    if (orphans.length > 0) {
      console.log(`  ⚠️  Orphan fragments (no matching PR): ${orphans.join(", ")}`);
    }

    if (missing.length > 0) {
      console.log("\n❌ PRs without fragment:");
      missing.forEach((p) => console.log(`  #${p.number} — ${p.title}\n     ${p.url}`));
      console.log("\nFix: pnpm changelog:add  (then commit the fragment on the PR branch)");
    } else {
      console.log("\n✅ All merged PRs have changelog coverage.");
    }
  }

  process.exit(missing.length > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
