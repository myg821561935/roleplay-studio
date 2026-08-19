// scriptExecutor.js
// 负责与 scriptSandboxWorker 通信，执行第三方脚本

let workerInstance = null;
let messageIdCounter = 0;
const pendingRequests = new Map();

function getWorker() {
  if (!workerInstance) {
    workerInstance = new Worker(new URL('./scriptSandboxWorker.js', import.meta.url), { type: 'module' });
    workerInstance.addEventListener('message', (event) => {
      const data = event.data;
      if (data.type === 'log') {
        console[data.level]?.('[Sandbox Worker]', ...data.args);
        return;
      }
      const { id, success, result, error } = data;
      if (pendingRequests.has(id)) {
        const { resolve, reject } = pendingRequests.get(id);
        pendingRequests.delete(id);
        if (success) {
          resolve(result);
        } else {
          reject(new Error(error));
        }
      }
    });
  }
  return workerInstance;
}

/**
 * 在沙箱中安全执行 JS 脚本
 * @param {string} script - 要执行的 JS 源代码
 * @param {object} context - 注入到执行环境的上下文变量
 * @returns {Promise<any>}
 */
export function executeScriptInSandbox(script, context = {}) {
  return new Promise((resolve, reject) => {
    const worker = getWorker();
    const id = `sandbox_msg_${++messageIdCounter}`;
    pendingRequests.set(id, { resolve, reject });
    worker.postMessage({ id, script, context });
  });
}
