// ── Load published checksums on page load ───────────────────
const checksums = new Map();

(async () => {
  try {
    const res = await fetch('/defense/sha/checksums.txt');
    const text = await res.text();
    for (const line of text.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const match = trimmed.match(/^([0-9a-f]{64})\s{2}(.+)$/);
      if (match) checksums.set(match[1], match[2]);
    }
  } catch {
    // Checksums unavailable — tool will report mismatch for all files
  }
})();

// ── DOM refs ────────────────────────────────────────────────
const dropZone = document.getElementById('dropZone');
const fileInput = document.getElementById('fileInput');
const hashingEl = document.getElementById('hashing');
const resultEl = document.getElementById('result');
const resultFilename = document.getElementById('resultFilename');
const resultHash = document.getElementById('resultHash');
const resultStatus = document.getElementById('resultStatus');
const resultDetail = document.getElementById('resultDetail');

// ── Drop zone interactions ──────────────────────────────────
dropZone.addEventListener('click', () => fileInput.click());

dropZone.addEventListener('dragover', (e) => {
  e.preventDefault();
  dropZone.classList.add('dragover');
});

dropZone.addEventListener('dragleave', () => {
  dropZone.classList.remove('dragover');
});

dropZone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropZone.classList.remove('dragover');
  const file = e.dataTransfer.files[0];
  if (file) verifyFile(file);
});

fileInput.addEventListener('change', () => {
  const file = fileInput.files[0];
  if (file) verifyFile(file);
  fileInput.value = '';
});

// ── Verify file ─────────────────────────────────────────────
async function verifyFile(file) {
  resultEl.classList.remove('visible');
  hashingEl.classList.add('visible');

  try {
    const buffer = await file.arrayBuffer();
    const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

    hashingEl.classList.remove('visible');

    resultFilename.textContent = file.name;
    resultHash.textContent = 'SHA-256: ' + hex;

    const matchedName = checksums.get(hex);
    if (matchedName) {
      resultStatus.className = 'result-status match';
      resultStatus.textContent = 'Verified: matches published checksum.';
      resultDetail.textContent = 'Document: ' + matchedName;
    } else {
      resultStatus.className = 'result-status mismatch';
      resultStatus.textContent = 'No match found.';
      resultDetail.textContent = 'This file does not match any published artifact for this portal.';
    }

    resultEl.classList.add('visible');
  } catch {
    hashingEl.classList.remove('visible');
    resultFilename.textContent = file.name;
    resultHash.textContent = '';
    resultStatus.className = 'result-status mismatch';
    resultStatus.textContent = 'Error computing hash.';
    resultDetail.textContent = '';
    resultEl.classList.add('visible');
  }
}
