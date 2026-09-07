import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * `main()` 的单测——CTV-15 拆分之后才可能存在的东西。
 *
 * 拆分前 `src/index.ts` 末尾是裸的 `init()`、argv 又在模块顶层解析，一 import 就会拿
 * 测试进程的 `process.argv` 真跑一遍脚手架并 `process.exit`，这个文件根本无法被测试导入。
 *
 * 这里只走 `--version` / `--help` 两条早退分支：它们不碰文件系统、不进交互，是仅有的
 * 能在单测里安全走完的 `main()` 路径。其余路径归 E2E。
 *
 * ⚠️ **这几条用例不是「禁止顶层自执行」的守卫，别当它是。** 实测过：把 `main()` 加回
 * 文件末尾，本文件仍然全绿——第一条用例首次 import 时自执行就已经发生，而它只断言导出
 * 类型；后面几条拿的是缓存模块。真正守着这条不变量的是 **E2E**，同样实测过：加回顶层
 * 调用会让 `cli-basics.e2e.test.ts` 里 2 条用例转红。
 */

afterEach(() => {
  vi.restoreAllMocks()
})

describe('模块入口', () => {
  it('导入 src/index.ts 不会执行 CLI，只拿到两个导出', async () => {
    const mod = await import('../src/index')

    expect(typeof mod.main).toBe('function')
    expect(typeof mod.runCli).toBe('function')
  })

  it('main 读的是传入的 argv，而不是进程的 process.argv', async () => {
    const { main } = await import('../src/index')
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})

    await main(['--version'])

    expect(log).toHaveBeenCalledTimes(1)
    expect(log.mock.calls[0][0]).toMatch(/^\d+\.\d+\.\d+$/)
  })

  it('main(["--help"]) 打印帮助后直接返回，不进入交互', async () => {
    const { main } = await import('../src/index')
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})

    await main(['--help'])

    expect(log).toHaveBeenCalledTimes(1)
    expect(log.mock.calls[0][0]).toContain('可用模板:')
  })

  it('-v 与 -h 的别名同样生效', async () => {
    const { main } = await import('../src/index')
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})

    await main(['-v'])
    await main(['-h'])

    expect(log).toHaveBeenCalledTimes(2)
    expect(log.mock.calls[0][0]).toMatch(/^\d+\.\d+\.\d+$/)
    expect(log.mock.calls[1][0]).toContain('可用模板:')
  })
})
