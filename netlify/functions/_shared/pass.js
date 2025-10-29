import QRCode from "qrcode";

export async function buildPassData({ name, registrationId }) {
  const payload = {
    registrationId,
    name,
  };

  let qrDataUrl = "";
  try {
    qrDataUrl = await QRCode.toDataURL(JSON.stringify(payload), {
      width: 256,
      margin: 0,
      color: {
        dark: "#0f172a",
        light: "#ffffff",
      },
    });
  } catch (error) {
    console.warn("Unable to generate QR code", error);
  }

  return {
    qrDataUrl,
    payload,
  };
}
