import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { buildSync } from 'esbuild'

// A single self-contained asset keeps isolated visual review identical to the live reader.
const reading = buildSync({ entryPoints: ['src/renderer/src/result-reading-preview.tsx'], bundle: true, write: false,
  outfile: 'result-reading.js', platform: 'browser', format: 'iife', jsx: 'automatic', minify: true,
  define: { 'process.env.NODE_ENV': '"production"' } }).outputFiles!

export default defineConfig({
  main: {
    define: {
      __RESULT_READER_JS__: JSON.stringify(reading.find(file => file.path.endsWith('.js'))!.text),
      __RESULT_READER_CSS__: JSON.stringify(reading.find(file => file.path.endsWith('.css'))!.text)
    },
    build: {
      externalizeDeps: { exclude: ['unified', 'remark-parse', 'remark-gfm', '@noble/hashes'] },
      outDir: 'out/main',
      rollupOptions: { input: { index: resolve('src/main/index.ts'), 'journal-worker': resolve('src/main/journal/journal-worker.ts'), 'agent-worker': resolve('src/main/agents/worker.ts') } },
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
