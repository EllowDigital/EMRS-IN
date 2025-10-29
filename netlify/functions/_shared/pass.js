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
<svg width="720" height="1120" viewBox="0 0 720 1120" fill="none" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="headerGradient" x1="0" y1="0" x2="720" y2="320" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#081cce" />
      <stop offset="1" stop-color="#012087" />
    </linearGradient>
    <linearGradient id="bodyGradient" x1="0" y1="320" x2="0" y2="1120" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#ffffff" />
      <stop offset="1" stop-color="#f3f6fb" />
    </linearGradient>
    <linearGradient id="photoFallback" x1="0" y1="0" x2="180" y2="180" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#7aa6ff" />
      <stop offset="1" stop-color="#1c4ed8" />
    </linearGradient>
    <filter id="cardShadow" x="-6%" y="-4%" width="112%" height="112%" color-interpolation-filters="sRGB">
      <feDropShadow dx="0" dy="18" stdDeviation="32" flood-color="#0f172a" flood-opacity="0.18" />
    </filter>
    <pattern id="dotPattern" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="scale(1,1)">
      <circle cx="4" cy="4" r="1" fill="#cbd5f5" />
    </pattern>
    <clipPath id="photoMask">
      <circle cx="190" cy="590" r="150" />
    </clipPath>
  </defs>

  <rect width="720" height="1120" rx="44" fill="#e5ebf7" />
  <rect x="20" y="20" width="680" height="1080" rx="40" fill="#ffffff" />
  <rect x="20" y="20" width="680" height="360" rx="40" fill="url(#headerGradient)" />
  <rect x="60" y="66" width="600" height="24" rx="12" fill="#0f1f62" opacity="0.55" />
  <rect x="176" y="36" width="368" height="36" rx="18" fill="#101d60" opacity="0.55" />

  <text x="360" y="190" text-anchor="middle" fill="#ffffff" font-size="96" font-family="'Roboto', sans-serif" font-weight="900" letter-spacing="0.12em">E-PASS</text>
  <rect x="20" y="360" width="680" height="740" rx="40" fill="url(#bodyGradient)" />

  <g filter="url(#cardShadow)">
    <rect x="70" y="420" width="580" height="600" rx="36" fill="#ffffff" />
  </g>

  <line x1="360" y1="470" x2="360" y2="970" stroke="#d0d8ee" stroke-width="2" stroke-dasharray="10 12" />

  <g clip-path="url(#photoMask)">
    <rect x="40" y="440" width="300" height="300" fill="url(#photoFallback)" />
    ${safeProfile ? `<image href="${safeProfile}" x="40" y="440" width="300" height="300" preserveAspectRatio="xMidYMid slice" />` : `<text x="190" y="620" fill="#ffffff" font-size="128" font-family="'Inter', sans-serif" font-weight="700" text-anchor="middle">${safeInitial}</text>`}
  </g>
  <circle cx="190" cy="590" r="158" stroke="#0b1f82" stroke-width="6" fill="transparent" />

  <text x="60" y="760" fill="#1f2937" font-size="28" font-family="'Inter', sans-serif" font-weight="700">Reg. ID:</text>
  <text x="200" y="760" fill="#e11d48" font-size="30" font-family="'Inter', sans-serif" font-weight="800">${safeReg}</text>
  <text x="60" y="810" fill="#1f2937" font-size="26" font-family="'Inter', sans-serif" font-weight="700">Name:</text>
  <text x="160" y="810" fill="#0f172a" font-size="28" font-family="'Inter', sans-serif" font-weight="800">${safeName.toUpperCase()}</text>

  <rect x="400" y="510" width="240" height="240" rx="28" fill="#f8fafc" stroke="#d4dcf4" stroke-width="4" />
  ${safeQr ? `<image href="${safeQr}" x="412" y="522" width="216" height="216" preserveAspectRatio="xMidYMid meet" />` : ''}
  <text x="520" y="770" text-anchor="middle" fill="#0f172a" font-size="20" font-family="'Inter', sans-serif" font-weight="600">Scan at venue</text>

  <rect x="70" y="880" width="580" height="120" rx="24" fill="#edf2fb" />
  <text x="100" y="940" fill="#1f2937" font-size="22" font-family="'Inter', sans-serif" font-weight="600">Instructions</text>
  <text x="100" y="980" fill="#4b5563" font-size="18" font-family="'Inter', sans-serif">• Carry a government-issued ID matching this pass.</text>
  <text x="100" y="1010" fill="#4b5563" font-size="18" font-family="'Inter', sans-serif">• Arrive 15 minutes early for verification.</text>

  <rect x="20" y="1020" width="680" height="80" rx="32" fill="#041579" />
  <text x="360" y="1074" text-anchor="middle" fill="#ffffff" font-size="28" font-family="'Inter', sans-serif" font-weight="700">VENUE DETAILS</text>
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
