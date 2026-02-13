#!/usr/bin/env node
/**
 * Smoke test for /api/intake endpoint
 *
 * Usage: node scripts/smoke-post.mjs [endpoint] [options]
 *
 * Options:
 *   --hmac-secret=SECRET  Enable HMAC tests with the given secret
 *   --origin=URL          Origin header to use (default: http://localhost:3000)
 *
 * Default endpoint: http://localhost:8788
 */

import { webcrypto } from "crypto";

const DEFAULT_ENDPOINT = "http://localhost:8788";

// ═══════════════════════════════════════════════════════════════════════════
// TEST DATA
// ═══════════════════════════════════════════════════════════════════════════

// Generate a unique ID for each test run
function generateTestId() {
  const bytes = new Uint8Array(32);
  webcrypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// Compute HMAC-SHA256 for authenticated requests
async function computeHmac(secret, id, encryptedJson) {
  const encoder = new TextEncoder();
  const key = await webcrypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  // IMPORTANT: Use lowercase ID to match server normalization
  const message = encoder.encode(id.toLowerCase() + "." + encryptedJson);
  const signature = await webcrypto.subtle.sign("HMAC", key, message);
  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function createTestEnvelope(id) {
  return {
    v: "loggie.intake.v1",
    id,
    encrypted: JSON.stringify({
      // Simulated encrypted payload (would be real ciphertext in production)
      x25519Ciphertext: "dGVzdC1jaXBoZXJ0ZXh0",
      kyberCiphertext: "dGVzdC1reWJlci1jaXBoZXJ0ZXh0",
      nonce: "dGVzdC1ub25jZQ==",
      ciphertext: "dGVzdC1lbmNyeXB0ZWQtcGF5bG9hZA==",
    }),
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// TEST RUNNER
// ═══════════════════════════════════════════════════════════════════════════

async function post(endpoint, body, options = {}) {
  const url = `${endpoint}/api/intake`;
  const headers = {
    "Content-Type": "application/json",
    ...(options.origin && { "Origin": options.origin }),
    ...options.headers,
  };

  // Auto-add HMAC if secret provided and not explicitly set
  if (options.hmacSecret && !headers["X-Intake-HMAC"] && typeof body.encrypted === "string") {
    headers["X-Intake-HMAC"] = await computeHmac(options.hmacSecret, body.id, body.encrypted);
  }

  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  const data = await response.json().catch(() => null);
  return { status: response.status, data, headers: response.headers };
}

async function runTests(endpoint, hmacSecret = null, origin = "http://localhost:3000") {
  console.log(`\n═══════════════════════════════════════════════════════════════`);
  console.log(`  Smoke Test: ${endpoint}/api/intake`);
  console.log(`  Origin: ${origin}`);
  if (hmacSecret) {
    console.log(`  HMAC: enabled (secret provided)`);
  }
  console.log(`═══════════════════════════════════════════════════════════════\n`);

  let passed = 0;
  let failed = 0;

  function test(name, condition, details = "") {
    if (condition) {
      console.log(`✓ ${name}`);
      passed++;
    } else {
      console.log(`✗ ${name}${details ? ` - ${details}` : ""}`);
      failed++;
    }
  }

  // Test 1: Valid submission -> 201 created
  const testId = generateTestId();
  const envelope = createTestEnvelope(testId);

  console.log(`Test ID: ${testId.slice(0, 16)}...\n`);

  const res1 = await post(endpoint, envelope, { hmacSecret, origin });
  test(
    "POST valid envelope -> 201 created",
    res1.status === 201 && res1.data?.ok === true && res1.data?.status === "created",
    `status=${res1.status}, data=${JSON.stringify(res1.data)}`
  );

  // Test 2: Duplicate submission -> 200 duplicate
  const res2 = await post(endpoint, envelope, { hmacSecret, origin });
  test(
    "POST duplicate envelope -> 200 duplicate",
    res2.status === 200 && res2.data?.ok === true && res2.data?.status === "duplicate",
    `status=${res2.status}, data=${JSON.stringify(res2.data)}`
  );

  // Test 3: CORS - if origin is allowed, header should match; if not, header absent is OK
  const corsHeader = res1.headers.get("Access-Control-Allow-Origin");
  const corsOk = corsHeader === origin || corsHeader === null;
  test(
    "CORS: Access-Control-Allow-Origin matches origin (or absent if not allowed)",
    corsOk,
    `expected=${origin}, got=${corsHeader}`
  );

  // Test 4: Missing required field -> 400
  const res3 = await post(endpoint, { v: "loggie.intake.v1", id: testId }, { hmacSecret, origin });
  test(
    "POST missing 'encrypted' -> 400",
    res3.status === 400 && res3.data?.ok === false,
    `status=${res3.status}, data=${JSON.stringify(res3.data)}`
  );

  // Test 5: Invalid version -> 400
  const newId5 = generateTestId();
  const res4 = await post(endpoint, { ...createTestEnvelope(newId5), v: "invalid.v9" }, { hmacSecret, origin });
  test(
    "POST invalid version -> 400",
    res4.status === 400 && res4.data?.ok === false,
    `status=${res4.status}, data=${JSON.stringify(res4.data)}`
  );

  // Test 6: Invalid ID format -> 400
  const res5 = await post(endpoint, { ...envelope, id: "not-a-valid-hex-id" }, { hmacSecret, origin });
  test(
    "POST invalid ID format -> 400",
    res5.status === 400 && res5.data?.ok === false,
    `status=${res5.status}, data=${JSON.stringify(res5.data)}`
  );

  // Test 7: Uppercase ID normalized to lowercase -> 200 duplicate (same as lowercase)
  const uppercaseId = testId.toUpperCase();
  const uppercaseEnvelope = createTestEnvelope(uppercaseId);
  const res6 = await post(endpoint, uppercaseEnvelope, { hmacSecret, origin });
  test(
    "POST uppercase ID -> normalized, returns duplicate",
    res6.status === 200 && res6.data?.status === "duplicate",
    `status=${res6.status}, data=${JSON.stringify(res6.data)}`
  );

  // Test 8: OPTIONS preflight
  const preflightRes = await fetch(`${endpoint}/api/intake`, {
    method: "OPTIONS",
    headers: {
      "Origin": "http://localhost:3000",
      "Access-Control-Request-Method": "POST",
    },
  });
  test(
    "OPTIONS preflight -> 204",
    preflightRes.status === 204,
    `status=${preflightRes.status}`
  );

  // Run HMAC tests if secret provided
  if (hmacSecret) {
    await runHmacTests(endpoint, hmacSecret, test);
  }

  // Summary
  console.log(`\n═══════════════════════════════════════════════════════════════`);
  console.log(`  Results: ${passed} passed, ${failed} failed`);
  console.log(`═══════════════════════════════════════════════════════════════\n`);

  return failed === 0;
}

// ═══════════════════════════════════════════════════════════════════════════
// HMAC TESTS (only when --hmac-secret provided)
// ═══════════════════════════════════════════════════════════════════════════

async function runHmacTests(endpoint, hmacSecret, test) {
  console.log(`\n─────────────────────────────────────────────────────────────────`);
  console.log(`  HMAC Validation Tests (secret configured)`);
  console.log(`─────────────────────────────────────────────────────────────────\n`);

  const testId = generateTestId();
  const encryptedString = JSON.stringify({
    x25519Ciphertext: "dGVzdC1jaXBoZXJ0ZXh0",
    kyberCiphertext: "dGVzdC1reWJlci1jaXBoZXJ0ZXh0",
    nonce: "dGVzdC1ub25jZQ==",
    ciphertext: "dGVzdC1lbmNyeXB0ZWQtcGF5bG9hZA==",
  });

  // Test: Missing X-Intake-HMAC -> 401
  const res1 = await post(endpoint, {
    v: "loggie.intake.v1",
    id: testId,
    encrypted: encryptedString,
  });
  test(
    "HMAC: missing X-Intake-HMAC header -> 401",
    res1.status === 401 && res1.data?.ok === false,
    `status=${res1.status}, data=${JSON.stringify(res1.data)}`
  );

  // Test: Wrong HMAC -> 401
  const testId2 = generateTestId();
  const res2 = await post(endpoint, {
    v: "loggie.intake.v1",
    id: testId2,
    encrypted: encryptedString,
  }, { headers: { "X-Intake-HMAC": "deadbeef".repeat(8) } });
  test(
    "HMAC: wrong X-Intake-HMAC -> 401",
    res2.status === 401 && res2.data?.ok === false,
    `status=${res2.status}, data=${JSON.stringify(res2.data)}`
  );

  // Test: encrypted as object (not string) -> 400
  const testId3 = generateTestId();
  const hmac3 = await computeHmac(hmacSecret, testId3, JSON.stringify({ foo: "bar" }));
  const res3 = await post(endpoint, {
    v: "loggie.intake.v1",
    id: testId3,
    encrypted: { foo: "bar" },  // Object, not string
  }, { headers: { "X-Intake-HMAC": hmac3 } });
  test(
    "HMAC: encrypted as object -> 400",
    res3.status === 400 && res3.data?.ok === false,
    `status=${res3.status}, data=${JSON.stringify(res3.data)}`
  );

  // Test: Valid HMAC with string encrypted -> 201
  const testId4 = generateTestId();
  const hmac4 = await computeHmac(hmacSecret, testId4, encryptedString);
  const res4 = await post(endpoint, {
    v: "loggie.intake.v1",
    id: testId4,
    encrypted: encryptedString,
  }, { headers: { "X-Intake-HMAC": hmac4 } });
  test(
    "HMAC: valid signature -> 201 created",
    res4.status === 201 && res4.data?.ok === true,
    `status=${res4.status}, data=${JSON.stringify(res4.data)}`
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════════════

// Parse arguments
let endpoint = DEFAULT_ENDPOINT;
let hmacSecret = null;
let testOrigin = "http://localhost:3000";

for (const arg of process.argv.slice(2)) {
  if (arg.startsWith("--hmac-secret=")) {
    hmacSecret = arg.slice("--hmac-secret=".length);
  } else if (arg.startsWith("--origin=")) {
    testOrigin = arg.slice("--origin=".length);
  } else if (!arg.startsWith("-")) {
    endpoint = arg;
  }
}

runTests(endpoint, hmacSecret, testOrigin)
  .then((success) => {
    process.exit(success ? 0 : 1);
  })
  .catch((err) => {
    console.error("Smoke test error:", err);
    process.exit(1);
  });
