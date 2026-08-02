const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test, before, after } = require('node:test');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-farm-alert-test-'));
const alertPath = path.join(dataDir, 'alert_rules.json');

const { createAlertRuleEngine } = require('../src/services/alert-rule-engine');

let engine;

before(() => {
    engine = createAlertRuleEngine({ filePath: alertPath, maxRules: 5, now: () => 1000000 });
});

after(() => {
    fs.rmSync(dataDir, { recursive: true, force: true });
});

test('creates a rule with valid parameters', () => {
    const rule = engine.createRule({
        name: '连续失败3次',
        description: '账号连续失败3次时告警',
        condition: 'consecutive_failures',
        threshold: 3,
        channel: 'log',
    });
    assert.ok(rule.id);
    assert.equal(rule.name, '连续失败3次');
    assert.equal(rule.condition, 'consecutive_failures');
    assert.equal(rule.threshold, 3);
    assert.equal(rule.channel, 'log');
    assert.equal(rule.enabled, true);
});

test('rejects empty rule name', () => {
    assert.throws(() => engine.createRule({
        name: '', condition: 'consecutive_failures', threshold: 1, channel: 'log',
    }), /名称/);
});

test('rejects invalid condition type', () => {
    assert.throws(() => engine.createRule({
        name: 'test', condition: 'invalid_type', threshold: 1, channel: 'log',
    }), /条件类型/);
});

test('rejects invalid channel type', () => {
    assert.throws(() => engine.createRule({
        name: 'test', condition: 'consecutive_failures', threshold: 1, channel: 'invalid_channel',
    }), /告警通道/);
});

test('rejects non-positive threshold', () => {
    assert.throws(() => engine.createRule({
        name: 'test', condition: 'consecutive_failures', threshold: 0, channel: 'log',
    }), /阈值/);
});

test('lists rules', () => {
    const rules = engine.listRules();
    assert.ok(rules.length >= 1);
});

test('gets a rule by id', () => {
    const rule = engine.createRule({
        name: '离线告警', condition: 'offline_duration', threshold: 300, channel: 'webhook', endpoint: 'http://example.com/hook',
    });
    const found = engine.getRule(rule.id);
    assert.ok(found);
    assert.equal(found.name, '离线告警');
    assert.equal(found.endpoint, 'http://example.com/hook');
});

test('toggles rule enabled state', () => {
    const rule = engine.createRule({
        name: '可切换规则', condition: 'consecutive_failures', threshold: 5, channel: 'log',
    });
    const disabled = engine.toggleRule(rule.id, false);
    assert.equal(disabled.enabled, false);
    const enabled = engine.toggleRule(rule.id, true);
    assert.equal(enabled.enabled, true);
});

test('deletes a rule', () => {
    const rule = engine.createRule({
        name: '待删除规则', condition: 'consecutive_failures', threshold: 1, channel: 'log',
    });
    const ok = engine.deleteRule(rule.id);
    assert.ok(ok);
    assert.equal(engine.getRule(rule.id), null);
});

test('evaluate triggers alert when threshold is met', () => {
    const rule = engine.createRule({
        name: '触发测试', condition: 'consecutive_failures', threshold: 2, channel: 'log',
    });
    const triggered = engine.evaluate({ consecutiveFailures: 3, username: 'testuser' });
    assert.ok(triggered.length >= 1);
    const found = triggered.find(t => t.ruleId === rule.id);
    assert.ok(found);
    assert.equal(found.actualValue, 3);
    assert.equal(found.threshold, 2);
    assert.equal(found.username, 'testuser');
});

test('evaluate does not trigger when below threshold', () => {
    const rule = engine.createRule({
        name: '不触发', condition: 'consecutive_failures', threshold: 10, channel: 'log',
    });
    const triggered = engine.evaluate({ consecutiveFailures: 2, username: 'testuser' });
    const found = triggered.find(t => t.ruleId === rule.id);
    assert.equal(found, undefined);
});

test('evaluate does not trigger disabled rules', () => {
    const rule = engine.createRule({
        name: '已禁用', condition: 'consecutive_failures', threshold: 1, channel: 'log',
    });
    engine.toggleRule(rule.id, false);
    const triggered = engine.evaluate({ consecutiveFailures: 5, username: 'testuser' });
    const found = triggered.find(t => t.ruleId === rule.id);
    assert.equal(found, undefined);
});

test('evaluate filters by username when rule has username set', () => {
    const rule = engine.createRule({
        name: '特定用户', condition: 'consecutive_failures', threshold: 1, channel: 'log',
        username: 'specific_user',
    });
    const triggered = engine.evaluate({ consecutiveFailures: 5, username: 'other_user' });
    const found = triggered.find(t => t.ruleId === rule.id);
    assert.equal(found, undefined);
});

test('listTriggers returns recent triggers', () => {
    engine.evaluate({ consecutiveFailures: 100, username: 'trigger_user' });
    const triggers = engine.listTriggers({ limit: 10 });
    assert.ok(triggers.length >= 1);
});

test('updates existing rule by name', () => {
    engine.createRule({ name: '更新测试', condition: 'consecutive_failures', threshold: 5, channel: 'log' });
    const updated = engine.createRule({ name: '更新测试', condition: 'consecutive_failures', threshold: 10, channel: 'log' });
    assert.equal(updated.threshold, 10);
    const rules = engine.listRules();
    assert.equal(rules.filter(r => r.name === '更新测试').length, 1);
});

test('retains bounded rules', () => {
    const shortEngine = createAlertRuleEngine({
        filePath: path.join(dataDir, 'alert_short.json'),
        maxRules: 2,
    });
    for (let i = 0; i < 5; i++) {
        shortEngine.createRule({ name: `规则${i}`, condition: 'consecutive_failures', threshold: 1, channel: 'log' });
    }
    assert.ok(shortEngine.listRules().length <= 2);
});
