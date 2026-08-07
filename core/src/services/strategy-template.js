const crypto = require('node:crypto');
const { getDataFile } = require('../config/runtime-paths');
const { readJsonFile, writeJsonFileAtomic } = require('./json-db');

const SCHEMA_VERSION = 1;
const DEFAULT_MAX_TEMPLATES = 20;

// 允许导出的配置字段（白名单）
const EXPORTABLE_FIELDS = [
    'intervals', 'strategy', 'preferredSeed', 'friendQuietHours',
    'automation', 'stealDelaySeconds', 'plantOrderRandom', 'plantDelaySeconds',
    'fertilizerBuyOrganicCount', 'fertilizerBuyOrganicThresholdHours',
    'fertilizerBuyNormalCount', 'fertilizerBuyNormalThresholdHours',
    'fertilizerBuyCheckIntervalMinutes', 'bagSeedPriority', 'bagSeedFallbackStrategy',
];

function normalizeOwner(owner) {
    return owner ? String(owner) : null;
}

function isTemplateVisible(template, owner) {
    const normalizedOwner = normalizeOwner(owner);
    if (normalizedOwner === null) return true;
    return !template.owner || String(template.owner) === normalizedOwner;
}

function canModifyTemplate(template, owner) {
    const normalizedOwner = normalizeOwner(owner);
    if (normalizedOwner === null) return true;
    return String(template.owner || '') === normalizedOwner;
}

