'use strict';

// Playwright 1.64's in-page poll tests Promise truthiness before its result settles.
module.exports = async function waitForAsyncCondition(page, condition, argument, { timeout = 30000 } = {}) {
  let timer;
  const error = new Error('The asynchronous page condition did not become true within ' + timeout + 'ms.');
  error.name = 'TimeoutError';
  const expired = new Promise((_, reject) => { timer = setTimeout(() => reject(error), timeout); });
  try {
    for (;;) {
      const result = await Promise.race([page.evaluate(condition, argument), expired]);
      if (result) return result;
      await Promise.race([page.waitForTimeout(100), expired]);
    }
  } finally { clearTimeout(timer); }
};
