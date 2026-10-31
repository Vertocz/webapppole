import type { NextConfig } from "next";

// Identifiant de version : sert à mettre à jour le service worker (et donc à
// vider l'ancien cache hors ligne) à chaque déploiement.
const appVersion =
  process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 8) ?? Date.now().toString(36);

const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_APP_VERSION: appVersion,
  },
};

export default nextConfig;
