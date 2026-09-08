import type { TerminalRenderer } from '../src/terminal'
import { describe, expect, it } from 'vitest'
import { createTerminal } from '../src/terminal'

/**
 * CTV-34 / 36 / 37：退出前把终端还原成该有的样子。
 *
 * 病根不是某三处忘了收尾，而是**「谁负责关框」没有主人**——`main()` 有 7 类退出路径，
 * 每加一条就漏一次（CTV-31 自己就漏了一处）。这个模块把「框开着没有」变成一份有主的状态，
 * 由 `runCli()` 的 `finally` 兜底，于是将来新增的退出路径想漏也漏不掉。
 *
 * 这里测的是**状态机**，用假渲染器记录调用；真实渲染由 E2E 对着 `┌` / `└` 断言。
 * 两边刻意不重叠：状态机管「该不该调 outro」，E2E 管「调出来长什么样」。
 */

/** 记录调用的假渲染器。不是 mock 框架，就是个数组 */
function fakeRenderer(): TerminalRenderer & { calls: string[] } {
  const calls: string[] = []
  return {
    calls,
    intro: (title: string) => void calls.push(`intro:${title}`),
    outro: (message: string) => void calls.push(`outro:${message}`),
    write: (chunk: string) => void calls.push(`write:${JSON.stringify(chunk)}`),
  }
}

describe('createTerminal · 框线状态', () => {
  it('open() 打开框', () => {
    const r = fakeRenderer()
    const t = createTerminal(r)

    t.open('create-todo-vue')

    expect(r.calls).toEqual(['intro:create-todo-vue'])
    expect(t.isOpen()).toBe(true)
  })

  it('框开着时 close() 收尾', () => {
    const r = fakeRenderer()
    const t = createTerminal(r)
    t.open('create-todo-vue')

    t.close('程序结束')

    expect(r.calls).toEqual(['intro:create-todo-vue', 'outro:程序结束'])
    expect(t.isOpen()).toBe(false)
  })

  /**
   * 幂等是这个模块存在的理由：`runCli()` 的 `finally` 会无条件调一次 `close()`，
   * 而正常成功路径自己已经调过了。不幂等的话每次成功都会打出两个 `└`。
   */
  it('框没开过时 close() 什么都不做', () => {
    const r = fakeRenderer()
    const t = createTerminal(r)

    t.close('程序结束')

    expect(r.calls).toEqual([])
  })

  it('连续 close() 两次只收尾一次', () => {
    const r = fakeRenderer()
    const t = createTerminal(r)
    t.open('create-todo-vue')

    t.close('程序结束')
    t.close('程序结束')

    expect(r.calls.filter((c: string) => c.startsWith('outro:'))).toHaveLength(1)
  })

  /**
   * `cancel()` 自己就打了一行 `└  操作已取消`，框已经收在它手里了。
   * 不告诉状态机的话，`finally` 会再补一个 `└`，取消路径就多出一条空收尾。
   */
  it('markClosed() 之后 close() 不再补收尾', () => {
    const r = fakeRenderer()
    const t = createTerminal(r)
    t.open('create-todo-vue')

    t.markClosed()
    t.close('程序结束')

    expect(r.calls).toEqual(['intro:create-todo-vue'])
    expect(t.isOpen()).toBe(false)
  })

  it('markClosed() 在框没开时也是安全的空操作', () => {
    const r = fakeRenderer()
    const t = createTerminal(r)

    t.markClosed()

    expect(r.calls).toEqual([])
    expect(t.isOpen()).toBe(false)
  })

  it('关掉之后还能再开一次', () => {
    const r = fakeRenderer()
    const t = createTerminal(r)

    t.open('a')
    t.close('x')
    t.open('b')

    expect(t.isOpen()).toBe(true)
    expect(r.calls).toEqual(['intro:a', 'outro:x', 'intro:b'])
  })
})

describe('createTerminal · 光标', () => {
  /**
   * clack 的 prompt 挂起时会隐藏光标（`ESC[?25l`），而它永不 settle 的那条路径上
   * 自己的清理一行都没跑。实测：非交互报错的输出里 `?25l` 出现 1 次、`?25h` 0 次，
   * 成功路径则是 1:1。交互式会话里 stdin 中途没了，用户会留下一个没有光标的终端。
   */
  it('restoreCursor() 写出恢复光标的转义序列', () => {
    const r = fakeRenderer()
    const t = createTerminal(r)
    t.open('create-todo-vue')
    r.calls.length = 0

    t.restoreCursor()

    expect(r.calls).toEqual([`write:${JSON.stringify('\u001B[?25h')}`])
  })

  /**
   * ⚠️ 只还原我们可能弄脏过的东西。
   *
   * 光标是被 clack 的 **prompt** 隐藏的，而 prompt 只可能出现在框里。从没开过框的路径
   * （`--help` / `--version` / 未知参数）压根没人动过光标，往它们的 stdout 里补一个
   * `ESC[?25h` 就是平白污染输出——实测过后果：`$(create-todo-vue --version)` 从 5 个字节
   * 变成 12 个，脚本拿到的版本号后面挂着转义序列。
   */
  it('从没开过框时 restoreCursor() 什么都不写', () => {
    const r = fakeRenderer()
    const t = createTerminal(r)

    t.restoreCursor()

    expect(r.calls).toEqual([])
  })

  it('开过框之后就算已经关了，也照样恢复光标', () => {
    const r = fakeRenderer()
    const t = createTerminal(r)
    t.open('create-todo-vue')
    t.close('程序结束')

    t.restoreCursor()

    expect(r.calls.filter((c: string) => c.startsWith('write:'))).toHaveLength(1)
  })

  it('cancel 认领了框（markClosed）之后同样要恢复光标', () => {
    const r = fakeRenderer()
    const t = createTerminal(r)
    t.open('create-todo-vue')
    t.markClosed()

    t.restoreCursor()

    expect(r.calls.filter((c: string) => c.startsWith('write:'))).toHaveLength(1)
  })
})
