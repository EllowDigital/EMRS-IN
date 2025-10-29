function escapeXml(value = '') {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function buildEpassSvg({ name, registrationId, profileUrl }) {
  const safeName = escapeXml(name).slice(0, 42);
  const safeReg = escapeXml(registrationId);
  const safeProfile = profileUrl ? escapeXml(profileUrl) : null;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="720" height="420" viewBox="0 0 720 420" fill="none" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="pass-gradient" x1="0" y1="0" x2="720" y2="420" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#1d4ed8"/>
      <stop offset="1" stop-color="#0b173d"/>
    </linearGradient>
    <linearGradient id="accent" x1="0" y1="0" x2="360" y2="220" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#f97316" stop-opacity="0.95"/>
      <stop offset="1" stop-color="#fb923c" stop-opacity="0.75"/>
    </linearGradient>
    <clipPath id="avatar-mask">
      <circle cx="150" cy="210" r="88" />
    </clipPath>
  </defs>
  <rect width="720" height="420" rx="30" fill="url(#pass-gradient)" />
  <path d="M520 30 C620 70 640 120 690 160 L690 390 L40 390 Z" fill="rgba(15, 23, 42, 0.55)" />
  <rect x="40" y="50" width="640" height="320" rx="26" fill="rgba(255,255,255,0.08)" stroke="rgba(255,255,255,0.16)" stroke-width="1.6" />
  <rect x="60" y="70" width="180" height="32" rx="16" fill="rgba(37, 99, 235, 0.9)" />
  <text x="150" y="92" fill="#ffffff" font-size="16" font-family="'Inter', sans-serif" font-weight="600" text-anchor="middle">EMRS DIGITAL PASS</text>
  <text x="60" y="130" fill="#bae6fd" font-size="30" font-family="'Inter', sans-serif" font-weight="700">Event Visitor Access</text>
  <text x="60" y="162" fill="#e2e8f0" font-size="16" font-family="'Inter', sans-serif">Show this pass along with a valid photo ID at entry</text>
  <g clip-path="url(#avatar-mask)">
    <rect x="62" y="122" width="176" height="176" fill="rgba(15, 23, 42, 0.6)" />
    ${safeProfile ? `<image href="${safeProfile}" x="62" y="122" width="176" height="176" preserveAspectRatio="xMidYMid slice"/>` : ''}
  </g>
  <circle cx="150" cy="210" r="94" stroke="rgba(148, 163, 184, 0.45)" stroke-width="2.4" fill="transparent" stroke-dasharray="12 6" />
  <rect x="260" y="180" width="360" height="140" rx="22" fill="rgba(8, 12, 34, 0.55)" stroke="rgba(255,255,255,0.18)" />
  <text x="280" y="230" fill="#f8fafc" font-size="26" font-family="'Inter', sans-serif" font-weight="600">${safeName}</text>
  <text x="280" y="258" fill="#cbd5f5" font-size="16" font-family="'Inter', sans-serif" font-weight="500">Registration ID</text>
  <text x="280" y="292" fill="#facc15" font-size="28" font-family="'Inter', sans-serif" font-weight="700">${safeReg}</text>
  <rect x="260" y="120" width="240" height="34" rx="17" fill="url(#accent)" />
  <text x="380" y="143" text-anchor="middle" fill="#0f172a" font-size="17" font-family="'Inter', sans-serif" font-weight="700">EMRS 2025 | ENTRY AUTHORIZED</text>
  <text x="60" y="340" fill="#e0e7ff" font-size="14" font-family="'Inter', sans-serif">Venue: EMRS Convention Center • Access Window: 09:00 - 18:00</text>
  <text x="60" y="362" fill="#94a3b8" font-size="12" font-family="'Inter', sans-serif">Pass valid for single entry. Do not fold or share screenshots publicly.</text>
</svg>`;
}

export function buildPassData({ name, registrationId, profileUrl }) {
  const svg = buildEpassSvg({ name, registrationId, profileUrl });
  const dataUrl = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
  return { svg, dataUrl };
}
