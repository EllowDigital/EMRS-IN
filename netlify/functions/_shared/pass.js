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
    <linearGradient id="headerGradient" x1="0" y1="0" x2="720" y2="360" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#0a24d9" />
      <stop offset="1" stop-color="#05208d" />
    </linearGradient>
    <linearGradient id="bodyGradient" x1="0" y1="360" x2="0" y2="1120" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#ffffff" />
      <stop offset="1" stop-color="#f2f6ff" />
    </linearGradient>
    <linearGradient id="photoFallback" x1="0" y1="0" x2="220" y2="220" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#7aa6ff" />
      <stop offset="1" stop-color="#1b48d2" />
    </linearGradient>
    <filter id="cardShadow" x="-8%" y="-6%" width="120%" height="120%" color-interpolation-filters="sRGB">
      <feDropShadow dx="0" dy="20" stdDeviation="28" flood-color="#0f172a" flood-opacity="0.18" />
    </filter>
    <clipPath id="photoMask">
      <circle cx="210" cy="560" r="140" />
    </clipPath>
  </defs>

  <rect width="720" height="1120" rx="44" fill="#e9efff" />
  <rect x="24" y="24" width="672" height="1072" rx="38" fill="#ffffff" />
  <rect x="24" y="24" width="672" height="360" rx="38" fill="url(#headerGradient)" />
  <rect x="180" y="64" width="360" height="32" rx="16" fill="#0b1d74" opacity="0.55" />
  <rect x="120" y="96" width="480" height="20" rx="10" fill="#0b1d74" opacity="0.35" />

  <text x="360" y="198" text-anchor="middle" fill="#ffffff" font-size="96" font-family="'Roboto', sans-serif" font-weight="900" letter-spacing="0.14em">E-PASS</text>
  <rect x="24" y="360" width="672" height="736" rx="38" fill="url(#bodyGradient)" />

  <g filter="url(#cardShadow)">
    <rect x="64" y="400" width="592" height="616" rx="34" fill="#ffffff" />
  </g>
  <line x1="360" y1="440" x2="360" y2="936" stroke="#d5dcf0" stroke-width="2" stroke-dasharray="10 12" />

  <g clip-path="url(#photoMask)">
    <rect x="70" y="420" width="280" height="280" fill="url(#photoFallback)" />
    ${safeProfile ? `<image href="${safeProfile}" x="70" y="420" width="280" height="280" preserveAspectRatio="xMidYMid slice" />` : `<text x="210" y="600" fill="#ffffff" font-size="116" font-family="'Inter', sans-serif" font-weight="700" text-anchor="middle">${safeInitial}</text>`}
  </g>
  <circle cx="210" cy="560" r="148" stroke="#0b2790" stroke-width="6" fill="transparent" />

  <text x="92" y="748" fill="#1f2937" font-size="30" font-family="'Inter', sans-serif" font-weight="700">Reg. ID:</text>
  <text x="220" y="748" fill="#e3263f" font-size="32" font-family="'Inter', sans-serif" font-weight="800">${safeReg}</text>
  <text x="92" y="804" fill="#1f2937" font-size="28" font-family="'Inter', sans-serif" font-weight="700">Name:</text>
  <text x="188" y="804" fill="#0f172a" font-size="30" font-family="'Inter', sans-serif" font-weight="800">${safeName.toUpperCase()}</text>

  <rect x="408" y="456" width="232" height="232" rx="26" fill="#f8fbff" stroke="#d4dcf4" stroke-width="4" />
  ${safeQr ? `<image href="${safeQr}" x="420" y="468" width="208" height="208" preserveAspectRatio="xMidYMid meet" />` : ''}
  <text x="524" y="720" text-anchor="middle" fill="#0f172a" font-size="20" font-family="'Inter', sans-serif" font-weight="600">Scan at venue</text>

  <text x="92" y="864" fill="#4b5563" font-size="20" font-family="'Inter', sans-serif">Show this pass with a valid photo ID at the gate.</text>
  <text x="92" y="902" fill="#4b5563" font-size="20" font-family="'Inter', sans-serif">QR verification is required for entry and re-entry.</text>

  <rect x="64" y="952" width="592" height="116" rx="28" fill="#041b7b" />
  <text x="360" y="1010" text-anchor="middle" fill="#ffffff" font-size="26" font-family="'Inter', sans-serif" font-weight="700">VENUE DETAILS</text>
  <text x="360" y="1046" text-anchor="middle" fill="#dbe4ff" font-size="20" font-family="'Inter', sans-serif" font-weight="500">'Access opens between 09:00 and 18:00. Arrive inspired.'</text>
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
