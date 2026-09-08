import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { ARGV_OPTIONS, FRAMEWORKS, RENAME_FILES } from '../src/constants'
import {
  buildCustomCommandArgs,
  buildDoneMessage,
  collectKnownFlags,
  derivePackageName,
  findUnknownFlags,
  findVariantCommand,
  isArgPackageNameValid,
  planTemplateFiles,
  replaceHtmlTitle,
  resolveArgTemplate,
  resolvePackageName,
  withPackageName,
} from '../src/plan'

/**
 * 这些用例钉的是 CTV-15 之前 `init()` 里的既有行为，逐条对着原实现推导，
 * **不是**「应该怎样」。包括几处看着别扭的地方（空串模板名不算无效、
 * TARGET_DIR 只替换第一处、命令名本身不参与替换），那些都是现状，
 * 拆分不许改动它们。
 */

describe('resolveArgTemplate', () => {
  const templates = ['vue-ts', 'vue', 'lit']

  it('没传 -t 时不选模板，也不算无效', () => {
    expect(resolveArgTemplate(undefined, templates)).toEqual({
      template: undefined,
      invalid: false,
    })
  })

  it('传了合法模板名就原样采用', () => {
    expect(resolveArgTemplate('vue-ts', templates)).toEqual({
      template: 'vue-ts',
      invalid: false,
    })
  })

  it('传了不存在的模板名时清空选择并标记无效', () => {
    expect(resolveArgTemplate('nope', templates)).toEqual({
      template: undefined,
      invalid: true,
    })
  })

  // 原实现的判断是 `argTemplate && !TEMPLATES.includes(...)`，空串走不进这个分支，
  // 于是 `-t ""` 会静默回落到选择器而不报「无效模板名」。这是现状，拆分不改。
  it('传空串时不标记无效——空串在原实现里走不进校验分支', () => {
    expect(resolveArgTemplate('', templates)).toEqual({
      template: '',
      invalid: false,
    })
  })

  it('模板名大小写敏感', () => {
    expect(resolveArgTemplate('VUE-TS', templates)).toEqual({
      template: undefined,
      invalid: true,
    })
  })
})

describe('derivePackageName', () => {
  it('取目标目录的末段作为包名', () => {
    expect(derivePackageName('my-app', '/home/u')).toEqual({
      name: 'my-app',
      needsPrompt: false,
    })
  })

  it('多级路径只取最后一段', () => {
    expect(derivePackageName('a/b/my-app', '/home/u')).toEqual({
      name: 'my-app',
      needsPrompt: false,
    })
  })

  it('目标目录是 . 时取 cwd 的末段', () => {
    expect(derivePackageName('.', '/home/u/some-dir')).toEqual({
      name: 'some-dir',
      needsPrompt: false,
    })
  })

  it('末段不是合法包名时要求追问', () => {
    expect(derivePackageName('My App', '/home/u')).toEqual({
      name: 'My App',
      needsPrompt: true,
    })
  })

  it('相对路径按传入的 cwd 解析，而不是进程的 cwd', () => {
    expect(derivePackageName('..', '/home/u/nested/leaf')).toEqual({
      name: 'nested',
      needsPrompt: false,
    })
  })

  it('绝对路径直接取末段', () => {
    expect(derivePackageName('/tmp/other-app', '/home/u')).toEqual({
      name: 'other-app',
      needsPrompt: false,
    })
  })
})

/**
 * CTV-31 · B1：`--package-name` 让「参数齐全就能全程无交互」第一次成为真的。
 *
 * 在它之前，包名是脚手架里**唯一**一个给不出参数的提问点——只要目录名推不出合法包名
 * （`My App`、`.foo`），非交互调用就必然停在那里，而且没有任何 flag 能救。
 *
 * 三条语义各自有明确理由，不要随手改：
 * - **显式优先于推导**：传了就用，哪怕目录名本身推得出合法包名。否则「给了参数却被
 *   忽略」是另一种撒谎。
 * - **非法值报错而不是静默修正**：与 CTV-17 的未知参数校验同一个立场——用户打错了
 *   要告诉他，别替他猜。真想要自动修正的人可以自己不传这个参数。
 * - **空串按非法处理**：`--package-name` 不带值时 mri 会给 `''`（实测），
 *   那是「用户想传但传漏了」，不是「用户没传」。
 */
