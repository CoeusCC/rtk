#!/usr/bin/env tsx
/**
 * changelog:validate — Validate a changelog fragment file
 * Usage: pnpm changelog:validate changelog/fragments/123-my-feature.yml
 * Exit 0 if valid, exit 1 with error messages if not.
 */
import * as fs from "fs";
import * as path from "path";
import { parse } from "yaml";

const TYPES = ["feat", "fix", "perf", "refactor", "security", "docs", "chore"];
const FRAGMENTS_DIR = path.resolve(process.cwd(), "changelog/fragments");

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

function validateFragment(filepath: string): string[] {
  const errors: string[] = [];

  let raw: string;
  try {
    raw = fs.readFileSync(filepath, "utf8");
  } catch {
    return [`Cannot read file: ${filepath}`];
  }

  let fragment: Partial<Fragment>;
  try {
    fragment = parse(raw) as Partial<Fragment>;
  } catch (e) {
    return [`Invalid YAML: ${e}`];
  }

  // Required fields
  if (fragment.pr === undefined || fragment.pr === null) {
    errors.push("Missing required field: pr");
  } else if (typeof fragment.pr !== "number" || fragment.pr <= 0) {
    errors.push(`Field 'pr' must be a positive number, got: ${fragment.pr}`);
  }

  if (!fragment.type) {
    errors.push("Missing required field: type");
  } else if (!TYPES.includes(fragment.type)) {
    errors.push(`Field 'type' must be one of: ${TYPES.join(", ")}, got: ${fragment.type}`);
  }

  if (!fragment.scope || String(fragment.scope).trim() === "") {
    errors.push("Missing required field: scope");
  }

  if (!fragment.title || String(fragment.title).trim() === "") {
    errors.push("Missing required field: title");
  } else if (fragment.title.length > 80) {
    errors.push(`Field 'title' exceeds 80 chars: ${fragment.title.length} chars`);
  }

  // Validate scripts if present
  if (fragment.scripts !== undefined) {
    if (!Array.isArray(fragment.scripts)) {
      errors.push("Field 'scripts' must be an array");
    } else {
      fragment.scripts.forEach((s, i) => {
        if (typeof s !== "string" || s.trim() === "") {
          errors.push(`Field 'scripts[${i}]' must be a non-empty string`);
        }
      });
    }
  }

  // Check PR number matches filename
  const basename = path.basename(filepath);
  const match = basename.match(/^(\d+)-/);
  if (match) {
    const filenamePr = parseInt(match[1], 10);
    if (fragment.pr !== undefined && fragment.pr !== filenamePr) {
      errors.push(
        `PR number mismatch: filename says ${filenamePr}, field 'pr' says ${fragment.pr}`
      );
    }
  } else {
    errors.push(`Filename doesn't start with PR number: ${basename}`);
  }

  return errors;
}

function checkDuplicates(targetFile: string): string[] {
  const warnings: string[] = [];
  const targetBasename = path.basename(targetFile);
  const targetMatch = targetBasename.match(/^(\d+)-/);
  if (!targetMatch) return warnings;
  const targetPr = parseInt(targetMatch[1], 10);

  try {
    const files = fs.readdirSync(FRAGMENTS_DIR).filter((f) => f.endsWith(".yml"));
    const duplicates = files.filter((f) => {
      if (f === targetBasename) return false;
      const m = f.match(/^(\d+)-/);
      return m && parseInt(m[1], 10) === targetPr;
    });
    if (duplicates.length > 0) {
      warnings.push(
        `Warning: duplicate PR #${targetPr} in fragments: ${duplicates.join(", ")}`
      );
    }
  } catch {
    // FRAGMENTS_DIR may not exist yet, ignore
  }

  return warnings;
}

const filepath = process.argv[2];
if (!filepath) {
  console.error("Usage: pnpm changelog:validate <fragment.yml>");
  process.exit(1);
}

const absPath = path.resolve(process.cwd(), filepath);
const errors = validateFragment(absPath);
const warnings = checkDuplicates(absPath);

warnings.forEach((w) => console.warn(`⚠️  ${w}`));

if (errors.length > 0) {
  console.error(`❌ Validation failed for ${path.basename(filepath)}:`);
  errors.forEach((e) => console.error(`   - ${e}`));
  process.exit(1);
}

console.log(`✅ Valid: ${path.basename(filepath)}`);
process.exit(0);
