import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { FRAMEWORKS } from '../src/constants'
import {
  copy,
  copyDir,
  emptyDir,
  findPackageJson,
  formatTargetDir,
  getFullCustomCommand,
  getInstallCommand,
  getLabel,
  getVersion,
  isEmpty,
  isValidPackageName,
  pathKind,
  pkgFromUserAgent,
  toValidPackageName,
} from '../src/utils'

/** picocolors 在 TTY 下会真的注入 ANSI 转义码，断言前统一剥掉 */
const ESC = String.fromCharCode(27)
const stripAnsi = (s: string) => s.split(new RegExp(`${ESC}\\[\\d+m`, 'g')).join('')

/** 每个用例一个独立临时目录，避免相互污染 */
function useTempDir() {
  let dir = ''
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ctv-utils-'))
  })
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true })
  })
  return () => dir
}

describe('formatTargetDir', () => {
  it('去掉首尾空白', () => {
    expect(formatTargetDir('  my-app  ')).toBe('my-app')
  })

  it('去掉末尾的斜杠，多个也一并去掉', () => {
    expect(formatTargetDir('my-app/')).toBe('my-app')
    expect(formatTargetDir('my-app///')).toBe('my-app')
  })

  it('只去末尾斜杠，不动中间和开头的', () => {
    expect(formatTargetDir('./packages/my-app')).toBe('./packages/my-app')
    expect(formatTargetDir('/abs/path/')).toBe('/abs/path')
  })

  it('保留单独的点号（当前目录是合法目标）', () => {
    expect(formatTargetDir('.')).toBe('.')
  })

  it('纯斜杠会被清空——调用方需自行处理这个空串', () => {
    // index.ts 靠 prompts 的 validate（formatTargetDir(value).length > 0）挡住这种输入
    expect(formatTargetDir('/')).toBe('')
  })
})

describe('pkgFromUserAgent', () => {
  it('从 npm_config_user_agent 里解析出包管理器名与版本', () => {
    expect(pkgFromUserAgent('pnpm/10.30.3 npm/? node/v22.12.0 darwin arm64'))
      .toEqual({ name: 'pnpm', version: '10.30.3' })
    expect(pkgFromUserAgent('yarn/1.22.22 npm/? node/v18.20.0 linux x64'))
      .toEqual({ name: 'yarn', version: '1.22.22' })
  })

  it('传 undefined 时返回 undefined', () => {
    expect(pkgFromUserAgent(undefined)).toBeUndefined()
  })

  it('传空串时返回 undefined，而不是 name 为空串的对象', () => {
    expect(pkgFromUserAgent('')).toBeUndefined()
  })

  it('没有斜杠时 version 为 undefined，而非抛错', () => {
    // 直接跑 `node bin/index.js` 时环境变量可能是任意形状，不能崩
    expect(pkgFromUserAgent('npm')).toEqual({ name: 'npm', version: undefined })
  })
})

describe('isValidPackageName', () => {
  it.each([
    ['my-app', true],
    ['@scope/my-app', true],
    ['vue3', true],
    ['a', true],
    ['my.app', true],
    ['my_app', true],
    ['My-App', false], // 大写
    ['.my-app', false], // 首字符是点
    ['_my-app', false], // 首字符是下划线
    ['my app', false], // 空格
    ['', false],
  ])('%s → %s', (input, expected) => {
    expect(isValidPackageName(input)).toBe(expected)
  })
})

describe('toValidPackageName', () => {
  it('空白转连字符并转小写', () => {
    expect(toValidPackageName('  My App  ')).toBe('my-app')
  })

  it('剥掉开头的点或下划线', () => {
    expect(toValidPackageName('.hidden')).toBe('hidden')
    expect(toValidPackageName('_private')).toBe('private')
  })

  it('把非法字符成段替换为单个连字符', () => {
    // 连续的非法字符只产生一个连字符，不是每个字符一个
    expect(toValidPackageName('foo@@@bar')).toBe('foo-bar')
  })

  it('转换结果对现实输入都能通过 isValidPackageName', () => {
    for (const input of ['My App', '.hidden', '_private', 'Foo@Bar!', '中文目录', '123-abc']) {
      expect(isValidPackageName(toValidPackageName(input)), `输入 ${input}`).toBe(true)
    }
  })

  it('空串转换后仍然非法——已知缺口，靠调用方拦住', () => {
    // index.ts 传进来的是 path.basename(path.resolve(targetDir))，
    // path.resolve('') 会回落到 cwd，所以实际不可能是空串。
    expect(toValidPackageName('')).toBe('')
    expect(isValidPackageName('')).toBe(false)
  })
})

