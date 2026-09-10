import antfu from '@antfu/eslint-config'

export default antfu(
  {
    type: 'app',
    vue: true,
    typescript: true,
    unocss: true,
    markdown: false,
    formatters: {
      css: true,
      html: true,
    },
    rules: {
      'no-console': 'off',
    },
    ignores: ['**/public/**'],
  },
  // pnpm-workspace.yaml 规则定制
  {
    files: ['pnpm-workspace.yaml'],
    rules: {
      // eslint-plugin-pnpm 会强制要求 minimumReleaseAgeExcludePrune / shellEmulator /
      // trustPolicy 三条设置，那是仓库开发者的偏好，不该强加给刚生成的项目——
      // 其中 trustPolicy: no-downgrade 会让本模板的 `pnpm install` 直接退出码 1
      // （实测 ERR_PNPM_TRUST_DOWNGRADE，semver@6.3.1 由 vue-devtools 传递进来）。
      'pnpm/yaml-enforce-settings': 'off',
    },
  },
  // vue规则定制
  {
    files: ['**/*.vue'],
    rules: {
      // 限制属性数量换行
      'vue/max-attributes-per-line': ['error', {
        singleline: { max: 6 },
        multiline: { max: 1 },
      }],
    },
  },
  // ts规则定制
  {
    files: ['**/*.ts', '**/*.tsx', '**/*.vue'],
    rules: {
      // 允许any
      'ts/no-explicit-any': 'off',
      // 强制使用import type导入类型
      'ts/consistent-type-imports': ['error', {
        prefer: 'type-imports',
        fixStyle: 'inline-type-imports',
      }],
      // 禁止未使用的变量，但允许使用下划线忽略
      'ts/no-unused-vars': ['warn', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
      }],
    },
  },
)
