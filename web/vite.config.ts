import { pwaOptions } from '@freeappstore/sdk/pwa-config'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [react(), tailwindcss(), VitePWA(pwaOptions())],
  server: { host: true },
})
