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
  const safeInitial = escapeXml(((name || '').trim().charAt(0) || 'E').toUpperCase());

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="720" height="420" viewBox="0 0 720 420" fill="none" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="48" y1="0" x2="720" y2="420" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#1d4ed8" />
      <stop offset="1" stop-color="#0b173d" />
    </linearGradient>
    <linearGradient id="card-surface" x1="48" y1="60" x2="660" y2="360" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#102155" />
      <stop offset="1" stop-color="#0b1536" />
    </linearGradient>
    <linearGradient id="card-overlay" x1="48" y1="60" x2="360" y2="260" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#1f3f91" stop-opacity="0.55" />
      <stop offset="1" stop-color="#09112c" stop-opacity="0.4" />
    </linearGradient>
    <linearGradient id="badge" x1="0" y1="0" x2="260" y2="36" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#facc15" />
      <stop offset="1" stop-color="#fb923c" />
    </linearGradient>
    <linearGradient id="avatar-fallback" x1="74" y1="150" x2="226" y2="302" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#60a5fa" />
      <stop offset="1" stop-color="#2563eb" />
    </linearGradient>
    <radialGradient id="bg-glow" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(640 40) rotate(45) scale(160 140)">
      <stop offset="0" stop-color="#93c5fd" stop-opacity="0.9" />
      <stop offset="1" stop-color="#0f172a" stop-opacity="0" />
    </radialGradient>
    <filter id="card-shadow" x="-10%" y="-15%" width="140%" height="160%" color-interpolation-filters="sRGB">
      <feDropShadow dx="0" dy="18" stdDeviation="28" flood-color="#0b1128" flood-opacity="0.38" />
    </filter>
    <clipPath id="avatar-mask">
      <circle cx="150" cy="226" r="76" />
    </clipPath>
  </defs>
  <rect width="720" height="420" rx="32" fill="url(#bg)" />
  <circle cx="640" cy="40" r="110" fill="url(#bg-glow)" />
  <path d="M520 18 C610 60 650 120 690 180 L690 402 L30 402 Z" fill="#0b1735" fill-opacity="0.35" />
  <g filter="url(#card-shadow)">
    <rect x="48" y="60" width="624" height="300" rx="28" fill="url(#card-surface)" />
    <rect x="48" y="60" width="624" height="300" rx="28" fill="url(#card-overlay)" />
    <rect x="48" y="60" width="624" height="300" rx="28" stroke="rgba(255,255,255,0.18)" stroke-width="1.4" fill="none" />
  </g>
  <rect x="70" y="90" width="190" height="34" rx="17" fill="#2563eb" />
  <text x="165" y="112" fill="#ffffff" font-size="16" font-family="'Inter', sans-serif" font-weight="600" text-anchor="middle">EMRS DIGITAL PASS</text>
  <text x="70" y="152" fill="#e2e8f0" font-size="30" font-family="'Inter', sans-serif" font-weight="700">Event Visitor Access</text>
  <text x="70" y="182" fill="#cbd5f5" font-size="16" font-family="'Inter', sans-serif">Show this pass with a valid photo ID at entry</text>
  <g clip-path="url(#avatar-mask)">
    <rect x="74" y="150" width="152" height="152" fill="url(#avatar-fallback)" />
    ${safeProfile ? `<image href="${safeProfile}" x="74" y="150" width="152" height="152" preserveAspectRatio="xMidYMid slice"/>` : `<text x="150" y="235" fill="#ffffff" font-size="64" font-family="'Inter', sans-serif" font-weight="700" text-anchor="middle">${safeInitial}</text>`}
  </g>
  <circle cx="150" cy="226" r="80" stroke="rgba(202, 213, 255, 0.55)" stroke-width="2.6" fill="transparent" stroke-dasharray="10 6" />
  <rect x="280" y="154" width="260" height="36" rx="18" fill="url(#badge)" />
  <text x="410" y="177" text-anchor="middle" fill="#0f172a" font-size="17" font-family="'Inter', sans-serif" font-weight="700">EMRS 2025 | ENTRY AUTHORIZED</text>
  <rect x="280" y="206" width="320" height="126" rx="22" fill="#0b1735" fill-opacity="0.78" stroke="rgba(255,255,255,0.16)" />
  <text x="300" y="248" fill="#f8fafc" font-size="28" font-family="'Inter', sans-serif" font-weight="600">${safeName}</text>
  <text x="300" y="276" fill="#cbd5f5" font-size="16" font-family="'Inter', sans-serif" font-weight="500">Registration ID</text>
  <text x="300" y="306" fill="#facc15" font-size="30" font-family="'Inter', sans-serif" font-weight="700">${safeReg}</text>
  <text x="70" y="338" fill="#e0e7ff" font-size="14" font-family="'Inter', sans-serif">Venue: EMRS Convention Center • Access Window: 09:00 - 18:00</text>
  <text x="70" y="360" fill="#94a3b8" font-size="12" font-family="'Inter', sans-serif">Pass valid for single entry. Do not fold or share screenshots publicly.</text>
</svg>`;
}

export function buildPassData({ name, registrationId, profileUrl }) {
  const svg = buildEpassSvg({ name, registrationId, profileUrl });
  const dataUrl = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
  return { svg, dataUrl };
}
