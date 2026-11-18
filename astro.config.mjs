import { defineConfig } from 'astro/config';
import vercel from '@astrojs/vercel';
import tailwindcss from '@tailwindcss/vite';

// Renderizado dinámico (SSR) para Vercel.
export default defineConfig({
  output: 'server',
  adapter: vercel(),
  vite: {
    plugins: [tailwindcss()],
    optimizeDeps: {
      include: ['xlsx-js-style', 'jspdf', 'jspdf-autotable'],
    },
  },
});
