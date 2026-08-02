const crypto = require('node:crypto');
const { getDataFile } = require('../config/runtime-paths');
const { readJsonFile, writeJsonFileAtomic, createDebouncedWriter, flushWritersFor } = require('./json-db');

const SCHEMA_VERSION = 1;
const DEFAULT_RETENTION_DAYS = 90;
const DEFAULT_MAX_RECORDS = 2000;

// 敏感字段列表 — 审计日志中这些字段的值会被脱敏
const SENSITIVE_FIELDS = new Set([
    'password', 'newPassword', 'oldPassword', 'apiKey', 'api_key',
    'secret', 'token', 'wxid', 'uuid', 'code', 'cardCode',
]);

function maskValue(value) {
    if (value == null || value === '') return '';
    const str = String(value);
    if (str.length <= 4) return '****';
    return `${str.slice(0, 2)}****${str.slice(-2)}`;
}

function redactSensitive(obj) {
    if (obj == null || typeof obj !== 'object') return obj;
    if (Array.isArray(obj)) return obj.map(redactSensitive);
    const result = {};
    for (const [key, value] of Object.entries(obj)) {
        if (SENSITIVE_FIELDS.has(key)) {
            result[key] = maskValue(value);
        } else if (typeof value === 'object' && value !== null) {
            result[key] = redactSensitive(value);
        } else {
            result[key] = value;
        }
    }
    return result;
}

function createAuditLog(options = {}) {
    const filePath = options.filePath || getDataFile('audit_log.json');
    const retentionDays = options.retentionDays || DEFAULT_RETENTION_DAYS;
    const maxRecords = options.maxRecords || DEFAULT_MAX_RECORDS;
    const now = typeof options.now === 'function' ? options.now : Date.now;

    function retain(entries) {
        const cutoff = now() - retentionDays * 24 * 60 * 60 * 1000;
        return [...entries]
            .filter(entry => entry.timestamp >= cutoff)
            .sort((a, b) => b.timestamp - a.timestamp)
            .slice(0, maxRecords);
    }

    function readEntries() {
        const data = readJsonFile(filePath, () => ({ schemaVersion: SCHEMA_VERSION, entries: [] }));
        if (!data || !Array.isArray(data.entries)) return [];
        return data.entries;
    }

    function persist(entries) {
        const retained = retain(entries);
        writeJsonFileAtomic(filePath, { schemaVersion: SCHEMA_VERSION, entries: retained });
        return retained;
    }

    // 批量合并写入：审计日志高频追加时合并为一次原子写（默认 300ms 窗口）
    const pendingEntries = [];
    const writer = createDebouncedWriter(() => {
        if (pendingEntries.length === 0) return;
        const batch = pendingEntries.splice(0, pendingEntries.length);
        persist([...batch, ...readEntries()]);
    }, 300, filePath);
    const FLUSH_THRESHOLD = 50; // 达到阈值立即落盘，避免内存无界增长

    /**
     * 记录一条操作审计日志
     * @param {object} params
     * @param {string} params.actor - 操作者用户名
     * @param {string} params.action - 操作类型，如 'user.create', 'card.delete', 'config.update'
     * @param {string} params.target - 操作目标描述，如 'username:foo', 'card:ABC123'
     * @param {object} [params.details] - 操作详情（敏感字段自动脱敏）
     * @param {string} [params.ip] - 客户端 IP
     * @param {'info'|'warning'|'danger'} [params.severity] - 严重级别
     */
    function record({ actor, action, target, details, ip, severity = 'info' }) {
        const entry = {
            id: crypto.randomUUID(),
            timestamp: now(),
            actor: String(actor || 'system').trim(),
            action: String(action || 'unknown').trim(),
            target: String(target || '').trim(),
            details: details ? redactSensitive(details) : null,
            ip: String(ip || '').trim(),
            severity,
        };
        pendingEntries.push(entry);
        if (pendingEntries.length >= FLUSH_THRESHOLD) {
            writer.flush();
        } else {
            writer.schedule();
        }
        return entry;
    }

    function list(filters = {}) {
        // 读取前先落盘（含其他实例的 pending 写入），保证查询到最新数据
        flushWritersFor(filePath);
        const entries = retain(readEntries());
        const actor = String(filters.actor || '').trim();
        const action = String(filters.action || '').trim();
        const severity = String(filters.severity || '').trim();
        const limit = Math.min(500, Number(filters.limit) || 100);
        return entries.filter((entry) => {
            if (actor && entry.actor !== actor) return false;
            if (action && entry.action !== action) return false;
            if (severity && entry.severity !== severity) return false;
            return true;
        }).slice(0, limit);
    }

    return { record, list };
}

const defaultAuditLog = createAuditLog();

module.exports = {
    SCHEMA_VERSION,
    createAuditLog,
    record: defaultAuditLog.record,
    list: defaultAuditLog.list,
};
