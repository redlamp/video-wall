import type { NextConfig } from "next";

const isGitHubPages = process.env.GITHUB_PAGES === "true";

const nextConfig: NextConfig = {
  output: "export",
  env: {
    NEXT_PUBLIC_BASE_PATH: isGitHubPages ? "/video-wall" : "",
  },
  images: {
    unoptimized: true,
  },
  ...(isGitHubPages
    ? {
        basePath: "/video-wall",
        assetPrefix: "/video-wall/",
      }
    : {}),
};

export default nextConfig;
