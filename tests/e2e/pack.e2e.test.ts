import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { FRAMEWORKS } from '../../src/constants'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

/** 不带 customCommand 的变体，即需要仓库内置模板目录支撑的那些 */
const builtinTemplates = FRAMEWORKS
  .flatMap(f => f.variants?.length ? f.variants : [f])
  .filter(v => !('customCommand' in v && v.customCommand))
  .map(v => v.name)

/**
 * CTV-16：`package.json` 的 `files` 决定发布产物里有什么，它是「加一个模板要改的第四处」。
 *
 * **这条只能问 npm，不能自己实现通配去判。** 做本条目时实测过一次活生生的反例：
 * 把 `files` 从逐个列出改成 `template-*` 之后，产物从 82 个文件掉到 **5 个**——
 * 所有模板目录静默消失。npm 的规则不是「模式匹配到目录就包含其内容」：
 *
 * | 写法 | 产物文件数 |
 * |---|---|
 * | `template-*` | 5（全丢） |
 * | `template-*\/` | 5（全丢） |
 * | `template-**` | 5（全丢） |
 * | `template-*\/**` | 82 ✅ |
 * | `template-*\/*` | 82 |
 * | 逐个列出 6 个目录 | 82 |
 *
 * （表格里的 `*\/` 是转义写法，实际配置里没有那个反斜杠——不转义会把本注释提前闭合。）
 *
 * 裸目录名管用、通配到目录却不管用，这个差别**只在真实 tarball 里暴露**，
 * 读代码判断不出来（CLAUDE.md 那条「发布产物必须实测」就是说的这个）。
 * 所以本文件调真的 `npm pack --dry-run --json`，拿它的清单断言。
 *
 * 放 E2E 而不是单测：它断言的是**发布产物**，而且要 spawn 一个 npm 进程，
 * 不该拖慢每次 pre-commit 的单测。
 */
describe('发布产物清单', () => {
  const files: string[] = JSON.parse(
    execFileSync('npm', ['pack', '--dry-run', '--json'], {
      cwd: REPO_ROOT,
      encoding: 'utf-8',
      // npm 会往 stderr 打一堆 notice，不要混进 stdout
      stdio: ['ignore', 'pipe', 'ignore'],
    }),
  )[0].files.map((f: { path: string }) => f.path)

  it('每个内置模板的 package.json 都真的进了产物', () => {
    for (const name of builtinTemplates) {
      expect(files, `template-${name} 没进发布产物，用户装到的包里不会有这个模板`)
        .toContain(`template-${name}/package.json`)
    }
  })

  /**
   * npm 打包会**无条件剔除** `.gitignore`，所以仓库里存的是 `_gitignore`，
   * 靠 `RENAME_FILES` 在落地时改回来。这条钉住那个机制的前半截：
   * 下划线版本必须真的发得出去。
   */
  it('每个内置模板的 _gitignore 都真的进了产物', () => {
    for (const name of builtinTemplates) {
      expect(files, `template-${name}/_gitignore 没进产物，用户拿到的项目会缺 .gitignore`)
        .toContain(`template-${name}/_gitignore`)
    }
  })

  it('入口链路的两个文件都在', () => {
    expect(files).toContain('bin/index.js')
    expect(files).toContain('dist/index.js')
  })

  /**
   * 反向：产物里不许出现仓库自身的源码与测试。`files` 用通配之后这条更要紧——
   * 通配的风险正是「不该发的东西被捎带出去」。
   */
  it('产物里没有仓库自身的源码与测试', () => {
    const leaked = files.filter(f =>
      f.startsWith('src/') || f.startsWith('tests/') || f.includes('.e2e.'),
    )

    expect(leaked, '这些文件不该出现在发布产物里').toEqual([])
  })
})
