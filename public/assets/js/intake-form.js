import { createPilotAccessClient } from '/assets/js/intake-client.js';

// ── Config ──────────────────────────────────────────────────
const client = createPilotAccessClient({
  endpoint: 'https://secure-intake.pages.dev/api/intake',
  requireKyber: false,
  attemptHybrid: false, // strict CSP — skip WASM entirely, X25519-only
  publicKeys: {
    x25519PubHex: 'bebc2a4a3826f20e389c2236a5c4ea55222e70e33a1bf03f873436b079256b64',
    kyberPubB64: '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',
  },
});

// ── DOM refs ────────────────────────────────────────────────
const form = document.getElementById('intakeForm');
const errorBanner = document.getElementById('errorBanner');
const successState = document.getElementById('successState');
const submitBtn = document.getElementById('submitBtn');
const btnLabel = document.getElementById('btnLabel');
const btnArrow = document.getElementById('btnArrow');
const btnSpinner = document.getElementById('btnSpinner');
const cryptoBadge = document.getElementById('cryptoBadge');
const honeypot = document.getElementById('f-website');

// ── Compliance chip toggles ─────────────────────────────────
const selectedCompliance = new Set();

document.getElementById('complianceChips').addEventListener('click', (e) => {
  const chip = e.target.closest('.chip');
  if (!chip) return;
  const val = chip.dataset.value;
  if (selectedCompliance.has(val)) {
    selectedCompliance.delete(val);
    chip.classList.remove('active');
  } else {
    selectedCompliance.add(val);
    chip.classList.add('active');
  }
});

// ── Crypto capability badge ──────────────────────────────────
(async () => {
  try {
    const cap = await client.checkCryptoCapability();
    if (!cap.webCrypto) {
      cryptoBadge.textContent = 'Encryption unavailable — update your browser';
    } else {
      // attemptHybrid:false — X25519 by design (strict CSP, no WASM)
      cryptoBadge.innerHTML = 'Protected by <span class="pq">X25519 end-to-end encryption</span>';
    }
  } catch {
    cryptoBadge.textContent = 'End-to-end encrypted';
  }
})();

// ── Form submission ─────────────────────────────────────────
form.addEventListener('submit', async (e) => {
  e.preventDefault();
  errorBanner.classList.remove('visible');

  // Clean URL if query params leaked from a previous attempt
  if (window.location.search) {
    history.replaceState(null, '', '/intake/');
  }

  const formData = {
    email: document.getElementById('f-email').value.trim(),
    company: document.getElementById('f-company').value.trim(),
    system: document.getElementById('f-system').value.trim(),
    useCase: document.getElementById('f-usecase').value,
    timeline: document.getElementById('f-timeline').value,
    compliance: [...selectedCompliance].sort(),
  };

  // Basic validation
  if (!formData.email || !formData.company || !formData.useCase) {
    showError('Please fill in all required fields.');
    return;
  }

  setLoading(true);

  try {
    const result = await client.submit(formData, 'request_pilot_access', honeypot.value || undefined);

    if (result.ok) {
      form.style.display = 'none';
      successState.classList.add('visible');
      history.replaceState(null, '', '/intake/');
    } else {
      showError(result.error || 'Submission failed. Please try again.');
    }
  } catch (err) {
    showError(err.message || 'An unexpected error occurred. Please try again.');
  } finally {
    setLoading(false);
  }
});

function setLoading(on) {
  submitBtn.disabled = on;
  btnLabel.textContent = on ? 'Encrypting & Submitting...' : 'Submit Secure Inquiry';
  btnArrow.style.display = on ? 'none' : 'block';
  btnSpinner.style.display = on ? 'block' : 'none';
}

function showError(msg) {
  errorBanner.textContent = msg;
  errorBanner.classList.add('visible');
}
