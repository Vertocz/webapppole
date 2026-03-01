/** @type {import('next').NextConfig} */
const nextConfig = {
  // pdf-parse utilise des modules Node.js natifs — on l'exclut du bundle client
  webpack: (config, { isServer }) => {
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false, path: false, stream: false, crypto: false,
      };
    }
    return config;
  },
};

module.exports = nextConfig;
