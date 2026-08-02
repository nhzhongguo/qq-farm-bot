const crypto = require('node:crypto');
const { getDataFile } = require('../config/runtime-paths');
const { readJsonFile, writeJsonFileAtomic } = require('./json-db');

const SCHEMA_VERSION = 1;
const DEFAULT_RETENTION_DAYS = 7;
const DEFAULT_MAX_RECORDS = 100;

// 敏感字段列表 — 诊断包中这些字段会被脱敏
const SENSITIVE_KEYS = new Set([
    'password', 'apiKey', 'api_key', 'secret', 'token', 'wxid', 'uuid',
    'code', 'cardCode', 'loginCode', 'uin', 'skey', 'sessionKey',
]);

function maskValue(value) {
    if (value == null || value === '') return '';
    const str = String(value);
    if (str.length <= 4) return '****';
    return `${str.slice(0, 2)}****${str.slice(-2)}`;
}

function redactSensitive(obj, depth = 0) {
    if (obj == null || typeof obj !== 'object') return obj;
    if (depth > 10) return '[max-depth]';
    if (Array.isArray(obj)) return obj.map(item => redactSensitive(item, depth + 1));
    const result = {};
    for (const [key, value] of Object.entries(obj)) {
        if (SENSITIVE_KEYS.has(key)) {
            result[key] = maskValue(value);
        } else if (typeof value === 'object' && value !== null) {
            result[key] = redactSensitive(value, depth + 1);
        } else {
            result[key] = value;
        }
    }
    return result;
}

function createDiagnosticBundle(options = {}) {
    const filePath = options.filePath || getDataFile('diagnostic_bundles.json');
    const retentionDays = options.retentionDays || DEFAULT_RETENTION_DAYS;
    const maxRecords = options.maxRecords || DEFAULT_MAX_RECORDS;
    const now = typeof options.now === 'function' ? options.now : Date.now;

    function retain(bundles) {
        const cutoff = now() - retentionDays * 24 * 60 * 60 * 1000;
        return [...bundles]
            .filter(bundle => bundle.createdAt >= cutoff)
            .sort((a, b) => b.createdAt - a.createdAt)
            .slice(0, maxRecords);
    }

    function readBundles() {
        const data = readJsonFile(filePath, () => ({ schemaVersion: SCHEMA_VERSION, bundles: [] }));
        if (!data || !Array.isArray(data.bundles)) return [];
        return data.bundles;
    }

    function persist(bundles) {
        const retained = retain(bundles);
        writeJsonFileAtomic(filePath, { schemaVersion: SCHEMA_VERSION, bundles: retained });
        return retained;
    }

    /**
     * 生成诊断包
     * @param {object} params
     * @param {string} params.accountId - 账号 ID
     * @param {string} [params.accountName] - 账号名称
     * @param {string} [params.trigger] - 触发原因（如 'task_failed', 'manual'）
     * @param {object} [params.taskRuns] - 最近任务运行记录
     * @param {object} [params.statusSnapshot] - 账号状态快照
     * @param {Array} [params.recentLogs] - 最近日志条目
     * @param {object} [params.configSummary] - 配置摘要（会脱敏）
     * @param {string} [params.error] - 错误信息
     */
    function generate({
        accountId, accountName, trigger = 'manual',
        taskRuns, statusSnapshot, recentLogs, configSummary, error,
    }) {
        const id = crypto.randomUUID();
        const bundle = {
            id,
            createdAt: now(),
            accountId: String(accountId || '').trim(),
            accountName: String(accountName || '').trim(),
            trigger: String(trigger || 'manual').trim(),
            error: error ? String(error).slice(0, 2000) : null,
            taskRuns: taskRuns || [],
            statusSnapshot: statusSnapshot || null,
            recentLogs: (recentLogs || []).slice(-50),
            configSummary: configSummary ? redactSensitive(configSummary) : null,
        };
        persist([bundle, ...readBundles()]);
        return bundle;
    }

    function list(filters = {}) {
        const bundles = retain(readBundles());
        const accountId = String(filters.accountId || '').trim();
        const limit = Math.min(50, Number(filters.limit) || 20);
        return bundles.filter((bundle) => {
            if (accountId && bundle.accountId !== accountId) return false;
            return true;
        }).slice(0, limit);
    }

    function get(id) {
        const bundles = retain(readBundles());
        return bundles.find(bundle => bundle.id === id) || null;
    }

    return { generate, list, get };
}

const defaultBundle = createDiagnosticBundle();

module.exports = {
    SCHEMA_VERSION,
    createDiagnosticBundle,
    generate: defaultBundle.generate,
    list: defaultBundle.list,
    get: defaultBundle.get,
};