describe('resolvePackageName', () => {
  it('没传 --package-name 时回落到从目录名推导', () => {
    expect(resolvePackageName(undefined, 'my-app', '/home/u')).toEqual({
      name: 'my-app',
      needsPrompt: false,
    })
  })

  it('没传时目录名推不出合法包名，仍然要求追问', () => {
    expect(resolvePackageName(undefined, 'My App', '/home/u')).toEqual({
      name: 'My App',
      needsPrompt: true,
    })
  })

  it('传了合法包名就用它，并且不再追问', () => {
    expect(resolvePackageName('my-pkg', 'My App', '/home/u')).toEqual({
      name: 'my-pkg',
      needsPrompt: false,
    })
  })

  it('目录名本来就合法时，显式参数照样优先', () => {
    expect(resolvePackageName('other-name', 'my-app', '/home/u')).toEqual({
      name: 'other-name',
      needsPrompt: false,
    })
  })

  it('scope 包名是合法的', () => {
    expect(resolvePackageName('@scope/pkg', 'my-app', '/home/u')).toEqual({
      name: '@scope/pkg',
      needsPrompt: false,
    })
  })
})

/**
 * CTV-37：校验从 `resolvePackageName` 里拆出来，因为两件事的**时机**不同。
 *
 * 「用户传的值合不合法」和 `targetDir` 毫无关系，所以它能——也**必须**——排在
 * `intro()` 开框、以及任何破坏性操作之前跑。挤在 `resolvePackageName` 里的时候做不到：
 * 那个函数要等 `targetDir` 才能调，而 `targetDir` 可能来自开框之后的提问，
 * 结果就是先画出框、再打一句框外的报错，`┌` 永远没有 `└`（实测过）。
 *
 * 拆开之后两个函数各管一件事，也就没有「返回了 invalid 却没人看」的死分支。
 */
describe('isArgPackageNameValid', () => {
  it('没传就是合法的——没传不是错', () => {
    expect(isArgPackageNameValid(undefined)).toBe(true)
  })

  it('合法包名通过', () => {
    expect(isArgPackageNameValid('my-pkg')).toBe(true)
  })

  it('scope 包名通过', () => {
    expect(isArgPackageNameValid('@scope/pkg')).toBe(true)
  })

  it('带空格、带大写的不通过', () => {
    expect(isArgPackageNameValid('My Pkg')).toBe(false)
  })

  it('空串不通过——那是带了参数没带值，不是没传', () => {
    expect(isArgPackageNameValid('')).toBe(false)
  })
})

describe('findVariantCommand', () => {
  it('内置模板没有 customCommand', () => {
    expect(findVariantCommand(FRAMEWORKS, 'vue-ts')).toBeUndefined()
  })

  it('取得 custom 变体的指令', () => {
    expect(findVariantCommand(FRAMEWORKS, 'custom-create-vue'))
      .toBe('npm create vue@latest TARGET_DIR')
    expect(findVariantCommand(FRAMEWORKS, 'custom-nuxt'))
      .toBe('npm exec nuxi init TARGET_DIR')
    expect(findVariantCommand(FRAMEWORKS, 'custom-vike-vue'))
      .toBe('npm create -- vike@latest --vue TARGET_DIR')
  })

  it('模板名不存在时返回 undefined 而不是抛错', () => {
    expect(findVariantCommand(FRAMEWORKS, 'nope')).toBeUndefined()
  })

  // 原实现是 `f.variants?.length ? f.variants : f`：没有变体的框架本身就是一个可选项。
  it('没有 variants 的框架，其自身的名字也能被命中', () => {
    const frameworks = [
      { name: 'solo', display: 'Solo', color: (s: string | number) => String(s), customCommand: 'npm exec x TARGET_DIR' },
    ]
    expect(findVariantCommand(frameworks, 'solo')).toBe('npm exec x TARGET_DIR')
  })

  it('框架有 variants 时，框架名本身不是可选项', () => {
    expect(findVariantCommand(FRAMEWORKS, 'vue')).toBeUndefined()
  })
})

