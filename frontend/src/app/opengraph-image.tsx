import { ImageResponse } from "next/og";

export const alt = "Mingly";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          alignItems: "center",
          background: "#f7f7f8",
          color: "#111214",
          display: "flex",
          height: "100%",
          justifyContent: "center",
          position: "relative",
          width: "100%",
        }}
      >
        <div style={{ border: "3px solid #111214", height: 486, position: "absolute", width: 1056 }} />
        <div style={{ alignItems: "center", display: "flex", flexDirection: "column", gap: 28, zIndex: 1 }}>
          <div style={{ display: "flex", height: 108, position: "relative", width: 116 }}>
            <div style={{ background: "#111214", borderRadius: 18, height: 54, left: 30, position: "absolute", top: 2, transform: "rotate(35deg)", width: 42 }} />
            <div style={{ background: "#111214", borderRadius: 18, height: 54, left: 4, position: "absolute", top: 43, transform: "rotate(-26deg)", width: 42 }} />
            <div style={{ background: "#111214", borderRadius: 18, height: 54, left: 67, position: "absolute", top: 51, transform: "rotate(38deg)", width: 42 }} />
          </div>
          <div style={{ fontSize: 72, fontWeight: 700, letterSpacing: -3 }}>Mingly</div>
          <div style={{ color: "#575a60", fontSize: 28 }}>Private rooms for people you know.</div>
        </div>
        <div style={{ bottom: 44, color: "#575a60", display: "flex", fontSize: 22, position: "absolute" }}>mingly.site</div>
      </div>
    ),
    size,
  );
}
