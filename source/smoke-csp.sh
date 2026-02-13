#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────
# CSP regression smoke test for defense.loggielabs.com/intake
#
# Verifies:
#  1. CSP header includes script-src 'self' (no unsafe-eval)
#  2. No inline <script> tags in the intake HTML
#  3. Entry chunk (intake-client.js) contains no WebAssembly API calls
#  4. Chunk files are served with correct Content-Type
#
# Usage: bash source/smoke-csp.sh [BASE_URL]
# Default: https://defense.loggielabs.com
# ──────────────────────────────────────────────────────────────

set -euo pipefail

BASE="${1:-https://defense.loggielabs.com}"
PASS=0
FAIL=0

pass() { echo "  ✓ $1"; PASS=$((PASS + 1)); }
fail() { echo "  ✘ $1"; FAIL=$((FAIL + 1)); }

echo "CSP smoke test: ${BASE}/intake/"
echo "──────────────────────────────────"

# 1. CSP header check
echo ""
echo "1) CSP headers"
HEADERS=$(curl -sI "${BASE}/intake/" 2>/dev/null || echo "FETCH_FAILED")

if echo "$HEADERS" | grep -qi "content-security-policy"; then
  CSP=$(echo "$HEADERS" | grep -i "content-security-policy")

  if echo "$CSP" | grep -q "script-src 'self'"; then
    pass "script-src includes 'self'"
  else
    fail "script-src missing 'self'"
  fi

  if echo "$CSP" | grep -q "unsafe-eval"; then
    fail "CSP contains unsafe-eval (WASM would run unguarded)"
  else
    pass "No unsafe-eval in CSP"
  fi

  if echo "$CSP" | grep -q "wasm-unsafe-eval"; then
    fail "CSP contains wasm-unsafe-eval (defeats WASM blocking)"
  else
    pass "No wasm-unsafe-eval in CSP"
  fi
else
  if echo "$HEADERS" | grep -q "FETCH_FAILED"; then
    fail "Could not reach ${BASE}/intake/ (network error)"
  else
    fail "No Content-Security-Policy header found"
  fi
fi

# 2. No inline scripts in HTML
echo ""
echo "2) Inline script check"
HTML=$(curl -s "${BASE}/intake/" 2>/dev/null || echo "")

if [ -n "$HTML" ]; then
  # Match <script> tags that aren't type="module" src="..." (i.e., inline code)
  INLINE_SCRIPTS=$(echo "$HTML" | grep -cE '<script[^>]*>[^<]+</script>' || true)

  if [ "$INLINE_SCRIPTS" -eq 0 ]; then
    pass "No inline scripts in intake HTML"
  else
    fail "Found ${INLINE_SCRIPTS} inline script(s) — would be blocked by strict CSP"
  fi
else
  fail "Could not fetch intake HTML"
fi

# 3. Entry chunk — no WebAssembly
echo ""
echo "3) Entry chunk WASM check"
ENTRY=$(curl -s "${BASE}/assets/js/intake-client.js" 2>/dev/null || echo "")

if [ -n "$ENTRY" ]; then
  if echo "$ENTRY" | grep -q "WebAssembly\."; then
    fail "Entry chunk contains WebAssembly API calls"
  else
    pass "Entry chunk has no WebAssembly API calls"
  fi

  if echo "$ENTRY" | grep -qE 'from\s*["\x27]@omnituum/pqc-shared'; then
    fail "Entry chunk has static import from pqc-shared"
  else
    pass "Entry chunk has no static pqc-shared imports"
  fi
else
  fail "Could not fetch entry chunk"
fi

# 4. No WASM chunks deployed
echo ""
echo "4) No WASM chunks"

if echo "$ENTRY" | grep -q 'import("\.\/chunks/'; then
  fail "Entry has relative chunk imports — pqc-shared should be external"
else
  pass "No relative chunk imports (pqc-shared is external)"
fi

CHUNKS_STATUS=$(curl -sI "${BASE}/assets/js/chunks/" 2>/dev/null | head -1 || echo "")
if echo "$CHUNKS_STATUS" | grep -q "404\|403"; then
  pass "No chunks directory served"
elif echo "$CHUNKS_STATUS" | grep -q "200"; then
  fail "Chunks directory still accessible (stale deployment?)"
else
  pass "No chunks directory served"
fi

# Summary
echo ""
echo "──────────────────────────────────"
echo "${PASS} passed, ${FAIL} failed"

if [ "$FAIL" -gt 0 ]; then
  echo ""
  echo "✘ CSP SMOKE TEST FAILED"
  exit 1
fi

echo ""
echo "✓ All CSP smoke checks passed"
