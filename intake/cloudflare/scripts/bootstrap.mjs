#!/usr/bin/env node
/**
 * Bootstrap script for secure-intake-cloudflare deployment
 *
 * Usage: node scripts/bootstrap.mjs
 *
 * This script:
 * 1. Creates D1 database (if not exists)
 * 2. Runs schema migration
 * 3. Sets up secrets
 * 4. Deploys to Cloudflare Pages
 */

import { execSync, spawnSync } from "child_process";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { createInterface } from "readline";
import { randomBytes } from "crypto";

// ═══════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════

function prompt(question) {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

function run(cmd, options = {}) {
  console.log(`\n$ ${cmd}`);
  try {
    const result = execSync(cmd, {
      encoding: "utf-8",
      stdio: options.silent ? "pipe" : "inherit",
      ...options,
    });
    return { ok: true, output: result };
  } catch (err) {
    if (options.allowFail) {
      return { ok: false, output: err.stdout || err.message };
    }
    throw err;
  }
}

function generateSalt() {
  return randomBytes(32).toString("hex");
}

// ═══════════════════════════════════════════════════════════════════════════
// CHECK PREREQUISITES
// ═══════════════════════════════════════════════════════════════════════════

function checkWrangler() {
  const result = spawnSync("wrangler", ["--version"], { encoding: "utf-8" });
  if (result.status !== 0) {
    console.error("❌ wrangler CLI not found. Install with: npm install -g wrangler");
    process.exit(1);
  }
  console.log(`✓ wrangler ${result.stdout.trim()}`);
}

function checkAuth() {
  const result = spawnSync("wrangler", ["whoami"], { encoding: "utf-8" });
  if (result.status !== 0 || result.stdout.includes("not authenticated")) {
    console.error("❌ Not authenticated. Run: wrangler login");
    process.exit(1);
  }
  console.log(`✓ Authenticated as: ${result.stdout.trim().split("\n")[0]}`);
}

// ═══════════════════════════════════════════════════════════════════════════
// D1 SETUP
// ═══════════════════════════════════════════════════════════════════════════

async function setupD1(dbName) {
  console.log(`\n📦 Setting up D1 database: ${dbName}`);

  // Check if database exists
  const listResult = run("wrangler d1 list --json", { silent: true, allowFail: true });
  let databases = [];
  try {
    databases = JSON.parse(listResult.output || "[]");
  } catch {
    databases = [];
  }

  const existing = databases.find((db) => db.name === dbName);

  if (existing) {
    console.log(`✓ Database '${dbName}' already exists (ID: ${existing.uuid})`);
    return existing.uuid;
  }

  // Create database
  console.log(`Creating database '${dbName}'...`);
  const createResult = run(`wrangler d1 create ${dbName}`, { silent: true });

  // Parse database ID from output
  const match = createResult.output?.match(/database_id\s*=\s*"([^"]+)"/);
  if (!match) {
    console.error("❌ Could not parse database ID from wrangler output");
    console.error(createResult.output);
    process.exit(1);
  }

  const dbId = match[1];
  console.log(`✓ Created database '${dbName}' (ID: ${dbId})`);
  return dbId;
}

async function runMigrations(dbName) {
  console.log(`\n📝 Running migrations on ${dbName}...`);

  // Run locally first (for dev)
  run(`wrangler d1 execute ${dbName} --file migrations/0001_create_intake_requests.sql --local`, {
    allowFail: true,
  });

  // Run remotely
  run(`wrangler d1 execute ${dbName} --file migrations/0001_create_intake_requests.sql --remote`);

  console.log("✓ Migrations complete");
}

// ═══════════════════════════════════════════════════════════════════════════
// SECRETS SETUP
// ═══════════════════════════════════════════════════════════════════════════

