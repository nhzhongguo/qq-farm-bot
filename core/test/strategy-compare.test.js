const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-farm-strategy-compare-test-'));
process.env.FARM_DATA_DIR = dataDir;

const stats = require('../src/services/stats');
const strategyCompare = require('../src/services/strategy-compare');

test.after(() => {
    fs.rmSync(dataDir, { recursive: true, force: true });
});

test('getCurrentStrategyPerformance returns zeros for empty history', () => {
    const result = strategyCompare.getCurrentStrategyPerformance('sc-acc-1', 7);
    assert.equal(result.goldAvg, 0);
    assert.equal(result.expAvg, 0);
    assert.equal(result.days, 0);
    assert.equal(result.strategy, 'max_exp');
});

test('getCurrentStrategyPerformance computes daily averages', () => {
    const accountId = 'sc-acc-2';
    stats.archiveDailySnapshot(accountId, { date: '2026-08-01', operations: { harvest: 5 }, gold: 100, exp: 50, goldGained: 20, expGained: 10, savedAt: 1 });
    stats.archiveDailySnapshot(accountId, { date: '2026-08-02', operations: { harvest: 3 }, gold: 140, exp: 70, goldGained: 40, expGained: 20, savedAt: 2 });
    stats.archiveDailySnapshot(accountId, { date: '2026-08-03', operations: { harvest: 4 }, gold: 200, exp: 95, goldGained: 60, expGained: 25, savedAt: 3 });
    
    const result = strategyCompare.getCurrentStrategyPerformance(accountId, 7);
    assert.equal(result.days, 3);
    assert.equal(result.goldAvg, Math.round((20 + 40 + 60) / 3));
    assert.equal(result.expAvg, Math.round((10 + 20 + 25) / 3));
});

test('compareStrategyPerformance returns recommendation for low data', () => {
    const result = strategyCompare.compareStrategyPerformance('sc-acc-3', 7);
    assert.ok(result.current);
    assert.ok(Array.isArray(result.theoretical));
    assert.ok(result.recommendation.includes('数据天数不足') || result.recommendation.includes('收益偏低') || result.recommendation.includes('表现优秀') || result.recommendation.includes('表现尚可'));
});

test('STRATEGY_LABELS covers all known strategies', () => {
    const labels = strategyCompare.STRATEGY_LABELS;
    assert.ok(labels.max_exp);
    assert.ok(labels.max_profit);
    assert.ok(labels.max_fert_exp);
    assert.ok(labels.max_fert_profit);
    assert.ok(labels.preferred);
    assert.ok(labels.level);
    assert.ok(labels.bag_priority);
});

test('getStrategyRecommendations returns sorted list', () => {
    const recs = strategyCompare.getStrategyRecommendations('sc-acc-4', 'max_exp', 3);
    assert.ok(Array.isArray(recs));
    for (const r of recs) {
        assert.ok(r.seedId);
        assert.ok(r.name);
        assert.ok(typeof r.metricValue === 'number');
    }
});

test('getStrategyRecommendations filters by current level and maps metric values', () => {
    const all = strategyCompare.getStrategyRecommendations('sc-acc-5', 'max_profit', 100);
    const limited = strategyCompare.getStrategyRecommendations('sc-acc-5', 'max_profit', 100, 1);

    assert.ok(all.length > 0);
    assert.ok(limited.length <= all.length);
    assert.ok(limited.every(r => r.level === null || r.level === undefined || Number(r.level) <= 1));
    assert.ok(limited.every(r => typeof r.metricValue === 'number' && Number.isFinite(r.metricValue)));
    assert.ok(limited.some(r => r.metricValue !== 0), 'metric mapping should return real analytics values');

    for (let i = 1; i < limited.length; i += 1) {
        assert.ok(limited[i - 1].metricValue >= limited[i].metricValue, 'recommendations should be sorted by the selected metric');
    }
});