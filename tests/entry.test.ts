import { afterEach, describe, expect, it, vi } from 'vitest'
import { ARGV_OPTIONS, FRAMEWORKS, RENAME_FILES } from '../src/constants'
import { collectKnownFlags } from '../src/plan'

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

  // CTV-29：main 返回退出码，由 runCli 落到 process.exitCode 上。
  // 两条早退分支都是正常结束，必须返回 0——否则 `--help` 会让脚本以为出错了。
  it('--help 与 --version 都返回退出码 0', async () => {
    const { main } = await import('../src/index')
    vi.spyOn(console, 'log').mockImplementation(() => {})

    await expect(main(['--help'])).resolves.toBe(0)
    await expect(main(['--version'])).resolves.toBe(0)
  })

  /**
   * mri 会**就地改写**传给它的配置对象：把 alias 的值换成数组、往 boolean 里追加别名
   * （每调一次追加一轮），其中 `alias.help` 会变成 `[]`。
   *
   * CTV-17 让 `mri()` 和 `collectKnownFlags()` 共用同一个 ARGV_OPTIONS，于是派生出的
   * 已知参数清单里混进了数组。断言写成**绝对值**而不是「调用前后相等」，因为
   * `isolate: false` 下同文件其它用例可能已经调过 main()，相对比较会一路绿着骗人。
   */
  it('调用 main() 不会改写 ARGV_OPTIONS', async () => {
    const { main } = await import('../src/index')
    vi.spyOn(console, 'log').mockImplementation(() => {})

    await main(['--version'])
    await main(['--help'])

    expect(ARGV_OPTIONS.boolean).toEqual(['help', 'version', 'overwrite', 'immediate'])
    expect(ARGV_OPTIONS.string).toEqual(['template', 'package-name'])
    expect(ARGV_OPTIONS.alias).toEqual({ h: 'help', v: 'version', t: 'template', i: 'immediate' })
  })

  /**
   * CTV-33：上面那条钉子是 CTV-17 的教训换来的，但同一类风险不止 `ARGV_OPTIONS` 一个。
   * `FRAMEWORKS` 与 `RENAME_FILES` 同样是模块级共享状态，且 `main()` 会读它们来渲染
   * 选择器、决定文件改名。
   *
   * **这里原本是盲区，实测过**：往 `main()` 里加一行 `FRAMEWORKS[0].variants[0].name = ...`，
   * 239 条单测全绿，一条都没红。原因是派生物挡不住这类污染——`TEMPLATES` 和
   * `HELP_MESSAGE` 都在模块加载时求值一次，之后再改 `FRAMEWORKS` 它们不会跟着变，
   * `constants.test.ts` 那些断言因此永远看不见。
   *
   * 期望值全部硬编码：从 `FRAMEWORKS` 派生的话两边同源，断言退化成恒等式（CTV-30 实测过
   * 一次）。也不写成「调用前后相等」——`isolate: false` 下状态可能已被同文件其它用例弄脏，
   * 相对比较会一路绿着骗人。
   */
  it('调用 main() 不会改写模板注册表', async () => {
    const { main } = await import('../src/index')
    vi.spyOn(console, 'log').mockImplementation(() => {})

    await main(['--version'])
    await main(['--help'])

    expect(FRAMEWORKS.map(f => f.name)).toEqual(['vanilla', 'vue', 'lit'])
    expect(FRAMEWORKS.flatMap(f => f.variants?.map(v => v.name) ?? [])).toEqual([
      'vanilla-ts',
      'vanilla',
      'vue-ts',
      'vue',
      'vue-dev',
      'custom-create-vue',
      'custom-nuxt',
      'custom-vike-vue',
      'custom-vitesse',
      'custom-vitesse-lite',
      'lit-ts',
      'lit',
    ])
    expect(RENAME_FILES).toEqual({ _gitignore: '.gitignore' })
  })

  it('main() 跑过之后，派生出的已知参数清单仍然全是字符串', async () => {
    const { main } = await import('../src/index')
    vi.spyOn(console, 'log').mockImplementation(() => {})

    await main(['--version'])

    for (const flag of collectKnownFlags(ARGV_OPTIONS)) {
      expect(typeof flag, `已知参数清单里混进了非字符串：${JSON.stringify(flag)}`).toBe('string')
    }
  })

  // CTV-17：mri 会静默吞掉未声明的 flag，拼错时还会把后面的位置参数当成它的值吃掉。
  it('未知参数让 main 返回非零，并把参数名打到 stderr', async () => {
    const { main } = await import('../src/index')
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(main(['--overwirte'])).resolves.toBe(1)
    expect(err.mock.calls.flat().join('\n')).toContain('--overwirte')
  })

  it('多个未知参数一次性全部列出', async () => {
    const { main } = await import('../src/index')
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(main(['--aaa', '--bbb'])).resolves.toBe(1)
    const printed = err.mock.calls.flat().join('\n')
    expect(printed).toContain('--aaa')
    expect(printed).toContain('--bbb')
  })

  // 次序守卫：--help 必须在校验之前处理。有人把两段调换的话这条会红。
  it('--help 优先于未知参数校验，带着拼错的参数也照样给帮助', async () => {
    const { main } = await import('../src/index')
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(main(['--help', '--typo'])).resolves.toBe(0)
    expect(log.mock.calls[0][0]).toContain('可用模板:')
  })

  it('--version 同样优先于未知参数校验', async () => {
    const { main } = await import('../src/index')
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(main(['--version', '--typo'])).resolves.toBe(0)
    expect(log.mock.calls[0][0]).toMatch(/^\d+\.\d+\.\d+$/)
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
