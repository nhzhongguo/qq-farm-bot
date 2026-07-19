const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const test = require('node:test');
const { createWorkerManager } = require('../src/runtime/worker-manager');

test('worker manager persists task lifecycle with the trusted worker account id', () => {
    let workerInstance = null;
    class FakeWorker extends EventEmitter {
        constructor() { super(); workerInstance = this; }
        postMessage() {}
        terminate() {}
    }
    const recorded = [];
    const workers = {};
    const manager = createWorkerManager({
        WorkerThread: FakeWorker, runtimeMode: 'thread', processRef: { pkg: false, env: {} }, workerScriptPath: 'fake-worker.js',
        workers, globalLogs: [], log: () => {}, addAccountLog: () => {}, normalizeStatusForPanel: value => value,
        buildConfigSnapshotForAccount: () => ({}), getOfflineAutoDeleteMs: () => Number.POSITIVE_INFINITY,
        triggerOfflineReminder: () => {}, addOrUpdateAccount: () => {}, deleteAccount: () => {},
        recordTaskRunEvent: (accountId, event, run) => recorded.push({ accountId, event, run }),
    });
    assert.equal(manager.startWorker({ id: 'account-a', name: 'Farm A' }), true);
    workerInstance.emit('message', { type: 'task_run', event: 'started', run: { id: 'run-1', accountId: 'spoofed-account', taskName: 'farm_check', startedAt: 1000 } });
    assert.equal(recorded[0].accountId, 'account-a');
    assert.equal(recorded[0].run.accountId, 'spoofed-account');
    workerInstance.emit('exit', 0, null);
    assert.equal(workers['account-a'], undefined);
});
