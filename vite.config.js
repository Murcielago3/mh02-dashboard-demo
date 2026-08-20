import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// `base` must match where the build is served from on Hostinger:
//   root domain / subdomain  -> '/'            (default)
//   subfolder, e.g. /demo/   -> VITE_BASE=/demo/ npm run build
// Getting this wrong makes /assets/* 404 and the page renders blank.
export default defineConfig({
  base: process.env.VITE_BASE || '/',
  plugins: [vue()],
  server: {
    host: '0.0.0.0',
    port: 5173,
  },
  build: {
    outDir: 'dist',
    // A demo, not a library: a couple of big chunks is fine and loads faster
    // over one connection than many small ones.
    chunkSizeWarningLimit: 1500,
  },
})