function createStrategyTemplate(options = {}) {
    const filePath = options.filePath || getDataFile('strategy_templates.json');
    const maxTemplates = options.maxTemplates || DEFAULT_MAX_TEMPLATES;

    function readTemplates() {
        const data = readJsonFile(filePath, () => ({ schemaVersion: SCHEMA_VERSION, templates: [] }));
        if (!data || !Array.isArray(data.templates)) return [];
        return data.templates;
    }

    function persist(templates) {
        const trimmed = templates.slice(0, maxTemplates);
        writeJsonFileAtomic(filePath, { schemaVersion: SCHEMA_VERSION, templates: trimmed });
        return trimmed;
    }

    /**
     * 导出账号配置为 JSON 对象
     * @param {object} configData - 从 /api/settings 获取的配置数据
     * @returns {object} 可导出的配置对象
     */
    function exportConfig(configData) {
        const result = { schemaVersion: SCHEMA_VERSION, exportedAt: Date.now(), config: {} };
        for (const field of EXPORTABLE_FIELDS) {
            if (configData && configData[field] !== undefined) {
                result.config[field] = configData[field];
            }
        }
        return result;
    }

    /**
     * 验证导入的配置对象
     * @param {object} importData - 导入的 JSON 对象
     * @returns {{valid: boolean, errors: string[], config: object | null}} 验证结果，包含是否有效、错误列表和解析后的配置
     */
    function validateImport(importData) {
        const errors = [];
        if (!importData || typeof importData !== 'object') {
            return { valid: false, errors: ['无效的 JSON 对象'], config: null };
        }
        if (!importData.config || typeof importData.config !== 'object') {
            return { valid: false, errors: ['缺少 config 字段'], config: null };
        }

        const config = {};
        for (const field of EXPORTABLE_FIELDS) {
            if (importData.config[field] !== undefined) {
                config[field] = importData.config[field];
            }
        }

        // 验证 intervals
        if (config.intervals) {
            const { farmMin, farmMax, helpMin, helpMax, stealMin, stealMax } = config.intervals;
            if (farmMin !== undefined && (typeof farmMin !== 'number' || farmMin < 0)) errors.push('intervals.farmMin 必须为非负数');
            if (farmMax !== undefined && (typeof farmMax !== 'number' || farmMax < 0)) errors.push('intervals.farmMax 必须为非负数');
            if (helpMin !== undefined && (typeof helpMin !== 'number' || helpMin < 0)) errors.push('intervals.helpMin 必须为非负数');
            if (helpMax !== undefined && (typeof helpMax !== 'number' || helpMax < 0)) errors.push('intervals.helpMax 必须为非负数');
            if (stealMin !== undefined && (typeof stealMin !== 'number' || stealMin < 0)) errors.push('intervals.stealMin 必须为非负数');
            if (stealMax !== undefined && (typeof stealMax !== 'number' || stealMax < 0)) errors.push('intervals.stealMax 必须为非负数');
        }

        // 验证 strategy
        const VALID_STRATEGIES = ['level', 'preferred', 'bag_priority', 'analytics_profit', 'analytics_exp'];
        if (config.strategy && !VALID_STRATEGIES.includes(config.strategy)) {
            errors.push(`strategy 必须为以下值之一: ${VALID_STRATEGIES.join(', ')}`);
        }

        // 验证 automation
        if (config.automation) {
            const boolFields = ['autoHarvest', 'autoPlant', 'autoWater', 'autoFertilize', 'autoWeed', 'autoPest', 'autoSteal', 'autoHelp', 'autoBuySeed'];
            for (const field of boolFields) {
                if (config.automation[field] !== undefined && typeof config.automation[field] !== 'boolean') {
                    errors.push(`automation.${field} 必须为布尔值`);
                }
            }
        }

        return { valid: errors.length === 0, errors, config: errors.length === 0 ? config : null };
    }

    /**
     * 保存为模板
     * @param {string} name - 模板名称
     * @param {string} [description] - 模板描述
     * @param {object} configData - 配置数据
     */
    function saveTemplate(name, description, configData, owner = null) {
        const trimmedName = String(name || '').trim();
        if (!trimmedName) throw new Error('模板名称不能为空');
        if (trimmedName.length > 50) throw new Error('模板名称不能超过 50 个字符');

        const templates = readTemplates();
        const ownerKey = String(normalizeOwner(owner) || '');
        const existing = templates.findIndex(t => t.name === trimmedName && String(t.owner || '') === ownerKey);
        const exported = exportConfig(configData);
        const template = {
            id: existing >= 0 ? templates[existing].id : `tpl_${Date.now()}_${crypto.randomBytes(6).toString('hex')}`,
            name: trimmedName,
            owner: normalizeOwner(owner),
            description: String(description || '').trim().slice(0, 200),
            createdAt: existing >= 0 ? templates[existing].createdAt : Date.now(),
            updatedAt: Date.now(),
            config: exported.config,
        };

        if (existing >= 0) {
            templates[existing] = template;
        } else {
            templates.unshift(template);
        }

        persist(templates);
        return template;
    }

    function listTemplates(owner = null) {
        return readTemplates()
            .filter(t => isTemplateVisible(t, owner))
            .map(t => ({
                id: t.id,
                name: t.name,
                owner: t.owner || null,
                description: t.description,
                createdAt: t.createdAt,
                updatedAt: t.updatedAt,
            }));
    }

    function getTemplate(id, owner = null) {
        const template = readTemplates().find(t => t.id === id) || null;
        return template && isTemplateVisible(template, owner) ? template : null;
    }

    function deleteTemplate(id, owner = null) {
        const templates = readTemplates();
        const idx = templates.findIndex(t => t.id === id);
        if (idx < 0) return false;
        if (!canModifyTemplate(templates[idx], owner)) return false;
        templates.splice(idx, 1);
        persist(templates);
        return true;
    }

    return {
        exportConfig,
        validateImport,
        saveTemplate,
        listTemplates,
        getTemplate,
        deleteTemplate,
    };
}

const defaultTemplate = createStrategyTemplate();

module.exports = {
    SCHEMA_VERSION,
    EXPORTABLE_FIELDS,
    createStrategyTemplate,
    exportConfig: defaultTemplate.exportConfig,
    validateImport: defaultTemplate.validateImport,
    saveTemplate: defaultTemplate.saveTemplate,
    listTemplates: defaultTemplate.listTemplates,
    getTemplate: defaultTemplate.getTemplate,
    deleteTemplate: defaultTemplate.deleteTemplate,
};