describe('getInstallCommand', () => {
  it('yarn 不带 install 子命令', () => {
    expect(getInstallCommand('yarn')).toEqual(['yarn'])
  })

  it.each(['npm', 'pnpm', 'bun', 'deno'])('%s 带 install 子命令', (pm) => {
    expect(getInstallCommand(pm)).toEqual([pm, 'install'])
  })
})

describe('getFullCustomCommand', () => {
  // FRAMEWORKS 里现存的三种指令形态。下面的矩阵按这三条展开，
  // 末尾有一条守卫用例确保注册表里没有冒出第四种形态。
  const CREATE = 'npm create vue@latest TARGET_DIR'
  const EXEC = 'npm exec nuxi init TARGET_DIR'
  const CREATE_DASH = 'npm create -- vike@latest --vue TARGET_DIR'

  const NPM = { name: 'npm', version: '10.9.0' }
  const PNPM = { name: 'pnpm', version: '10.30.3' }
  const YARN1 = { name: 'yarn', version: '1.22.22' }
  const YARN4 = { name: 'yarn', version: '4.5.0' }
  const BUN = { name: 'bun', version: '1.1.34' }
  const DENO = { name: 'deno', version: '2.1.4' }

  it.each([
    // 没有 user agent 时回落到 npm，输出与显式 npm 相同
    ['无 pkgInfo', undefined, CREATE, 'npm create vue@latest TARGET_DIR'],
    ['无 pkgInfo', undefined, EXEC, 'npm exec nuxi init TARGET_DIR'],
    ['无 pkgInfo', undefined, CREATE_DASH, 'npm create -- vike@latest --vue TARGET_DIR'],

    ['npm', NPM, CREATE, 'npm create vue@latest TARGET_DIR'],
    ['npm', NPM, EXEC, 'npm exec nuxi init TARGET_DIR'],
    ['npm', NPM, CREATE_DASH, 'npm create -- vike@latest --vue TARGET_DIR'],

    // pnpm 不支持 -- 语法，所以 CREATE_DASH 那条的 -- 被吃掉
    ['pnpm', PNPM, CREATE, 'pnpm create vue@latest TARGET_DIR'],
    ['pnpm', PNPM, EXEC, 'pnpm dlx nuxi init TARGET_DIR'],
    ['pnpm', PNPM, CREATE_DASH, 'pnpm create vike@latest --vue TARGET_DIR'],

    // yarn 1.x 在 create 里不认 @version，@latest 被整段剥掉；
    // 且它没有 dlx，exec 那条回落到 npm exec
    ['yarn1', YARN1, CREATE, 'yarn create vue TARGET_DIR'],
    ['yarn1', YARN1, EXEC, 'npm exec nuxi init TARGET_DIR'],
    ['yarn1', YARN1, CREATE_DASH, 'yarn create -- vike --vue TARGET_DIR'],

    // yarn 2+ 保留 @latest，并且有 dlx
    ['yarn4', YARN4, CREATE, 'yarn create vue@latest TARGET_DIR'],
    ['yarn4', YARN4, EXEC, 'yarn dlx nuxi init TARGET_DIR'],
    ['yarn4', YARN4, CREATE_DASH, 'yarn create -- vike@latest --vue TARGET_DIR'],

    // bun create 用的是它自己的模板集，所以必须走 bun x create-<pkg>
    ['bun', BUN, CREATE, 'bun x create-vue@latest TARGET_DIR'],
    ['bun', BUN, EXEC, 'bun x nuxi init TARGET_DIR'],
    ['bun', BUN, CREATE_DASH, 'bun x create-vike@latest --vue TARGET_DIR'],

    // deno 需要 run -A 才有足够权限
    ['deno', DENO, CREATE, 'deno run -A npm:create-vue@latest TARGET_DIR'],
    ['deno', DENO, EXEC, 'deno run -A npm:nuxi init TARGET_DIR'],
    ['deno', DENO, CREATE_DASH, 'deno run -A npm:create-vike@latest --vue TARGET_DIR'],
  ])('%s: %#', (_label, pkgInfo, input, expected) => {
    expect(getFullCustomCommand(input, pkgInfo)).toBe(expected)
  })

  it('注册表里的每条 customCommand 都被上面的矩阵覆盖', () => {
    const covered = new Set([CREATE, EXEC, CREATE_DASH])
    const actual = FRAMEWORKS
      .flatMap(f => f.variants?.length ? f.variants : [f])
      .map(v => 'customCommand' in v ? v.customCommand : undefined)
      .filter((c): c is string => Boolean(c))

    expect(actual.length).toBeGreaterThan(0)
    for (const cmd of actual) {
      expect(covered, `FRAMEWORKS 里的 "${cmd}" 没有出现在改写矩阵里`).toContain(cmd)
    }
  })
})