async function setupSecrets(projectName, allowedOrigins, ipSalt) {
  console.log(`\n🔐 Setting up secrets for project: ${projectName}`);

  // Set ALLOWED_ORIGINS
  console.log("Setting ALLOWED_ORIGINS...");
  const originsCmd = `echo "${allowedOrigins}" | wrangler pages secret put ALLOWED_ORIGINS --project-name ${projectName}`;
  run(originsCmd, { allowFail: true });

  // Set INTAKE_IP_SALT
  console.log("Setting INTAKE_IP_SALT...");
  const saltCmd = `echo "${ipSalt}" | wrangler pages secret put INTAKE_IP_SALT --project-name ${projectName}`;
  run(saltCmd, { allowFail: true });

  console.log("✓ Secrets configured");
}

// ═══════════════════════════════════════════════════════════════════════════
// WRANGLER.TOML UPDATE
// ═══════════════════════════════════════════════════════════════════════════

function updateWranglerToml(dbId) {
  const path = "wrangler.toml";
  if (!existsSync(path)) {
    console.warn("⚠️  wrangler.toml not found, skipping update");
    return;
  }

  let content = readFileSync(path, "utf-8");
  content = content.replace(/database_id\s*=\s*""/, `database_id = "${dbId}"`);
  writeFileSync(path, content);
  console.log(`✓ Updated wrangler.toml with database_id = "${dbId}"`);
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════════════

async function main() {
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("  secure-intake-cloudflare Bootstrap");
  console.log("═══════════════════════════════════════════════════════════════");

  // Check prerequisites
  checkWrangler();
  checkAuth();

  // Gather configuration
  console.log("\n📋 Configuration\n");

  const projectName = await prompt("Cloudflare Pages project name [secure-intake]: ") || "secure-intake";
  const dbName = await prompt("D1 database name [intake-db]: ") || "intake-db";
  const allowedOrigins = await prompt("Allowed origins (comma-separated) [*]: ") || "*";

  let ipSalt = await prompt("IP salt (leave blank to generate): ");
  if (!ipSalt) {
    ipSalt = generateSalt();
    console.log(`Generated salt: ${ipSalt.slice(0, 8)}...`);
  }

  // Setup D1
  const dbId = await setupD1(dbName);
  updateWranglerToml(dbId);

  // Run migrations
  await runMigrations(dbName);

  // Create .dev.vars for local development
  const devVars = `ALLOWED_ORIGINS=${allowedOrigins}\nINTAKE_IP_SALT=${ipSalt}\n`;
  writeFileSync(".dev.vars", devVars);
  console.log("✓ Created .dev.vars for local development");

  // Pages project setup
  console.log("\n📄 Cloudflare Pages Setup\n");
  console.log("To create the Pages project and set secrets, run:");
  console.log(`  wrangler pages project create ${projectName}`);
  console.log("");
  console.log("Then set secrets:");
  console.log(`  echo "${allowedOrigins}" | wrangler pages secret put ALLOWED_ORIGINS --project-name ${projectName}`);
  console.log(`  echo "${ipSalt}" | wrangler pages secret put INTAKE_IP_SALT --project-name ${projectName}`);
  console.log("");
  console.log("Deploy with:");
  console.log(`  wrangler pages deploy --project-name ${projectName}`);

  // Attempt to set secrets automatically
  const autoSetup = await prompt("\nAttempt automatic Pages setup? [y/N]: ");
  if (autoSetup.toLowerCase() === "y") {
    // Create project (may fail if exists)
    run(`wrangler pages project create ${projectName}`, { allowFail: true });

    // Set secrets
    await setupSecrets(projectName, allowedOrigins, ipSalt);
  }

  console.log("\n═══════════════════════════════════════════════════════════════");
  console.log("  Bootstrap Complete!");
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("\nNext steps:");
  console.log("  1. Test locally:  npm run dev");
  console.log("  2. Run smoke test: npm run smoke -- http://localhost:8788");
  console.log("  3. Deploy:        npm run deploy");
  console.log("");
}

main().catch((err) => {
  console.error("Bootstrap failed:", err);
  process.exit(1);
});
