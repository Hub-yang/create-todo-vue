import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['src/index.ts'],
  target: 'node20',
  outDir: 'dist',
  minify: true,
  tsconfig: 'tsconfig.json',
  fixedExtension: false,
  // tsdown 0.22 起 inlineOnly 被 deps.onlyBundle 取代。
  // false = 关掉「依赖被打进产物」的警告——本项目就是要把所有依赖打进
  // dist/index.js（它们全是 devDependencies，用户侧不会被安装）。
  deps: {
    onlyBundle: false,
  },
})
