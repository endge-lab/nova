import { defineConfig } from 'vitest/config'
import path from 'path'
import vue from '@vitejs/plugin-vue'
import dts from 'vite-plugin-dts'

const externalPackages = [
  '@endge/raph',
  '@endge/utils',
  'class-transformer',
  'gl-matrix',
]

function isExternal(id: string): boolean {
  return externalPackages.some((pkg) => id === pkg || id.startsWith(`${pkg}/`))
}

export default defineConfig({
  build: {
    lib: {
      entry: path.resolve(__dirname, 'src/index.ts'),
      formats: ['es'],
      name: 'endge-nova',
    },
    rollupOptions: {
      external: isExternal,
    },
  },
  plugins: [vue(), dts({ rollupTypes: true, tsconfigPath: './tsconfig.app.json' })],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.ts'],
    testTimeout: 30_000,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/**/units/**', 'src/index.ts'],
    },
  },
})
