const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test, before, after } = require('node:test');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-farm-tmpl-test-'));
const tmplPath = path.join(dataDir, 'strategy_templates.json');

const { createStrategyTemplate } = require('../src/services/strategy-template');

let tmpl;

const sampleConfig = {
    intervals: { farmMin: 2, farmMax: 5, helpMin: 10, helpMax: 15, stealMin: 10, stealMax: 15 },
    strategy: 'bag_priority',
    preferredSeed: 'apple',
    automation: { autoHarvest: true, autoPlant: true, autoWater: false },
    stealDelaySeconds: 5,
    plantOrderRandom: false,
    bagSeedPriority: ['apple', 'orange'],
    bagSeedFallbackStrategy: 'level',
    // 不可导出字段
    ui: { theme: 'dark' },
    offlineReminder: { channel: 'webhook' },
};

before(() => {
    tmpl = createStrategyTemplate({ filePath: tmplPath, maxTemplates: 5 });
});

after(() => {
    fs.rmSync(dataDir, { recursive: true, force: true });
});

test('exportConfig only includes exportable fields', () => {
    const exported = tmpl.exportConfig(sampleConfig);
    assert.equal(exported.schemaVersion, 1);
    assert.ok(exported.exportedAt > 0);
    assert.equal(exported.config.intervals.farmMin, 2);
    assert.equal(exported.config.strategy, 'bag_priority');
    assert.equal(exported.config.automation.autoHarvest, true);
    assert.equal(exported.config.ui, undefined);
    assert.equal(exported.config.offlineReminder, undefined);
});

test('validateImport accepts valid config', () => {
    const exported = tmpl.exportConfig(sampleConfig);
    const result = tmpl.validateImport(exported);
    assert.ok(result.valid);
    assert.equal(result.errors.length, 0);
    assert.equal(result.config.intervals.farmMin, 2);
});

test('validateImport rejects missing config field', () => {
    const result = tmpl.validateImport({ schemaVersion: 1 });
    assert.ok(!result.valid);
    assert.ok(result.errors.some(e => e.includes('config')));
});

test('validateImport rejects invalid strategy', () => {
    const exported = tmpl.exportConfig(sampleConfig);
    exported.config.strategy = 'invalid_strategy';
    const result = tmpl.validateImport(exported);
    assert.ok(!result.valid);
    assert.ok(result.errors.some(e => e.includes('strategy')));
});

test('validateImport rejects non-boolean automation fields', () => {
    const exported = tmpl.exportConfig(sampleConfig);
    exported.config.automation.autoHarvest = 'yes';
    const result = tmpl.validateImport(exported);
    assert.ok(!result.valid);
    assert.ok(result.errors.some(e => e.includes('autoHarvest')));
});

test('saveTemplate creates a new template', () => {
    const template = tmpl.saveTemplate('快速收获', '适合活跃玩家', sampleConfig);
    assert.ok(template.id);
    assert.equal(template.name, '快速收获');
    assert.equal(template.description, '适合活跃玩家');
    assert.equal(template.config.intervals.farmMin, 2);
});

test('listTemplates returns template metadata without config', () => {
    tmpl.saveTemplate('模板2', 'desc', sampleConfig);
    const list = tmpl.listTemplates();
    assert.ok(list.length >= 2);
    assert.equal(list[0].name, '模板2');
    assert.equal(list[0].config, undefined);
});

test('getTemplate returns full template with config', () => {
    const saved = tmpl.saveTemplate('完整模板', 'desc', sampleConfig);
    const found = tmpl.getTemplate(saved.id);
    assert.ok(found);
    assert.equal(found.name, '完整模板');
    assert.equal(found.config.strategy, 'bag_priority');
});

test('saveTemplate updates existing template by name', () => {
    tmpl.saveTemplate('可更新模板', 'v1', sampleConfig);
    const updated = tmpl.saveTemplate('可更新模板', 'v2', { ...sampleConfig, strategy: 'level' });
    assert.equal(updated.description, 'v2');
    assert.equal(updated.config.strategy, 'level');
    const list = tmpl.listTemplates();
    assert.equal(list.filter(t => t.name === '可更新模板').length, 1);
});

test('deleteTemplate removes a template', () => {
    const saved = tmpl.saveTemplate('待删除', '', sampleConfig);
    const ok = tmpl.deleteTemplate(saved.id);
    assert.ok(ok);
    assert.equal(tmpl.getTemplate(saved.id), null);
});

test('deleteTemplate returns false for non-existent id', () => {
    assert.ok(!tmpl.deleteTemplate('non-existent'));
});

test('template owner isolation prevents cross-user overwrite and access', () => {
    const alice = tmpl.saveTemplate('同名作物', 'alice copy', sampleConfig, 'alice');
    const bob = tmpl.saveTemplate('同名作物', 'bob copy', { ...sampleConfig, strategy: 'level' }, 'bob');

    assert.equal(alice.id === bob.id, false);
    assert.equal(alice.config.strategy, 'bag_priority');
    assert.equal(bob.config.strategy, 'level');

    const aliceList = tmpl.listTemplates('alice').filter(t => t.name === '同名作物');
    const bobList = tmpl.listTemplates('bob').filter(t => t.name === '同名作物');
    assert.equal(aliceList.length, 1);
    assert.equal(bobList.length, 1);
    assert.equal(aliceList[0].id, alice.id);
    assert.equal(bobList[0].id, bob.id);

    assert.equal(tmpl.getTemplate(alice.id, 'bob'), null);
    assert.equal(tmpl.getTemplate(bob.id, 'alice'), null);
    assert.equal(tmpl.deleteTemplate(alice.id, 'bob'), false);
    assert.ok(tmpl.getTemplate(alice.id, 'alice'));
    assert.equal(tmpl.deleteTemplate(alice.id, 'alice'), true);
});

test('legacy templates without owner remain visible to every user', () => {
    const legacy = tmpl.saveTemplate('公共旧模板', '', sampleConfig);
    assert.ok(tmpl.getTemplate(legacy.id, 'alice'));
    assert.ok(tmpl.getTemplate(legacy.id, 'bob'));
});

test('saveTemplate throws for empty name', () => {
    assert.throws(() => tmpl.saveTemplate('', '', sampleConfig), /名称/);
});

test('retains bounded templates', () => {
    const shortTmpl = createStrategyTemplate({
        filePath: path.join(dataDir, 'tmpl_short.json'),
        maxTemplates: 2,
    });
    for (let i = 0; i < 5; i++) {
        shortTmpl.saveTemplate(`模板${i}`, '', sampleConfig);
    }
    assert.ok(shortTmpl.listTemplates().length <= 2);
});
