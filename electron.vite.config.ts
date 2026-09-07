import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    build: {
      outDir: 'out/main',
      minify: true
    }
  },
  preload: {
    build: {
      outDir: 'out/preload',
      minify: true
    }
  },
  renderer: {
    server: {
      port: 5387
    },
    resolve: {
      alias: {
        '@': resolve('src/renderer/src')
      }
    },
    plugins: [react()],
    build: {
      outDir: 'out/renderer',
      minify: 'esbuild',
      cssMinify: true,
      rollupOptions: {
        output: {
          manualChunks: {
            react: ['react', 'react-dom'],
            markdown: ['react-markdown', 'remark-gfm']
          }
        }
      }
    }
  }
})
