/// <reference types="vitest/config" />
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      tsconfigPaths: true,
    },
    server: {
      host: env.VITE_HOST,
      port: Number(env.VITE_PORT),
      allowedHosts: env.VITE_ALLOWED_HOSTS?.split(','),
    },
    test: {
      testTimeout: 15_000,
    },
  };
});
