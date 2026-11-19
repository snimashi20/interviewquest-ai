import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5174,
  },
  // `npm test` runs the hook and service tests under src/**/__tests__.
  // jsdom gives them a DOM; the microphone and speech APIs are stubbed per test, so the
  // suite never opens a real microphone and never calls the backend
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.js'],
    include: ['src/**/*.test.{js,jsx}'],
  },
})