describe('buildCustomCommandArgs', () => {
  it('拆出命令名与参数，并把 TARGET_DIR 换成目标目录', () => {
    expect(buildCustomCommandArgs('npm create vue@latest TARGET_DIR', 'my-app')).toEqual({
      command: 'npm',
      args: ['create', 'vue@latest', 'my-app'],
    })
  })

  it('保留 -- 这类原样参数', () => {
    expect(buildCustomCommandArgs('pnpm create vike@latest --vue TARGET_DIR', 'app')).toEqual({
      command: 'pnpm',
      args: ['create', 'vike@latest', '--vue', 'app'],
    })
  })

  it('多段命令名（deno run -A npm:create-x）只把第一段当命令', () => {
    expect(buildCustomCommandArgs('deno run -A npm:create-vue TARGET_DIR', 'app')).toEqual({
      command: 'deno',
      args: ['run', '-A', 'npm:create-vue', 'app'],
    })
  })

  // 原实现用的是 String.prototype.replace，非全局，只换第一处。
  it('单个参数里出现两次 TARGET_DIR 时只替换第一处', () => {
    expect(buildCustomCommandArgs('x aTARGET_DIRbTARGET_DIRc', 'D')).toEqual({
      command: 'x',
      args: ['aDbTARGET_DIRc'],
    })
  })

  // 替换是对 args 逐个做的，命令名（第一段）不参与。
  it('命令名里的 TARGET_DIR 不会被替换', () => {
    expect(buildCustomCommandArgs('TARGET_DIR arg', 'D')).toEqual({
      command: 'TARGET_DIR',
      args: ['arg'],
    })
  })

  it('目标目录会替换到参数中间的位置', () => {
    expect(buildCustomCommandArgs('x --out=TARGET_DIR/sub', 'app')).toEqual({
      command: 'x',
      args: ['--out=app/sub'],
    })
  })
})

describe('planTemplateFiles', () => {
  it('普通文件走拷贝，文件名不变', () => {
    expect(planTemplateFiles(['src'], {})).toEqual([
      { kind: 'copy', from: 'src', to: 'src' },
      { kind: 'package-json', from: 'package.json', to: 'package.json' },
    ])
  })

  it('index.html 单独一类，因为要改写 title', () => {
    expect(planTemplateFiles(['index.html'], {})).toEqual([
      { kind: 'index-html', from: 'index.html', to: 'index.html' },
      { kind: 'package-json', from: 'package.json', to: 'package.json' },
    ])
  })

  it('package.json 从批量拷贝里剔除，改由末尾单独写入', () => {
    const actions = planTemplateFiles(['a', 'package.json', 'b'], {})
    expect(actions).toEqual([
      { kind: 'copy', from: 'a', to: 'a' },
      { kind: 'copy', from: 'b', to: 'b' },
      { kind: 'package-json', from: 'package.json', to: 'package.json' },
    ])
  })

  // npm 打包会无条件剔除 .gitignore，所以仓库里存成 _gitignore，落地时改回来。
  it('按重命名表改写目标文件名', () => {
    expect(planTemplateFiles(['_gitignore'], RENAME_FILES)).toEqual([
      { kind: 'copy', from: '_gitignore', to: '.gitignore' },
      { kind: 'package-json', from: 'package.json', to: 'package.json' },
    ])
  })

  it('重命名表里没有的文件名保持原样', () => {
    expect(planTemplateFiles(['README.md'], RENAME_FILES)).toEqual([
      { kind: 'copy', from: 'README.md', to: 'README.md' },
      { kind: 'package-json', from: 'package.json', to: 'package.json' },
    ])
  })

  it('保持传入的文件顺序，package.json 的写入永远排在最后', () => {
    const actions = planTemplateFiles(['z', 'package.json', 'a', 'index.html'], RENAME_FILES)
    expect(actions.map(a => a.from)).toEqual(['z', 'a', 'index.html', 'package.json'])
    expect(actions.at(-1)!.kind).toBe('package-json')
  })

  it('模板目录里没有 package.json 时仍然计划写入——与原实现一致', () => {
    expect(planTemplateFiles([], RENAME_FILES)).toEqual([
      { kind: 'package-json', from: 'package.json', to: 'package.json' },
    ])
  })

  it('重命名表也作用于 index.html 这一类', () => {
    expect(planTemplateFiles(['index.html'], { 'index.html': 'main.html' })).toEqual([
      { kind: 'index-html', from: 'index.html', to: 'main.html' },
      { kind: 'package-json', from: 'package.json', to: 'package.json' },
    ])
  })
})

