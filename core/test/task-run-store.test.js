const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { createTaskRunReporter } = require('../src/services/task-run-reporter');
const { createTaskRunStore } = require('../src/services/task-run-store');

function createFixture(options = {}) {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-farm-task-runs-'));
    const filePath = path.join(dataDir, 'task_runs.json');
    let currentTime = options.now || 1_700_000_000_000;
    let sequence = 0;
    return {
        dataDir,
        filePath,
        store: createTaskRunStore({
            filePath, retentionDays: options.retentionDays || 30, maxRecords: options.maxRecords || 100,
            now: () => currentTime, idFactory: () => `run-${++sequence}`,
        }),
        setNow(value) { currentTime = value; },
        cleanup() { fs.rmSync(dataDir, { recursive: true, force: true }); },
    };
}

test('persists successful and failed task runs with a stable schema', () => {
    const fixture = createFixture();
    try {
        const success = fixture.store.startRun({ accountId: 'account-a', taskName: 'farm_check', trigger: 'scheduler' });
        fixture.setNow(1_700_000_000_125);
        const completed = fixture.store.finishRun(success.id, { status: 'success' });
        const failure = fixture.store.startRun({ accountId: 'account-a', taskName: 'friend_help' });
        fixture.setNow(1_700_000_000_200);
        const failed = fixture.store.finishRun(failure.id, { status: 'failed', error: new Error('network unavailable') });

        assert.deepEqual(Object.keys(completed), ['id', 'accountId', 'taskName', 'trigger', 'status', 'startedAt', 'endedAt', 'durationMs', 'error']);
        assert.equal(completed.durationMs, 125);
        assert.equal(completed.error, null);
        assert.equal(failed.status, 'failed');
        assert.equal(failed.error, 'network unavailable');
        assert.equal(JSON.parse(fs.readFileSync(fixture.filePath, 'utf8')).schemaVersion, 1);
        assert.deepEqual(fixture.store.listRuns({ accountIds: ['account-a'] }), [failed, completed]);
    } finally { fixture.cleanup(); }
});

test('retains bounded recent records and filters account ownership', () => {
    const dayMs = 24 * 60 * 60 * 1000;
    const fixture = createFixture({ retentionDays: 7, maxRecords: 2, now: 10 * dayMs });
    try {
        const oldRun = fixture.store.startRun({ accountId: 'a', taskName: 'old' });
        fixture.store.finishRun(oldRun.id, { status: 'success' });
        fixture.setNow(18 * dayMs);
        const recent = fixture.store.startRun({ accountId: 'a', taskName: 'recent' });
        fixture.store.finishRun(recent.id, { status: 'success' });
        fixture.setNow(19 * dayMs);
        const newest = fixture.store.startRun({ accountId: 'b', taskName: 'newest' });
        fixture.store.finishRun(newest.id, { status: 'failed', error: 'boom' });
        const reopened = createTaskRunStore({ filePath: fixture.filePath, retentionDays: 7, maxRecords: 2, now: () => 19 * dayMs });
        assert.deepEqual(reopened.listRuns().map(run => run.taskName), ['newest', 'recent']);
        assert.deepEqual(reopened.listRuns({ accountIds: ['a'] }).map(run => run.taskName), ['recent']);
        assert.deepEqual(reopened.listRuns({ accountIds: [] }), []);
    } finally { fixture.cleanup(); }
});

test('reports lifecycle events and rethrows failed work', async () => {
    const messages = [];
    let currentTime = 1000;
    const reporter = createTaskRunReporter({ accountId: 'account-a', send: message => messages.push(message), now: () => currentTime, idFactory: () => 'worker-run-1' });
    const result = await reporter.run('farm_check', 'scheduler', async () => { currentTime = 1125; return 42; });
    assert.equal(result, 42);
    assert.equal(messages[0].event, 'started');
    assert.equal(messages[1].run.status, 'success');
    messages.length = 0;
    currentTime = 2000;
    await assert.rejects(reporter.run('friend_help', 'scheduler', async () => { currentTime = 2050; throw new Error('friend service failed'); }), /friend service failed/);
    assert.equal(messages[1].run.status, 'failed');
    assert.equal(messages[1].run.error, 'friend service failed');
});
