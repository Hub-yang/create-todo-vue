import process from 'node:process'
import * as prompts from '@clack/prompts'

/**
 * 终端状态的主人。
 *
 * `intro()` 之后，终端上有两样东西是我们弄出来的、退出前必须还原：
 * **clack 的框线**（`┌` 得有配对的 `└`）和**被 prompt 隐藏的光标**。
 *
 * 之所以要一个模块而不是在各个退出点补一行：`main()` 有 7 类退出路径，
 * 每加一条就会漏一次——实测过，6 条路径里 4 条框子只开不关，其中两条连
 * CTV-34 / 36 / 37 三个条目都没点到，而 CTV-31 自己刚刚又漏了一处。
 * 把状态收进这里、由 `runCli()` 的 `finally` 无条件兜底，漏才变得不可能。
 *
 * `close()` 必须幂等：`finally` 会无条件调它，而成功路径自己已经调过了。
 */

/** 渲染器。注入点：单测传假的记录调用，生产用 clack */
export interface TerminalRenderer {
  intro: (title: string) => void
  outro: (message: string) => void
  write: (chunk: string) => void
}

const clackRenderer: TerminalRenderer = {
  intro: title => prompts.intro(title),
  outro: message => prompts.outro(message),
  write: chunk => void process.stdout.write(chunk),
}

/** 让光标重新显示。clack 的 prompt 挂起时会写 `ESC[?25l`，永不 settle 时它自己不会收 */
const SHOW_CURSOR = '\u001B[?25h'

export interface Terminal {
  /** 打开框线 */
  open: (title: string) => void
  /** 收尾并关闭框线。框没开（或已被 `markClosed` 认领）时是空操作 */
  close: (message?: string) => void
  /** 告诉状态机「框已经被别人收掉了」——`cancel()` 自己就打了一行 `└` */
  markClosed: () => void
  isOpen: () => boolean
  /**
   * 恢复光标。**只在开过框之后才写**——光标是被框里的 prompt 隐藏的，
   * 从没开过框的路径（`--help` / `--version` / 未知参数）没人动过它，
   * 补一个转义序列只会污染它们的 stdout。
   */
  restoreCursor: () => void
}

/**
 * 造一个终端状态机
 * @param {TerminalRenderer} renderer - 渲染器，默认走 clack
 */
export function createTerminal(renderer: TerminalRenderer = clackRenderer): Terminal {
  let open = false
  // 和 open 分开记：框关掉之后光标仍然需要还原，所以不能复用 open
  let everOpened = false

  return {
    open(title: string) {
      renderer.intro(title)
      open = true
      everOpened = true
    },
    close(message = '') {
      if (!open) {
        return
      }
      open = false
      renderer.outro(message)
    },
    markClosed() {
      open = false
    },
    isOpen() {
      return open
    },
    restoreCursor() {
      // 只还原我们可能弄脏过的东西。实测过反例：无条件写的话
      // `$(create-todo-vue --version)` 会从 5 个字节变成 12 个，
      // 版本号后面挂着一串转义序列，脚本直接被坑。
      if (!everOpened) {
        return
      }
      renderer.write(SHOW_CURSOR)
    },
  }
}
