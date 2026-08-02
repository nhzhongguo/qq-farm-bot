const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-farm-stats-trend-test-'));
process.env.FARM_DATA_DIR = dataDir;

const stats = require('../src/services/stats');

test.after(() => {
    fs.rmSync(dataDir, { recursive: true, force: true });
});

test('archiving daily snapshots keeps at most 90 entries and overwrites same date', () => {
    const accountId = 'trend-acc-1';
    stats.archiveDailySnapshot(accountId, { date: '2026-07-01', operations: { harvest: 5 }, gold: 100, exp: 50, savedAt: 1000 });
    stats.archiveDailySnapshot(accountId, { date: '2026-07-01', operations: { harvest: 9 }, gold: 120, exp: 60, savedAt: 2000 });
    stats.archiveDailySnapshot(accountId, { date: '2026-07-02', operations: { harvest: 3 }, gold: 130, exp: 70, savedAt: 3000 });

    const daily = stats.loadDailyHistory(accountId);
    assert.equal(daily.length, 2);
    assert.equal(daily[0].date, '2026-07-01');
    assert.equal(daily[0].operations.harvest, 9, 'same-date snapshot should be overwritten');
    assert.equal(daily[0].gold, 120);
    assert.equal(daily[1].date, '2026-07-02');
});

test('getStatsTrend returns incremental gains and newest-first window', () => {
    const accountId = 'trend-acc-2';
    stats.archiveDailySnapshot(accountId, { date: '2026-07-01', operations: {}, gold: 100, exp: 50, savedAt: 1000 });
    stats.archiveDailySnapshot(accountId, { date: '2026-07-02', operations: { harvest: 4 }, gold: 150, exp: 60, savedAt: 2000 });

    const points = stats.getStatsTrend(accountId, 30);
    assert.equal(points.length, 2);
    // first point: gains equal absolute values (no previous)
    assert.equal(points[0].goldGained, 100);
    // second point: incremental from previous day
    assert.equal(points[1].goldGained, 50);
    assert.equal(points[1].expGained, 10);
    assert.equal(points[1].operations.harvest, 4);
});

test('getStatsTrend caps requested days at 90 and tolerates empty history', () => {
    const accountId = 'trend-acc-3';
    const empty = stats.getStatsTrend(accountId, 30);
    assert.deepEqual(empty, []);

    for (let i = 1; i <= 100; i++) {
        const day = String(i).padStart(2, '0');
        stats.archiveDailySnapshot(accountId, { date: `2026-06-${day}`, operations: {}, gold: i, exp: i * 2, savedAt: i });
    }
    const capped = stats.getStatsTrend(accountId, 999);
    assert.ok(capped.length <= 90, `should cap at 90, got ${capped.length}`);
});

test('cross-day init archives the previous day into history', () => {
    const accountId = 'trend-acc-4';
    // 模拟昨天的持久化数据
    const statsFile = path.join(dataDir, 'stats', `${accountId}.json`);
    fs.mkdirSync(path.dirname(statsFile), { recursive: true });
    fs.writeFileSync(statsFile, JSON.stringify({
        date: '2026-07-01',
        operations: { harvest: 7 },
        gold: 200,
        exp: 90,
        savedAt: 1234,
    }), 'utf8');

    // 以"今天"启动（测试环境真实日期与 2026-07-01 不同 → 触发跨天归档）
    stats.initStatsWithPersistence(accountId, 200, 90, 0);
    const daily = stats.loadDailyHistory(accountId);
    const archived = daily.find(d => d.date === '2026-07-01');
    assert.ok(archived, 'previous day should be archived on cross-day init');
    assert.equal(archived.operations.harvest, 7);
    assert.equal(archived.gold, 200);
});