describe('getLabel', () => {
  // 传入自己的 color 函数，这样断言不依赖 picocolors 是否检测到 TTY
  const brackets = (s: string | number) => `<${s}>`

  it('display 优先于 name', () => {
    const label = getLabel({ name: 'vue-ts', display: 'TypeScript', color: brackets })
    expect(stripAnsi(label)).toBe('<TypeScript>')
  })

  it('display 为空时回落到 name', () => {
    const label = getLabel({ name: 'vue-ts', display: '', color: brackets })
    expect(stripAnsi(label)).toBe('<vue-ts>')
  })

  it('带 link 时把链接追加在标题后面', () => {
    const label = getLabel({
      name: 'custom-nuxt',
      display: 'Nuxt',
      color: brackets,
      link: 'https://nuxt.com',
    })
    expect(stripAnsi(label)).toBe('<Nuxt> https://nuxt.com')
  })

  it('没有 link 时不留下多余空格', () => {
    const label = getLabel({ name: 'vue', display: 'Vue', color: brackets })
    expect(stripAnsi(label)).toBe('<Vue>')
    expect(stripAnsi(label)).not.toMatch(/\s$/)
  })
})

describe('isEmpty', () => {
  const tmp = useTempDir()

  it('空目录算空', () => {
    expect(isEmpty(tmp())).toBe(true)
  })

  it('只有 .git 也算空——重新初始化一个已有仓库是常见场景', () => {
    fs.mkdirSync(path.join(tmp(), '.git'))
    expect(isEmpty(tmp())).toBe(true)
  })

  it('有 .git 之外的文件就不算空', () => {
    fs.mkdirSync(path.join(tmp(), '.git'))
    fs.writeFileSync(path.join(tmp(), 'README.md'), '')
    expect(isEmpty(tmp())).toBe(false)
  })

  it('只有一个非 .git 文件时不算空', () => {
    // 名字长得像但不是 .git，不能被误判
    fs.writeFileSync(path.join(tmp(), '.gitignore'), '')
    expect(isEmpty(tmp())).toBe(false)
  })
})

/**
 * CTV-20：`isEmpty` 只回答「空不空」，回答不了「是不是目录」。
 *
 * 目标名恰好撞上一个已存在的**文件**时，`fs.readdirSync` 直接抛 ENOTDIR，
 * 用户看到的是一段没有意义的内部栈。调用点需要先能分辨三种形态，才谈得上给人话。
 */
describe('pathKind', () => {
  const tmp = useTempDir()

  it('不存在的路径是 missing', () => {
    expect(pathKind(path.join(tmp(), 'nope'))).toBe('missing')
  })

  it('目录是 dir', () => {
    expect(pathKind(tmp())).toBe('dir')
  })

  it('普通文件是 file', () => {
    const target = path.join(tmp(), 'taken')
    fs.writeFileSync(target, '我是文件，不是目录')
    expect(pathKind(target)).toBe('file')
  })

  it('空目录也是 dir——不能跟 missing 混为一谈', () => {
    const target = path.join(tmp(), 'empty')
    fs.mkdirSync(target)
    expect(pathKind(target)).toBe('dir')
  })

  it('指向目录的软链算 dir——跟随符号链接，而不是把它自己当成一个文件', () => {
    const real = path.join(tmp(), 'real')
    const link = path.join(tmp(), 'link')
    fs.mkdirSync(real)
    fs.symlinkSync(real, link)
    expect(pathKind(link)).toBe('dir')
  })
})

