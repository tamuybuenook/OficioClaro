import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  esbuild: { jsx: 'automatic' }, // las pruebas de render de pantallas importan archivos .tsx
  resolve: {
    alias: { '@': path.resolve(__dirname, '.') },
  },
  test: {
    environment: 'node',
  },
})
