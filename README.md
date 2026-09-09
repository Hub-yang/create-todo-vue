<h1 align="center">🚀 create-todo-vue</h1>

<div align="center">
  <a href="https://www.npmjs.com/package/@huberyyang/create-todo-vue"><img src="https://img.shields.io/npm/v/@huberyyang/create-todo-vue?style=flat-square&label=%20&color=%23000" alt="npm version"></a>
  <a href="https://github.com/Hub-yang/create-todo-vue/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/Hub-yang/create-todo-vue/ci.yml?branch=main&style=flat-square&label=CI" alt="CI status"/></a>
  <a href="https://github.com/Hub-yang/create-todo-vue"><img src="https://img.shields.io/static/v1?label=%F0%9F%8C%9F&message=If%20Useful&style=flat-square&color=BC4E99" alt="star badge"/></a>
  <a href="https://opensource.org/license/MIT"><img src="https://img.shields.io/npm/l/@huberyyang/create-todo-vue?style=flat-square" alt="license"/></a>
</div>

### 💡 说明 (Features)

使用自定义模板快速创建最新的vue项目

内置模板生成完成后会自动执行一次 `git init`，直接就是一个干净的 git 工作区（不暂存、不提交，
第一个 commit 长什么样由你决定）。如果目标位置已经在某个 git 仓库里，则**跳过**这一步并给出提示——
在已有仓库里再建一个嵌套仓库几乎从来不是想要的结果。git 不可用或初始化失败时只会警告，
不影响项目本身的创建，退出码仍是 0。

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

# 目录名推不出合法的包名时（如 My App、.foo），用 --package-name 补上
npm create @huberyyang/todo-vue .foo --overwrite -t vue-ts --no-immediate --package-name my-pkg
```

#### 🔵 参数说明

- `<项目目录>` 位置参数，相对路径与绝对路径都可以；不传则会询问
- `-h, --help` 查看帮助
- `-v, --version` 查看版本号
- `-t, --template` 指定模板
- `-i, --immediate` 创建后立即安装依赖，装完会打印启动命令
- `--no-immediate` 创建后不安装依赖，只打印后续步骤（不加这两个 flag 时会询问）
- `--overwrite` 目标已存在时直接覆盖，不再询问：目录会被清空（`.git` 保留），同名文件会被删除
- `--package-name` 指定包名，同时写进 `package.json` 的 `name` 和 `index.html` 的 `<title>`；不传则取目录名，目录名不是合法包名时会询问

传入未声明的参数会直接报错退出，并列出拼错的那个。`--package-name` 的值不合法时同样直接报错，**不会**替你静默改成一个合法的。

#### 🟡 退出码

脚本化调用时可据此判断结果：

| 退出码 | 含义 |
| --- | --- |
| `0` | 创建成功；`-h` / `-v` 同样返回 0 |
| `1` | 操作被取消、参数有误，或创建过程中出错 |
| 其它 | 用了 `-i` 且**依赖没装上**时，原样透传包管理器自己的退出码 |

几点值得单独说明：

- **取消操作返回 1。**（`v1.2.0` 起）既包括交互式按 <kbd>Ctrl</kbd>+<kbd>C</kbd>，也包括在非交互环境（CI、脚本）下走到了需要输入的提示。后者以前返回 `0`，调用方会把「什么都没创建」误判成创建成功。
- **拼错的参数会被指出来。**（`v1.2.0` 起）以前拼错的 flag 会被静默忽略，而且它还会把紧跟其后的目录名当成自己的值吃掉——`--overwirte my-app` 连项目名都会丢，CLI 转而追问项目名称，用户看不出哪里写错了。
- **非交互环境下会说清楚卡在哪。** 在 CI、脚本或 `< /dev/null` 之类拿不到输入的环境里走到提示时，会打印当前卡在哪一步、以及该改用哪个参数，然后返回 `1`。此前这里只会留下一个画到一半的选择器，没有任何解释。
- **依赖装不上时，项目仍然是好的。** 用 `-i` 而依赖安装失败时，**已经生成的项目不会被回滚**——会告诉你项目在哪、以及手动补装的命令，并把包管理器的退出码原样带出来（所以这时退出码不一定是 `1`）。
- **`git init` 失败不影响退出码。** 机器上没有 git、或初始化失败时只会警告一句，项目本身照常创建，退出码仍是 `0`——它是附加动作，不该把一次成功的创建判成失败。

#### 🟢 当前可用模板

内置模板（`-t` 可直接指定）：

- `vanilla` / `vanilla-ts`
- `vue` / `vue-ts`
- `vue-dev`：比 vue-ts 重一档，预装 unocss、vueuse、vue-router 自动路由、element-plus 图标、自动导入，以及 eslint + husky + commitlint 一整套工具链
- `lit` / `lit-ts`

转交上游脚手架的模板（同样 `-t` 可直接指定，交互式在 Vue 下也能选到）：

- `custom-create-vue` → `create-vue`（Official Vue Starter）
- `custom-nuxt` → `nuxi init`（Nuxt）
- `custom-vike-vue` → `create vike --vue`（Vike）
- `custom-vitesse` → `degit antfu-collective/vitesse`（Vitesse）
- `custom-vitesse-lite` → `degit antfu-collective/vitesse-lite`（Vitesse Lite）

> 转交上游的模板由对方的脚手架直接生成，因此**不会**像内置模板那样把 `package.json` 的 `name`
> 和 `index.html` 的 `<title>` 改写成包名，**也不会自动 `git init`**——需要的话生成后自己改一下。
> 这几个还需要联网。

> 内置模板都带一份只写着模板名的占位 `README.md`（如 `# vue-ts`），它**不会**被改写成项目名，
> 就是留给你自己写的一张白纸。

### 📜 许可证 (License)

MIT License © 2026 [Hubery Yang](https://github.com/Hub-yang)
