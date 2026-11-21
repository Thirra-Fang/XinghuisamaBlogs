import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 自托管（Debian 等）用 standalone 精简运行时；勿与 output: 'export' 同时开启
  output: "standalone",

  // 🚨 关掉纯静态导出，保留 API 路由（Vercel / Node 自托管均需要）
  // output: 'export',

  // 🚨 Vercel / 反代场景不强制 trailingSlash，避免 API 路径匹配问题
  // trailingSlash: true,

  images: {
    unoptimized: true,
  },
  typescript: {
    ignoreBuildErrors: true, // 忽略 TS 错误，方便快速部署
  },
};

export default nextConfig;