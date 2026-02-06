import { defineConfig } from 'tsdown'

export default defineConfig(() => ({
  entry: ['src/index.ts'],
  target: 'node20',
  outDir: 'dist',
  minify: true,
  tsconfig: 'tsconfig.json',
  fixedExtension: false,
}))
