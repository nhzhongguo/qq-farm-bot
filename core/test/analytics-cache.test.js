const assert = require('node:assert/strict');
const test = require('node:test');

const { getPlantRankings, __clearRankingCacheForTest } = require('../src/services/analytics');

test('getPlantRankings returns a sorted ranking list', () => {
    __clearRankingCacheForTest();
    const results = getPlantRankings('exp');
    assert.ok(Array.isArray(results));
    assert.ok(results.length > 0);
    // 按 expPerHour 降序
    for (let i = 1; i < results.length; i++) {
        assert.ok(results[i - 1].expPerHour >= results[i].expPerHour);
    }
});

test('rankings are cached within the TTL window', () => {
    __clearRankingCacheForTest();
    const first = getPlantRankings('profit');
    const second = getPlantRankings('profit');
    // 缓存命中时返回同一份引用（同一数组对象）
    assert.equal(first, second, 'second call within TTL should hit the cache');
});

test('different sort keys produce distinct cached results', () => {
    __clearRankingCacheForTest();
    const byExp = getPlantRankings('exp');
    const byProfit = getPlantRankings('profit');
    assert.notEqual(byExp, byProfit);
    // 两种排序下第一名可能不同，仅验证两个缓存相互独立
    assert.ok(byExp.length === byProfit.length);
});

test('clearing cache forces a fresh computation', () => {
    __clearRankingCacheForTest();
    const first = getPlantRankings('level');
    __clearRankingCacheForTest();
    const second = getPlantRankings('level');
    assert.notEqual(first, second, 'after clearing the cache a new array should be returned');
});
