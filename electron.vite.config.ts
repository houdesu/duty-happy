import { resolve } from 'path'
import { defineConfig, bytecodePlugin, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin(), bytecodePlugin()],
    build: {
      minify: false,
      sourcemap: false
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin(), bytecodePlugin()],
    build: {
      minify: false,
      sourcemap: false
    }
  },
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src')
      },
      extensions: ['.tsx', '.ts', '.jsx', '.mjs', '.js', '.json']
    },
    plugins: [react(), tailwindcss()]
  }
})
