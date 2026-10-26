import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// GitHub Pages serves the site from /Watch_Or_Skip/, while Netlify serves it
// from the domain root. Netlify sets NETLIFY=true during its builds.
export default defineConfig({
  plugins: [react()],
  base: process.env.NETLIFY ? '/' : '/Watch_Or_Skip/',
})
