import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Корень проекта задан явно: иначе Turbopack поднимается вверх по дереву
  // в поисках lockfile и находит чужой package-lock.json выше репозитория.
  turbopack: {
    root: import.meta.dirname,
  },
};

export default nextConfig;
