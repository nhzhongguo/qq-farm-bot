const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-farm-report-test-'));
process.env.FARM_DATA_DIR = dataDir;

const stats = require('../src/services/stats');
const taskRunStore = require('../src/services/task-run-store');
const report = require('../src/services/report');

test.after(() => {
    fs.rmSync(dataDir, { recursive: true, force: true });
});

// 固定"今天"为 2026-08-05，便于断言
const NOW = new Date(2026, 7, 5, 10, 0, 0);

test('daily report aggregates a single day from stats archive', () => {
    const accountId = 'rep-acc-1';
    stats.archiveDailySnapshot(accountId, { date: '2026-08-04', operations: { harvest: 1 }, gold: 100, exp: 50, savedAt: 1 });
    stats.archiveDailySnapshot(accountId, { date: '2026-08-05', operations: { harvest: 6, steal: 2, taskClaim: 3 }, gold: 260, exp: 90, savedAt: 2 });

    const r = report.generateDailyReport(accountId, '2026-08-05');
    assert.equal(r.period, 'daily');
    assert.equal(r.range.start, '2026-08-05');
    assert.equal(r.range.end, '2026-08-05');
    assert.equal(r.summary.dataDays, 1);
    // 相对前一天的增量（stats.getStatsTrend 口径）
    assert.equal(r.summary.goldGained, 160);
    assert.equal(r.summary.expGained, 40);
    assert.equal(r.summary.harvest, 6);
    assert.equal(r.summary.steal, 2);
    assert.equal(r.summary.taskClaim, 3);
});

test('weekly report covers a 7-day window and excludes out-of-window days', () => {
    const accountId = 'rep-acc-2';
    for (let i = 0; i < 7; i++) {
        const date = `2026-07-${String(30 + i).padStart(2, '0')}`; // 07-30 .. 08-05
        stats.archiveDailySnapshot(accountId, { date, operations: { harvest: 1 }, gold: 100 + i * 10, exp: 50 + i, savedAt: i });
    }
    // 窗口外一天（07-29）
    stats.archiveDailySnapshot(accountId, { date: '2026-07-29', operations: { harvest: 99 }, gold: 50, exp: 20, savedAt: 100 });

    const r = report.generateWeeklyReport(accountId, '2026-07-30', '2026-08-05');
    assert.equal(r.period, 'weekly');
    assert.equal(r.summary.days, 7);
    assert.equal(r.summary.dataDays, 7);
    assert.equal(r.summary.harvest, 7, 'out-of-window 07-29 should be excluded');
});

test('empty history yields an empty report without throwing', () => {
    const r = report.generateDailyReport('rep-acc-3', '2026-08-05');
    assert.equal(r.summary.dataDays, 0);
    assert.equal(r.summary.goldGained, 0);
    assert.equal(r.summary.expGained, 0);
    assert.equal(r.summary.harvest, undefined);
    assert.deepEqual(r.trend, []);
});

test('invalid inputs throw descriptive errors', () => {
    assert.throws(() => report.buildRangeReport('', '2026-08-05', '2026-08-05'), /accountId/);
    assert.throws(() => report.buildRangeReport('rep-acc-4', '2026-08-05', '2026-08-04'), /无效的日期区间/);
    assert.throws(() => report.generateCompareReport([], 7), /accountIds/);
});

test('renderHtml escapes dynamic values against injection', () => {
    const r = report.generateDailyReport('rep-acc-5', '2026-08-05');
    r.accountId = '<script>alert(1)</script>';
    r.summary.goldGained = 100;
    r.issues = [{ taskName: '<img src=x onerror=alert(1)>', startedAt: 1, error: 'oops"<b>' }];
    const html = report.renderHtml(r);
    assert.ok(!html.includes('<script>'), 'raw script tag must not appear');
    assert.ok(html.includes('&lt;script&gt;'), 'script must be escaped');
    assert.ok(html.includes('金币增量'));
    assert.ok(html.includes('&lt;img'), 'issue task name must be escaped');
});

test('report summarizes task runs and failure issues from task-run-store', () => {
    const accountId = 'rep-acc-6';
    const dayStart = new Date(2026, 7, 5, 0, 0, 0).getTime();
    const run1 = taskRunStore.startRun({ accountId, taskName: 'harvest', trigger: 'scheduler', startedAt: dayStart + 1000 });
    taskRunStore.finishRun(run1.id, { status: 'success', endedAt: dayStart + 5000 });
    const run2 = taskRunStore.startRun({ accountId, taskName: 'steal', trigger: 'scheduler', startedAt: dayStart + 2000 });
    taskRunStore.finishRun(run2.id, { status: 'failed', endedAt: dayStart + 6000, error: 'timeout after 5s' });
    // 窗口外任务（昨天）
    taskRunStore.startRun({ accountId, taskName: 'water', trigger: 'manual', startedAt: dayStart - 86400000 });

    const r = report.generateDailyReport(accountId, '2026-08-05');
    assert.equal(r.summary.taskTotal, 2, 'out-of-window task must be excluded');
    assert.equal(r.summary.taskSuccess, 1);
    assert.equal(r.summary.taskFailed, 1);
    assert.equal(r.summary.issueCount, 1);
    assert.equal(r.issues[0].taskName, 'steal');
    assert.equal(r.issues[0].error, 'timeout after 5s');
});

test('compare report aggregates multiple accounts over a window', () => {
    const a = 'rep-acc-7a';
    const b = 'rep-acc-7b';
    stats.archiveDailySnapshot(a, { date: '2026-08-05', operations: { harvest: 4 }, gold: 200, exp: 80, savedAt: 1 });
    stats.archiveDailySnapshot(b, { date: '2026-08-05', operations: { steal: 9 }, gold: 300, exp: 60, savedAt: 2 });

    const r = report.generateCompareReport([a, b], 7, NOW);
    assert.equal(r.period, 'compare');
    assert.equal(r.range.days, 7);
    assert.equal(r.accounts.length, 2);
    const byId = Object.fromEntries(r.accounts.map(x => [x.accountId, x]));
    assert.equal(byId[a].summary.harvest, 4);
    assert.equal(byId[b].summary.steal, 9);
});

test('daily report defaults to today when date is omitted', () => {
    const accountId = 'rep-acc-8';
    stats.archiveDailySnapshot(accountId, { date: '2026-08-05', operations: { plant: 2 }, gold: 50, exp: 10, savedAt: 1 });
    const r = report.generateDailyReport(accountId, null, NOW);
    assert.equal(r.range.start, '2026-08-05');
    assert.equal(r.summary.plant, 2);
});
