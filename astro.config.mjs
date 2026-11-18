import { defineConfig } from 'astro/config';
import node from '@astrojs/node';
import tailwindcss from '@tailwindcss/vite';

// Renderizado dinámico (SSR). Cambia el adapter si despliegas en Vercel/Netlify/Cloudflare.
export default defineConfig({
  output: 'server',
  adapter: node({ mode: 'standalone' }),
  vite: {
    plugins: [tailwindcss()],
    optimizeDeps: {
      include: ['xlsx-js-style', 'jspdf', 'jspdf-autotable'],
    },
  },
});
