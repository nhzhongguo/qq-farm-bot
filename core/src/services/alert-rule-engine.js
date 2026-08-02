const crypto = require('node:crypto');
const { getDataFile } = require('../config/runtime-paths');
const { readJsonFile, writeJsonFileAtomic } = require('./json-db');

const SCHEMA_VERSION = 1;
const DEFAULT_MAX_RULES = 20;

// 告警规则条件类型
const CONDITION_TYPES = {
    consecutive_failures: '连续失败次数',
    offline_duration: '离线时长（秒）',
    task_error_count: '任务错误总数',
};

// 告警通道类型
const CHANNEL_TYPES = {
    webhook: 'Webhook',
    log: '系统日志',
};

function createAlertRuleEngine(options = {}) {
    const filePath = options.filePath || getDataFile('alert_rules.json');
    const maxRules = options.maxRules || DEFAULT_MAX_RULES;
    const now = typeof options.now === 'function' ? options.now : Date.now;

    function readRules() {
        const data = readJsonFile(filePath, () => ({ schemaVersion: SCHEMA_VERSION, rules: [], triggers: [] }));
        if (!data || !Array.isArray(data.rules)) return { rules: [], triggers: [] };
        return { rules: data.rules, triggers: data.triggers || [] };
    }

    function persist(rules, triggers) {
        const trimmedRules = rules.slice(0, maxRules);
        const trimmedTriggers = (triggers || []).slice(-100);
        writeJsonFileAtomic(filePath, { schemaVersion: SCHEMA_VERSION, rules: trimmedRules, triggers: trimmedTriggers });
    }

    function createRule({ name, description, condition, threshold, channel, endpoint, username }) {
        const trimmedName = String(name || '').trim();
        if (!trimmedName) throw new Error('规则名称不能为空');
        if (!CONDITION_TYPES[condition]) throw new Error(`不支持的条件类型: ${condition}`);
        if (!CHANNEL_TYPES[channel]) throw new Error(`不支持的告警通道: ${channel}`);
        const numThreshold = Number(threshold);
        if (!Number.isFinite(numThreshold) || numThreshold <= 0) throw new Error('阈值必须为正数');

        const { rules, triggers } = readRules();
        const existing = rules.findIndex(r => r.name === trimmedName);
        const rule = {
            id: existing >= 0 ? rules[existing].id : crypto.randomUUID(),
            name: trimmedName,
            description: String(description || '').trim().slice(0, 200),
            condition,
            threshold: numThreshold,
            channel,
            endpoint: channel === 'webhook' ? String(endpoint || '').trim() : '',
            username: String(username || '').trim(),
            enabled: existing >= 0 ? rules[existing].enabled : true,
            createdAt: existing >= 0 ? rules[existing].createdAt : now(),
            updatedAt: now(),
        };

        if (existing >= 0) {
            rules[existing] = rule;
        } else {
            rules.unshift(rule);
        }
        persist(rules, triggers);
        return rule;
    }

    function listRules() {
        const { rules } = readRules();
        return rules;
    }

    function getRule(id) {
        const { rules } = readRules();
        return rules.find(r => r.id === id) || null;
    }

    function deleteRule(id) {
        const { rules, triggers } = readRules();
        const idx = rules.findIndex(r => r.id === id);
        if (idx < 0) return false;
        rules.splice(idx, 1);
        persist(rules, triggers);
        return true;
    }

    function toggleRule(id, enabled) {
        const { rules, triggers } = readRules();
        const rule = rules.find(r => r.id === id);
        if (!rule) return null;
        rule.enabled = !!enabled;
        rule.updatedAt = now();
        persist(rules, triggers);
        return rule;
    }

    /**
     * 评估告警条件并触发告警
     * @param {object} context - 上下文数据
     * @param {string} [context.username] - 用户名
     * @param {number} [context.consecutiveFailures] - 连续失败次数
     * @param {number} [context.offlineDurationSec] - 离线时长（秒）
     * @param {number} [context.taskErrorCount] - 任务错误总数
     * @returns {Array} 触发的告警列表
     */
    function evaluate(context) {
        const { rules, triggers } = readRules();
        const triggered = [];

        for (const rule of rules) {
            if (!rule.enabled) continue;
            if (rule.username && context.username && rule.username !== context.username) continue;

            let value = 0;
            switch (rule.condition) {
                case 'consecutive_failures':
                    value = context.consecutiveFailures || 0;
                    break;
                case 'offline_duration':
                    value = context.offlineDurationSec || 0;
                    break;
                case 'task_error_count':
                    value = context.taskErrorCount || 0;
                    break;
            }

            if (value >= rule.threshold) {
                const trigger = {
                    id: crypto.randomUUID(),
                    ruleId: rule.id,
                    ruleName: rule.name,
                    condition: rule.condition,
                    threshold: rule.threshold,
                    actualValue: value,
                    username: context.username || '',
                    triggeredAt: now(),
                    channel: rule.channel,
                    endpoint: rule.endpoint,
                };
                triggered.push(trigger);
                triggers.push(trigger);
            }
        }

        if (triggered.length > 0) {
            persist(rules, triggers);
        }

        return triggered;
    }

    function listTriggers(filters = {}) {
        const { triggers } = readRules();
        const limit = Math.min(50, Number(filters.limit) || 20);
        const ruleId = String(filters.ruleId || '').trim();
        return triggers
            .filter(t => !ruleId || t.ruleId === ruleId)
            .slice(-limit)
            .reverse();
    }

    return {
        createRule,
        listRules,
        getRule,
        deleteRule,
        toggleRule,
        evaluate,
        listTriggers,
    };
}

const defaultEngine = createAlertRuleEngine();

module.exports = {
    SCHEMA_VERSION,
    CONDITION_TYPES,
    CHANNEL_TYPES,
    createAlertRuleEngine,
    createRule: defaultEngine.createRule,
    listRules: defaultEngine.listRules,
    getRule: defaultEngine.getRule,
    deleteRule: defaultEngine.deleteRule,
    toggleRule: defaultEngine.toggleRule,
    evaluate: defaultEngine.evaluate,
    listTriggers: defaultEngine.listTriggers,
};
