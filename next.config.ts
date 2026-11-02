import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: { root: dirname(fileURLToPath(import.meta.url)) },
  allowedDevOrigins: process.env.PRAMAAN_DRAFT_HOST ? [process.env.PRAMAAN_DRAFT_HOST] : undefined,
  // #1172: no other site may frame the app (clickjacking the owner's one-click controls). A draft is framed by
  // Pramaan's own page, and only a draft has PRAMAAN_DRAFT_HOST.
  headers: async () =>
    process.env.PRAMAAN_DRAFT_HOST
      ? []
      : [
          {
            source: "/:path*",
            headers: [
              { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
              { key: "X-Frame-Options", value: "DENY" },
            ],
          },
        ],
};

export default nextConfig;
