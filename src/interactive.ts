import type { Readable } from 'node:stream'
import process from 'node:process'

/**
 * 交互可用性判定。
 *
 * 这一层存在的唯一理由：`@clack/core@1.4.3` 的 prompt 在 stdin 不可读时
 * **promise 永不 settle**——`await` 之后一行都不执行，`isCancel` 分支和 `cancel()`
 * 从来没被调用过，进程靠事件循环排空自然退出。用户在 CI 日志里看到的是一个
 * 画到一半的选择器，外加一个没有任何解释的非零退出码。
 *
 * 判据**不是** `process.stdin.isTTY`：实测过，管道也不是 TTY，按它判会连带
 * 打死靠管道喂按键的用法。真正的判据是「prompt 还挂着的时候 stdin 抵达 EOF」。
 *
 * 本文件是 `src/` 里唯一碰 `process.stdin` 事件的地方：`plan.ts` 明令不碰 process，
 * `utils.ts` 是纯函数集合，都不该混进流事件。
 */

/** stdin 抵达 EOF 时用来赢下 race 的哨兵，不对外暴露 */
const EOF = Symbol('stdin-eof')

/**
 * 需要交互、但当前环境给不出输入。
 *
 * 刻意不是普通 Error：`runCli()` 的兜底要靠类型把它和「真的崩了」分开——
 * 后者该打调用栈，而参数没给全不是 bug，打栈只会淹没那句有用的提示。
 */
export class NonInteractiveError extends Error {
  constructor(
    /** 这一步在问什么，原样取自 prompt 的 message */
    readonly step: string,
    /** 非交互环境下该改用哪个参数 */
    readonly hint: string,
  ) {
    super(`需要交互才能继续：${step}`)
    this.name = 'NonInteractiveError'
  }
}

/**
 * 等一个 prompt，但不允许它永远等下去。
 * @param {Promise<T>} prompt - clack 的 prompt promise
 * @param {string} step - 这一步在问什么，进错误提示
 * @param {string} hint - 非交互环境下的替代参数，进错误提示
 * @param {Readable} stdin - 注入点，默认 `process.stdin`；测试传真流而不是 mock
 * @returns prompt 的结果
 * @throws {NonInteractiveError} stdin 先抵达 EOF，即这个 prompt 永远等不到输入
 */
export async function ask<T>(
  prompt: Promise<T>,
  step: string,
  hint: string,
  stdin: Readable = process.stdin,
): Promise<T> {
  // executor 是同步执行的，所以 onEnd 在 Promise 构造完之后必定已被赋值
  let onEnd = (): void => {}
  const ended = new Promise<typeof EOF>((resolve) => {
    onEnd = () => resolve(EOF)
    // 前一个提问点可能已经把输入吃到 EOF，此时 'end' 早已派发完、再挂监听等不到东西
    if (stdin.readableEnded) {
      resolve(EOF)
      return
    }
    stdin.once('end', onEnd)
    stdin.once('close', onEnd)
  })

  try {
    const result = await Promise.race([prompt, ended])
    if (result === EOF) {
      throw new NonInteractiveError(step, hint)
    }
    return result as T
  }
  finally {
    // prompt 赢了的话这两个监听还挂着。一次运行会经过多个提问点，不摘就会累积，
    // 撞上 Node 默认 10 个上限的 MaxListenersExceededWarning。
    // 走到这里时 EOF 那条路径上的 once 监听已经自行摘掉了，重复 off 是安全的空操作。
    stdin.off('end', onEnd)
    stdin.off('close', onEnd)
  }
}
