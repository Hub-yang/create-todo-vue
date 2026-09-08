import { PassThrough } from 'node:stream'
import { describe, expect, it } from 'vitest'
import { ask, NonInteractiveError } from '../src/interactive'

/**
 * CTV-31：`@clack/core@1.4.3` 的 prompt 在 stdin 不可读时 **promise 永不 settle**，
 * `await` 之后一行都不执行。于是非交互环境（CI、脚本、`< /dev/null`）里，用户看到的
 * 是一个画到一半的选择器，然后进程无声无息地没了。
 *
 * `ask()` 的职责就是把这条「谁都没接住」的路径变成一句人话。
 *
 * **判据刻意不是 `process.stdin.isTTY`**——实测过，管道也不是 TTY
 * （`stdio:'pipe'` 与 shell 的 `echo x |` 下 `isTTY` 均为 undefined），
 * 按它判会连带打死 E2E 里 4 条靠管道喂按键的用例，也会误伤真实的 `echo | cli` 用法。
 * 真正的判据是**「prompt 还挂着的时候 stdin 抵达 EOF」**：这条对 `/dev/null`、
 * 对已关闭的管道、对「按键喂完了但流程还要继续提问」三种情形同时成立。
 *
 * 这里用真的 `PassThrough` 而不是 mock：`resume()` 模拟 clack 那个消费者
 * （流不被消费就不会发 'end'），`end()` 制造 EOF。
 */

/** 造一个正在被消费的流，与 clack 挂上 readline 之后的 stdin 同形 */
function flowingStream(): PassThrough {
  const s = new PassThrough()
  s.resume()
  return s
}

/** 永不 settle 的 promise，模拟 clack 在 stdin 不可读时的行为 */
function neverSettles<T>(): Promise<T> {
  return new Promise<T>(() => {})
}

describe('ask', () => {
  it('prompt 正常 settle 时，原样返回它的值', async () => {
    const stdin = flowingStream()

    const result = await ask(Promise.resolve('vue-ts'), '选择模板', '-t <模板名>', stdin)

    expect(result).toBe('vue-ts')
  })

  it('prompt 挂着而 stdin 抵达 EOF 时，抛 NonInteractiveError', async () => {
    const stdin = flowingStream()
    const pending = ask(neverSettles<string>(), '选择模板', '-t <模板名>', stdin)

    stdin.end()

    await expect(pending).rejects.toBeInstanceOf(NonInteractiveError)
  })

  it('抛出的错误带着「这一步在问什么」和「该用哪个参数」', async () => {
    const stdin = flowingStream()
    const pending = ask(neverSettles<string>(), '目标目录不为空', '--overwrite', stdin)

    stdin.end()

    await expect(pending).rejects.toMatchObject({
      step: '目标目录不为空',
      hint: '--overwrite',
    })
  })

  it('stdin 早就 EOF 了（前一个提问点把输入吃完了）也照样抛，不必等 end 事件', async () => {
    const stdin = flowingStream()
    stdin.end()
    // 等 'end' 真的派发完，此后再挂监听已经等不到任何事件了
    await new Promise(res => stdin.once('end', res))

    await expect(
      ask(neverSettles<string>(), '包名', '--package-name <name>', stdin),
    ).rejects.toBeInstanceOf(NonInteractiveError)
  })

  /**
   * 只监听 'end' 是不够的——这条是**变异测试逼出来的**（M03「只监听 end 不监听 close」
   * 一度全绿存活），不是想当然加的。
   *
   * 实测的事件顺序：
   * - `end()`（正常 EOF）→ `['end', 'close']`
   * - `destroy()`（被销毁）→ `['close']`，**没有 end**，`readableEnded` 仍是 false
   * - `destroy(err)`（出错销毁）→ `['error', 'close']`，同样没有 end
   *
   * 后两种在真实环境里够得着：进程被丢到后台、stdin 的 fd 被关掉、或读 stdin 报 EIO。
   * 那种 stdin 同样永远给不出输入，该走同一条「说人话然后退 1」的路。
   */
  it('stdin 被销毁（只有 close 没有 end）时同样抛，不会干等', async () => {
    const stdin = flowingStream()
    const pending = ask(neverSettles<string>(), '选择模板', '-t <模板名>', stdin)

    stdin.destroy()

    await expect(pending).rejects.toBeInstanceOf(NonInteractiveError)
  })

  /**
   * 一次运行最多经过 4 个提问点。每次 race 都往 stdin 上挂 'end' + 'close' 两个监听，
   * 赢了不摘的话就会累积，撞上 Node 默认 10 个上限的 MaxListenersExceededWarning。
   *
   * ⚠️ 断言写**绝对值**而不是「调用前后相等」：后者在同文件其它用例已经把流弄脏时
   * 会一路绿着骗人（CLAUDE.md 记的那条教训）。这里每个用例都用全新的流，
   * 所以 0 是唯一正确的期望值。
   */
  it('prompt 赢了之后不残留监听器', async () => {
    const stdin = flowingStream()

    await ask(Promise.resolve('vue-ts'), '选择模板', '-t <模板名>', stdin)

    expect(stdin.listenerCount('end')).toBe(0)
    expect(stdin.listenerCount('close')).toBe(0)
  })

  it('输入耗尽（EOF）赢了之后也不残留监听器', async () => {
    const stdin = flowingStream()
    const pending = ask(neverSettles<string>(), '选择模板', '-t <模板名>', stdin)

    stdin.end()
    await expect(pending).rejects.toBeInstanceOf(NonInteractiveError)

    expect(stdin.listenerCount('end')).toBe(0)
    expect(stdin.listenerCount('close')).toBe(0)
  })

  it('prompt 抛异常之后也不残留监听器', async () => {
    const stdin = flowingStream()

    await expect(
      ask(Promise.reject(new Error('clack 炸了')), '选择模板', '-t <模板名>', stdin),
    ).rejects.toThrow()

    expect(stdin.listenerCount('end')).toBe(0)
    expect(stdin.listenerCount('close')).toBe(0)
  })

  it('连续多个提问点不会把监听器越挂越多', async () => {
    const stdin = flowingStream()

    for (let i = 0; i < 12; i++) {
      await ask(Promise.resolve(i), `第 ${i} 问`, '-t <模板名>', stdin)
    }

    expect(stdin.listenerCount('end')).toBe(0)
    expect(stdin.listenerCount('close')).toBe(0)
  })

  it('prompt 自己抛异常时原样透传，不会被伪装成 NonInteractiveError', async () => {
    const stdin = flowingStream()
    const boom = new Error('clack 炸了')

    await expect(
      ask(Promise.reject(boom), '选择模板', '-t <模板名>', stdin),
    ).rejects.toBe(boom)
  })
})
