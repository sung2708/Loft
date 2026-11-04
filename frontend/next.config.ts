import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["localhost", "127.0.0.1"],
  async rewrites() {
    return [
      {
        source: "/",
        destination: "/admin",
        has: [{ type: "host", value: "admin.mingly.site" }],
      },
    ];
  },
};

export default nextConfig;