describe('emptyDir', () => {
  const tmp = useTempDir()

  it('目录不存在时返回 false 且不抛错', () => {
    expect(emptyDir(path.join(tmp(), 'does-not-exist'))).toBe(false)
  })

  it('清空目录但保留 .git', () => {
    fs.mkdirSync(path.join(tmp(), '.git'))
    fs.writeFileSync(path.join(tmp(), '.git', 'HEAD'), 'ref: refs/heads/main')
    fs.writeFileSync(path.join(tmp(), 'a.txt'), '')
    fs.mkdirSync(path.join(tmp(), 'nested', 'deep'), { recursive: true })
    fs.writeFileSync(path.join(tmp(), 'nested', 'deep', 'b.txt'), '')

    emptyDir(tmp())

    expect(fs.readdirSync(tmp())).toEqual(['.git'])
    // 保留的必须是整个 .git 内容，不只是空壳目录
    expect(fs.readFileSync(path.join(tmp(), '.git', 'HEAD'), 'utf-8'))
      .toBe('ref: refs/heads/main')
  })
})

describe('copy / copyDir', () => {
  const tmp = useTempDir()

  it('拷贝单个文件', () => {
    const src = path.join(tmp(), 'src.txt')
    const dest = path.join(tmp(), 'dest.txt')
    fs.writeFileSync(src, 'hello')

    copy(src, dest)

    expect(fs.readFileSync(dest, 'utf-8')).toBe('hello')
  })

  it('源是目录时递归拷贝整棵树', () => {
    const src = path.join(tmp(), 'template')
    fs.mkdirSync(path.join(src, 'src', 'components'), { recursive: true })
    fs.writeFileSync(path.join(src, 'package.json'), '{}')
    fs.writeFileSync(path.join(src, 'src', 'main.ts'), 'main')
    fs.writeFileSync(path.join(src, 'src', 'components', 'App.vue'), 'app')

    const dest = path.join(tmp(), 'out')
    copy(src, dest)

    expect(fs.readFileSync(path.join(dest, 'package.json'), 'utf-8')).toBe('{}')
    expect(fs.readFileSync(path.join(dest, 'src', 'main.ts'), 'utf-8')).toBe('main')
    expect(fs.readFileSync(path.join(dest, 'src', 'components', 'App.vue'), 'utf-8')).toBe('app')
  })

  it('copyDir 会自己创建不存在的目标目录', () => {
    const src = path.join(tmp(), 'a')
    fs.mkdirSync(src)
    fs.writeFileSync(path.join(src, 'f.txt'), 'x')

    const dest = path.join(tmp(), 'not', 'created', 'yet')
    copyDir(src, dest)

    expect(fs.readFileSync(path.join(dest, 'f.txt'), 'utf-8')).toBe('x')
  })

  it('目标已存在同名文件时覆盖——「忽略文件并继续」这条路径依赖它', () => {
    const src = path.join(tmp(), 'src.txt')
    const dest = path.join(tmp(), 'dest.txt')
    fs.writeFileSync(src, 'new')
    fs.writeFileSync(dest, 'old')

    copy(src, dest)

    expect(fs.readFileSync(dest, 'utf-8')).toBe('new')
  })
})

describe('findPackageJson', () => {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ctv-findpkg-'))

  beforeAll(() => {
    // <root>/package.json + <root>/a/b/（深层无 package.json）
    fs.writeFileSync(
      path.join(fixtureRoot, 'package.json'),
      JSON.stringify({ name: 'fixture', version: '9.9.9' }),
    )
    fs.mkdirSync(path.join(fixtureRoot, 'a', 'b'), { recursive: true })
  })

  afterAll(() => {
    fs.rmSync(fixtureRoot, { recursive: true, force: true })
  })

  it('起始目录自身就有 package.json 时直接返回它', () => {
    expect(findPackageJson(fixtureRoot)).toBe(path.join(fixtureRoot, 'package.json'))
  })

  it('逐级向上找，跨多层目录也能命中', () => {
    expect(findPackageJson(path.join(fixtureRoot, 'a', 'b')))
      .toBe(path.join(fixtureRoot, 'package.json'))
  })

  it('一路到文件系统根都没有时返回 undefined', () => {
    // 用真实的根目录做起点：/ 上不该有 package.json
    expect(findPackageJson(path.parse(process.cwd()).root)).toBeUndefined()
  })
})

describe('getVersion', () => {
  it('读得到本仓库自己的版本号，且与 package.json 一致', () => {
    const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
    const expected = JSON.parse(
      fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf-8'),
    ).version
    expect(getVersion(repoRoot)).toBe(expected)
  })

  it('找不到 package.json 时返回 unknown 而不是抛错', () => {
    expect(getVersion(path.parse(process.cwd()).root)).toBe('unknown')
  })
})
