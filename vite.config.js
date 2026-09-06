import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base: '/Quiz-app/' е нужно, защото приложението се хоства на GitHub Pages
// под https://anina1999.github.io/Quiz-app/. При деплой на Netlify/Vercel
// смени на '/'.
export default defineConfig({
    base: process.env.DEPLOY_BASE ?? '/Quiz-app/',
    plugins: [react()],
    server: { port: 5173, open: true },
});