describe('replaceHtmlTitle', () => {
  it('把 title 换成项目名', () => {
    expect(replaceHtmlTitle('<head><title>Vite App</title></head>', 'my-app'))
      .toBe('<head><title>my-app</title></head>')
  })

  it('空的 title 标签同样能替换', () => {
    expect(replaceHtmlTitle('<title></title>', 'my-app')).toBe('<title>my-app</title>')
  })

  // 原实现的正则是非贪婪的，`.*?` 不会吃掉后面的内容。
  it('非贪婪匹配，不会把两个 title 之间的内容一起吞掉', () => {
    expect(replaceHtmlTitle('<title>a</title>X<title>b</title>', 'N'))
      .toBe('<title>N</title>X<title>b</title>')
  })

  // String.replace 非全局，只换第一处。
  it('只替换第一个 title', () => {
    expect(replaceHtmlTitle('<title>a</title><title>b</title>', 'N'))
      .toBe('<title>N</title><title>b</title>')
  })

  // 正则没有 s 标志，`.` 匹配不到换行。
  it('跨行的 title 匹配不上，内容原样返回', () => {
    const html = '<title>\nVite App\n</title>'
    expect(replaceHtmlTitle(html, 'my-app')).toBe(html)
  })

  it('没有 title 标签时原样返回', () => {
    expect(replaceHtmlTitle('<head></head>', 'my-app')).toBe('<head></head>')
  })

  it('保留 title 以外的全部内容', () => {
    const html = '<!doctype html>\n<html>\n<head><title>x</title></head>\n<body>hi</body>\n</html>'
    expect(replaceHtmlTitle(html, 'app')).toBe(
      '<!doctype html>\n<html>\n<head><title>app</title></head>\n<body>hi</body>\n</html>',
    )
  })
})

describe('withPackageName', () => {
  it('改写 name 字段', () => {
    const out = withPackageName('{"name":"template","version":"1.0.0"}', 'my-app')
    expect(JSON.parse(out).name).toBe('my-app')
  })

  it('保留其余字段', () => {
    const out = withPackageName('{"name":"t","version":"1.0.0","private":true}', 'my-app')
    expect(JSON.parse(out)).toEqual({ name: 'my-app', version: '1.0.0', private: true })
  })

  it('用 2 个空格缩进', () => {
    const out = withPackageName('{"name":"t","scripts":{"dev":"vite"}}', 'my-app')
    expect(out).toContain('\n  "scripts": {\n    "dev": "vite"\n  }')
  })

  it('以换行结尾', () => {
    expect(withPackageName('{"name":"t"}', 'my-app')).toMatch(/\}\n$/)
  })

  it('name 保持在原有的键位置上，不被挪到末尾', () => {
    const out = withPackageName('{"name":"t","version":"1.0.0"}', 'my-app')
    expect(Object.keys(JSON.parse(out))).toEqual(['name', 'version'])
  })

  it('完整产物逐字符可预期', () => {
    expect(withPackageName('{"name":"t","type":"module"}', 'app'))
      .toBe('{\n  "name": "app",\n  "type": "module"\n}\n')
  })
})

describe('buildDoneMessage', () => {
  const cwd = '/w'

  it('目标目录在 cwd 之下时，先 cd 再装依赖', () => {
    expect(buildDoneMessage(cwd, path.join(cwd, 'my-app'), 'npm'))
      .toBe('创建完成，请执行：\n cd my-app\n npm install')
  })

  it('目标就是 cwd 时不打印 cd', () => {
    expect(buildDoneMessage(cwd, cwd, 'npm'))
      .toBe('创建完成，请执行：\n npm install')
  })

  it('路径含空格时给 cd 的参数加引号', () => {
    expect(buildDoneMessage(cwd, path.join(cwd, 'my app'), 'npm'))
      .toBe('创建完成，请执行：\n cd "my app"\n npm install')
  })

  it('yarn 的安装命令不带 install 子命令', () => {
    expect(buildDoneMessage(cwd, path.join(cwd, 'a'), 'yarn'))
      .toBe('创建完成，请执行：\n cd a\n yarn')
  })

  it('pnpm / bun 照常带 install', () => {
    expect(buildDoneMessage(cwd, path.join(cwd, 'a'), 'pnpm'))
      .toBe('创建完成，请执行：\n cd a\n pnpm install')
    expect(buildDoneMessage(cwd, path.join(cwd, 'a'), 'bun'))
      .toBe('创建完成，请执行：\n cd a\n bun install')
  })

  it('cd 的是相对路径，不是绝对路径', () => {
    expect(buildDoneMessage(cwd, path.join(cwd, 'nested', 'app'), 'npm'))
      .toBe(`创建完成，请执行：\n cd ${path.join('nested', 'app')}\n npm install`)
  })
})

/**
 * CTV-21：依赖已经装完时，末行该给「怎么跑起来」而不是再让人装一遍。
 *
 * 只有首行措辞和末行命令随 `installed` 变，`cd` 那半边的规则完全共用——所以
 * 这一组只钉住差异，不重复覆盖 cd 的四种情形（上一组已经覆盖过了）。
 */
