import type { NextConfig } from "next";

// Static security headers applied to every route. A full Content-Security-Policy
// is intentionally not set here yet: the room page talks to Supabase, the Go
// API, LiveKit (wss) and embeds the YouTube iframe API, so a script/connect
// allow-list needs to be rolled out in report-only mode first.
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains",
  },
  // Clickjacking protection (modern replacement for X-Frame-Options).
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
  { key: "X-Frame-Options", value: "DENY" },
  {
    // Rooms need camera, microphone and screen capture on our own origin only.
    // Autoplay/fullscreen are left at browser defaults so the YouTube embed keeps working.
    key: "Permissions-Policy",
    value:
      "camera=(self), microphone=(self), display-capture=(self), geolocation=(), payment=(), usb=(), browsing-topics=()",
  },
];

const nextConfig: NextConfig = {
  allowedDevOrigins: ["localhost", "127.0.0.1"],
  poweredByHeader: false,
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      {
        source: "/admin/:path*",
        headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }],
      },
      {
        source: "/:path*",
        has: [{ type: "host", value: "admin.mingly.site" }],
        headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }],
      },
    ];
  },
  async rewrites() {
    return {
      beforeFiles: [
        {
          source: "/",
          destination: "/admin",
          has: [{ type: "host", value: "admin.mingly.site" }],
        },
      ],
    };
  },
};

export default nextConfig;
