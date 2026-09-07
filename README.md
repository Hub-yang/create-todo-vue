<h1 align="center">🚀 create-todo-vue</h1>

<div align="center">
  <a href="https://www.npmjs.com/package/@huberyyang/create-todo-vue"><img src="https://img.shields.io/npm/v/@huberyyang/create-todo-vue?style=flat-square&label=%20&color=%23000" alt="npm version"></a>
  <a href="https://github.com/Hub-yang/create-todo-vue/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/Hub-yang/create-todo-vue/ci.yml?branch=main&style=flat-square&label=CI" alt="CI status"/></a>
  <a href="https://github.com/Hub-yang/create-todo-vue"><img src="https://img.shields.io/static/v1?label=%F0%9F%8C%9F&message=If%20Useful&style=flat-square&color=BC4E99" alt="star badge"/></a>
  <a href="https://opensource.org/license/MIT"><img src="https://img.shields.io/npm/l/@huberyyang/create-todo-vue?style=flat-square" alt="license"/></a>
</div>

### 💡 说明 (Features)

使用自定义模板快速创建最新的vue项目

### 📦 快速开始 (Usage)

#### ⏳ 交互式创建

终端执行

```sh
# npm
npm create @huberyyang/todo-vue
# pnpm
pnpm create @huberyyang/todo-vue
# yarn
yarn create @huberyyang/todo-vue
# bun
bun create @huberyyang/todo-vue
# deno
deno run -A npm:@huberyyang/create-todo-vue
```

#### ⚡️ 快速创建

指定好参数即可跳过全部交互：

```sh
# 创建并立即安装依赖
npm create @huberyyang/todo-vue vue-project --overwrite -t vue-ts -i

# 只创建，不装依赖（适合 CI 或脚本调用）
npm create @huberyyang/todo-vue vue-project --overwrite -t vue-ts --no-immediate
```

#### 🔵 参数说明

- `-h, --help` 查看帮助
- `-v, --version` 查看版本号
- `-t, --template` 指定模板
- `-i, --immediate` 创建后立即安装依赖
- `--no-immediate` 创建后不安装依赖，只打印后续步骤（不加这两个 flag 时会询问）
- `--overwrite` 目标目录不为空时直接覆盖，不再询问

#### 🟢 当前可用模板

内置模板（`-t` 可直接指定）：

- `vanilla` / `vanilla-ts`
- `vue` / `vue-ts`
- `lit` / `lit-ts`

交互式选择 Vue 时，还可转交给以下上游脚手架：

- `Official Vue Starter` → `create-vue`
- `Nuxt` → `nuxi init`
- `Vike` → `create vike --vue`

### 📜 许可证 (License)

MIT License © 2026 [Hubery Yang](https://github.com/Hub-yang)
