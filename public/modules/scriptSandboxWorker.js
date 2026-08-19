// scriptSandboxWorker.js
// Web Worker 隔离沙箱环境，用于安全执行来自外部（如酒馆扩展卡片）的脚本。
// 该环境天然无法访问 DOM 和 localStorage，只能通过 postMessage 进行通信。

self.addEventListener('message', async (event) => {
  const { id, script, context } = event.data;
  
  if (!id || !script) {
    return;
  }

  try {
    // 构建安全的执行上下文
    // 我们避免暴露全局对象，提供一个沙盒化的 global context
    const sandboxContext = {
      ...context,
      console: {
        log: (...args) => self.postMessage({ type: 'log', level: 'info', args }),
        warn: (...args) => self.postMessage({ type: 'log', level: 'warn', args }),
        error: (...args) => self.postMessage({ type: 'log', level: 'error', args })
      }
    };

    // 提取上下文键值
    const keys = Object.keys(sandboxContext);
    const values = Object.values(sandboxContext);

    // 动态构建 Function，相当于在一个受限的作用域内执行。
    // 由于我们在 Web Worker 内，就算 new Function() 也能被安全隔离（无法访问主线程资源）。
    const executor = new Function(...keys, `
      "use strict";
      try {
        ${script}
      } catch (e) {
        throw e;
      }
    `);

    // 执行并获取可能返回的结果
    const result = await Promise.resolve(executor(...values));

    self.postMessage({
      id,
      success: true,
      result: result
    });
  } catch (error) {
    self.postMessage({
      id,
      success: false,
      error: error.message || String(error)
    });
  }
});
