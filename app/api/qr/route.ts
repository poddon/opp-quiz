import { env } from "cloudflare:workers";
import QRCode from "qrcode";
import { apiError, normalizeRoomCode } from "@/lib/api";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const room = normalizeRoomCode(url.searchParams.get("room"));
  if (!room) return apiError("Не указан код комнаты");
  const configuredOrigin = env.PUBLIC_SITE_URL?.trim().replace(/\/+$/, "");
  const joinUrl = `${configuredOrigin || url.origin}/?room=${encodeURIComponent(room)}`;
  const svg = await QRCode.toString(joinUrl, {
    type: "svg",
    errorCorrectionLevel: "M",
    margin: 1,
    color: { dark: "#003C7E", light: "#FFFFFF" },
    width: 512,
  });
  return new Response(svg, {
    headers: {
      "Content-Type": "image/svg+xml; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Quiz-Join-Url": joinUrl,
    },
  });
}