describe('buildDoneMessage · 依赖已安装', () => {
  const cwd = '/w'

  it('首行改口，末行给启动命令而不是安装命令', () => {
    expect(buildDoneMessage(cwd, path.join(cwd, 'my-app'), 'npm', true))
      .toBe('依赖安装完成，请执行：\n cd my-app\n npm run dev')
  })

  it('目标就是 cwd 时同样不打印 cd', () => {
    expect(buildDoneMessage(cwd, cwd, 'npm', true))
      .toBe('依赖安装完成，请执行：\n npm run dev')
  })

  it('yarn 的启动命令不带 run 子命令', () => {
    expect(buildDoneMessage(cwd, path.join(cwd, 'a'), 'yarn', true))
      .toBe('依赖安装完成，请执行：\n cd a\n yarn dev')
  })

  it('pnpm / bun 照常带 run', () => {
    expect(buildDoneMessage(cwd, path.join(cwd, 'a'), 'pnpm', true))
      .toBe('依赖安装完成，请执行：\n cd a\n pnpm run dev')
    expect(buildDoneMessage(cwd, path.join(cwd, 'a'), 'bun', true))
      .toBe('依赖安装完成，请执行：\n cd a\n bun run dev')
  })

  it('不传第四个参数时维持原样——既有调用点一行都不用改', () => {
    expect(buildDoneMessage(cwd, path.join(cwd, 'a'), 'npm'))
      .toBe('创建完成，请执行：\n cd a\n npm install')
  })
})

describe('collectKnownFlags', () => {
  it('汇总 boolean 与 string 声明', () => {
    expect(collectKnownFlags({ boolean: ['help'], string: ['template'] }))
      .toEqual(['help', 'template'])
  })

  it('别名的两侧都算已知——mri 会同时产出短名和全名', () => {
    const known = collectKnownFlags({ alias: { t: 'template' } })
    expect(known).toContain('t')
    expect(known).toContain('template')
  })

  it('去重：别名指向的名字同时出现在 boolean 里时只留一份', () => {
    expect(collectKnownFlags({ boolean: ['help'], alias: { h: 'help' } }))
      .toEqual(['help', 'h'])
  })

  it('空配置得到空清单', () => {
    expect(collectKnownFlags({})).toEqual([])
  })

  it('真实配置覆盖 CLI 的全部参数', () => {
    const known = collectKnownFlags(ARGV_OPTIONS)
    for (const name of ['help', 'version', 'overwrite', 'immediate', 'template', 'h', 'v', 't', 'i']) {
      expect(known, `已知参数清单漏了 ${name}`).toContain(name)
    }
  })
})

describe('findUnknownFlags', () => {
  const known = collectKnownFlags(ARGV_OPTIONS)

  it('全是已知参数时返回空', () => {
    expect(findUnknownFlags({ _: [], help: true }, known)).toEqual([])
  })

  it('位置参数 _ 永远不算未知', () => {
    expect(findUnknownFlags({ _: ['my-app'] }, known)).toEqual([])
  })

  it('揪出拼错的参数', () => {
    expect(findUnknownFlags({ _: [], overwirte: true }, known)).toEqual(['overwirte'])
  })

  it('多个未知参数按用户输入的顺序返回', () => {
    expect(findUnknownFlags({ _: [], zzz: true, aaa: true }, known)).toEqual(['zzz', 'aaa'])
  })

  it('大小写敏感——Template 不是 template', () => {
    expect(findUnknownFlags({ _: [], Template: 'vue' }, known)).toEqual(['Template'])
  })

  // 下面四条是「不许误报」的守卫，逐条对应实测过的 mri 行为
  it('不误报：mri 把 -t 展开成 t 和 template 两个键', () => {
    expect(findUnknownFlags({ _: [], t: 'vue-ts', template: 'vue-ts' }, known)).toEqual([])
  })

  it('不误报：--no-immediate 产出的是 immediate/i，不是 no-immediate', () => {
    expect(findUnknownFlags({ _: [], immediate: false, i: false }, known)).toEqual([])
  })

  it('不误报：-hv 这类合并短参会展开成四个已知键', () => {
    expect(findUnknownFlags({ _: [], h: true, v: true, help: true, version: true }, known))
      .toEqual([])
  })

  it('不误报：`--` 之后的内容进 _，不产生键', () => {
    expect(findUnknownFlags({ _: ['my-app', '--weird'] }, known)).toEqual([])
  })
})
