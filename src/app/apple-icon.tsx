import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";
export default function AppleIcon() {
  return new ImageResponse(
    <div style={{ display: "flex", width: "100%", height: "100%", background: "#213c46", alignItems: "center", justifyContent: "center" }}>
      <svg width="140" height="140" viewBox="0 0 192 192">
        <path d="M96 143C18 99 53 40 96 76C139 40 174 99 96 143Z" fill="#d2e8b5" />
        <path d="M96 76V130" stroke="#213c46" strokeWidth="5" strokeLinecap="round" />
      </svg>
    </div>,
    size,
  );
}
