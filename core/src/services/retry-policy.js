const { createModuleLogger } = require('./logger');

const logger = createModuleLogger('retry-policy');

const DEFAULT_CONFIG = {
    maxRetries: 3,
    baseDelayMs: 1000,
    maxDelayMs: 30000,
    backoffMultiplier: 2,
    jitterMs: 500,
};

// 可重试的错误特征关键词
const RETRYABLE_PATTERNS = [
    'timeout', 'timed out', 'econnreset', 'econnrefused', 'etimedout',
    'esockettimedout', 'epipe', 'enotfound', 'enetunreach',
    'socket hang up', 'network error', 'request failed with status code 5',
    '503', '502', '504', '429',
];

function isRetryableError(error) {
    if (!error) return false;
    const message = String(error.message || error).toLowerCase();
    return RETRYABLE_PATTERNS.some(pattern => message.includes(pattern));
}

function computeDelay(attempt, config) {
    const base = config.baseDelayMs * (config.backoffMultiplier ** (attempt - 1));
    const capped = Math.min(base, config.maxDelayMs);
    const jitter = Math.floor(Math.random() * config.jitterMs);
    return capped + jitter;
}

/**
 * 创建重试策略
 * @param {object} [userConfig] - 用户配置
 * @param {number} [userConfig.maxRetries] - 最大重试次数（不含首次执行）
 * @param {number} [userConfig.baseDelayMs] - 基础退避延迟
 * @param {number} [userConfig.maxDelayMs] - 最大退避延迟
 * @param {number} [userConfig.backoffMultiplier] - 退避乘数
 * @param {number} [userConfig.jitterMs] - 随机抖动
 */
function createRetryPolicy(userConfig = {}) {
    const config = { ...DEFAULT_CONFIG, ...userConfig };

    function sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * 执行带重试的任务
     * @param {Function} fn - 任务函数，返回 Promise
     * @param {object} [options] - 执行选项
     * @param {string} [options.label] - 任务标签（用于日志）
     * @param {Function} [options.shouldRetry] - 自定义是否重试判断函数
     * @param {Function} [options.onRetry] - 重试回调 (attempt, error, delay) => void
     * @returns {Promise<*>} 任务结果
     */
    async function execute(fn, options = {}) {
        const label = options.label || 'task';
        const shouldRetry = options.shouldRetry || isRetryableError;
        const onRetry = options.onRetry;
        let lastError = null;

        for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
            try {
                return await fn(attempt);
            } catch (error) {
                lastError = error;
                if (attempt >= config.maxRetries || !shouldRetry(error)) {
                    throw error;
                }
                const delay = computeDelay(attempt + 1, config);
                logger.warn(`[${label}] 第 ${attempt + 1} 次重试（共 ${config.maxRetries} 次），${delay}ms 后重试`, {
                    label,
                    attempt: attempt + 1,
                    maxRetries: config.maxRetries,
                    delay,
                    error: error && error.message ? error.message : String(error),
                });
                if (typeof onRetry === 'function') {
                    try { onRetry(attempt + 1, error, delay); } catch { /* ignore */ }
                }
                await sleep(delay);
            }
        }
        throw lastError;
    }

    function getConfig() {
        return { ...config };
    }

    return { execute, getConfig, isRetryableError };
}

module.exports = {
    DEFAULT_CONFIG,
    isRetryableError,
    computeDelay,
    createRetryPolicy,
};
