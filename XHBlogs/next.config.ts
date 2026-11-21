import type { NextConfig } from "next";

const isStaticExport =
  process.env.STATIC_EXPORT === "1" ||
  process.env.NEXT_PUBLIC_STATIC_EXPORT === "1";

const nextConfig: NextConfig = {
  // STATIC_EXPORT=1 → pure HTML for nginx; otherwise standalone for Node self-host
  output: isStaticExport ? "export" : "standalone",

  ...(isStaticExport
    ? {
        trailingSlash: true,
      }
    : {}),

  images: {
    unoptimized: true,
  },
  typescript: {
    ignoreBuildErrors: true,
  },
};

export default nextConfig;
