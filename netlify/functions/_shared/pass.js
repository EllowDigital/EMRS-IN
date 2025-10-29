import QRCode from 'qrcode';

function escapeXml(value = '') {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

function sanitizeDataUrl(dataUrl = '') {
    return dataUrl.replace(/"/g, '&quot;');
}

export function buildEpassSvg({ name, registrationId, profileUrl, qrDataUrl }) {
    const safeName = escapeXml(name).slice(0, 42);
    const safeReg = escapeXml(registrationId);
    const safeProfile = profileUrl ? escapeXml(profileUrl) : null;
    const safeInitial = escapeXml(((name || '').trim().charAt(0) || 'E').toUpperCase());
    const safeQr = qrDataUrl ? sanitizeDataUrl(qrDataUrl) : null;

    return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="720" height="420" viewBox="0 0 720 420" fill="none" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="720" y2="420" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#1236d0" />
      <stop offset="1" stop-color="#061442" />
    </linearGradient>
    <linearGradient id="card" x1="120" y1="60" x2="672" y2="360" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#0f1d4c" />
      <stop offset="0.58" stop-color="#0b1739" />
      <stop offset="1" stop-color="#09122c" />
    </linearGradient>
    <linearGradient id="badge" x1="0" y1="0" x2="280" y2="40" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#facc15" />
      <stop offset="1" stop-color="#fb8c1a" />
    </linearGradient>
    <radialGradient id="cornerGlow" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse"
      gradientTransform="translate(640 50) rotate(45) scale(180 150)">
      <stop offset="0" stop-color="#90c0ff" stop-opacity="0.85" />
      <stop offset="1" stop-color="#061129" stop-opacity="0" />
    </linearGradient>
    <linearGradient id="avatarFallback" x1="110" y1="150" x2="250" y2="290" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#6aa9ff" />
      <stop offset="1" stop-color="#205bff" />
    </linearGradient>
    <filter id="cardShadow" x="-12%" y="-18%" width="150%" height="170%" color-interpolation-filters="sRGB">
      <feDropShadow dx="0" dy="20" stdDeviation="32" flood-color="#030712" flood-opacity="0.55" />
    </filter>
    <clipPath id="avatarMask">
      <circle cx="208" cy="206" r="88" />
    </clipPath>
  </defs>
  <rect width="720" height="420" rx="36" fill="url(#bg)" />
  <circle cx="656" cy="56" r="120" fill="url(#cornerGlow)" />
  <path d="M0 312 L160 168 C214 122 294 112 352 152 L456 224 C516 266 592 254 640 210 L720 136 L720 420 L0 420 Z"
    fill="rgba(12, 32, 84, 0.45)" />
  <g filter="url(#cardShadow)">
    <rect x="72" y="66" width="576" height="288" rx="34" fill="url(#card)" />
    <rect x="72" y="66" width="576" height="288" rx="34" stroke="rgba(255,255,255,0.08)" stroke-width="1.6" fill="none" />
  </g>
  <rect x="110" y="104" width="198" height="40" rx="20" fill="#1c4af5" />
  <text x="209" y="130" fill="#ffffff" font-size="18" font-family="'Inter', sans-serif" font-weight="600" text-anchor="middle">EMRS DIGITAL PASS</text>

  <g clip-path="url(#avatarMask)">
    <rect x="120" y="118" width="176" height="176" fill="url(#avatarFallback)" />
    ${safeProfile ? `<image href="${safeProfile}" x="120" y="118" width="176" height="176" preserveAspectRatio="xMidYMid slice"/>` : `<text x="208" y="220" fill="#ffffff" font-size="72" font-family="'Inter', sans-serif" font-weight="700" text-anchor="middle">${safeInitial}</text>`}
  </g>
  <circle cx="208" cy="206" r="96" stroke="rgba(182, 200, 255, 0.55)" stroke-width="3" fill="transparent" stroke-dasharray="11 7" />

  <text x="320" y="156" fill="#e3edff" font-size="32" font-family="'Inter', sans-serif" font-weight="700">Event Visitor Access</text>
  <text x="320" y="186" fill="#c5d5fb" font-size="17" font-family="'Inter', sans-serif">Show this pass with a valid photo ID at entry</text>

  <rect x="320" y="202" width="276" height="42" rx="21" fill="url(#badge)" />
  <text x="458" y="230" fill="#0f172a" font-size="18" font-family="'Inter', sans-serif" font-weight="700" text-anchor="middle">MRS 2025 | ENTRY AUTHORIZE</text>

  <rect x="320" y="252" width="276" height="112" rx="26" fill="#0a1636" stroke="rgba(255,255,255,0.16)" stroke-width="1.2" />
  <text x="344" y="298" fill="#f8fafc" font-size="28" font-family="'Inter', sans-serif" font-weight="600">${safeName}</text>
  <text x="344" y="326" fill="#cbd5f5" font-size="16" font-family="'Inter', sans-serif" font-weight="500">Registration ID</text>
  <text x="344" y="352" fill="#f9c51f" font-size="30" font-family="'Inter', sans-serif" font-weight="700">${safeReg}</text>

  <rect x="620" y="220" width="90" height="126" rx="26" fill="rgba(10, 20, 45, 0.82)" stroke="rgba(255,255,255,0.16)" stroke-width="1.2" />
  ${safeQr ? `<image href="${safeQr}" x="628" y="228" width="74" height="74" preserveAspectRatio="xMidYMid meet" />` : ''}
  <text x="665" y="318" fill="#cbd5f5" font-size="11" font-family="'Inter', sans-serif" text-anchor="middle">SCAN</text>

  <text x="120" y="338" fill="#dde7ff" font-size="14" font-family="'Inter', sans-serif">Venue: EMRS Convention Center • Access Window: 09:00 - 18:00</text>
  <text x="120" y="360" fill="#8aa0d1" font-size="12" font-family="'Inter', sans-serif">Pass valid for single entry. Do not fold or share screenshots publicly.</text>
</svg>`;
}

export async function buildPassData({ name, registrationId, profileUrl }) {
    let qrDataUrl = '';
    try {
    qrDataUrl = await QRCode.toDataURL(JSON.stringify({ registrationId, name }), {
            width: 256,
            margin: 0,
            color: {
                dark: '#0f172a',
        light: '#ffffff',
            },
        });
    } catch (error) {
        console.warn('Unable to generate QR code', error);
    }

    const svg = buildEpassSvg({ name, registrationId, profileUrl, qrDataUrl });
    const dataUrl = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;

    return { svg, dataUrl, qrDataUrl };
}
