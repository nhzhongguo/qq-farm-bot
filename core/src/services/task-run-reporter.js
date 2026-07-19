const crypto = require('node:crypto');

function createTaskRunReporter(options = {}) {
    const accountId = String(options.accountId || '').trim();
    const send = typeof options.send === 'function' ? options.send : () => {};
    const now = typeof options.now === 'function' ? options.now : Date.now;
    const idFactory = typeof options.idFactory === 'function' ? options.idFactory : crypto.randomUUID;

    function report(message) {
        try { send(message); } catch { /* A history write must not stop automation. */ }
    }

    async function run(taskName, trigger, taskFn) {
        if (typeof taskFn !== 'function') throw new Error('taskFn 必须是函数');
        const id = String(idFactory());
        const startedAt = now();
        report({ type: 'task_run', event: 'started', run: {
            id, accountId, taskName: String(taskName || '').trim(),
            trigger: String(trigger || 'scheduler').trim() || 'scheduler', startedAt,
        } });
        try {
            const result = await taskFn();
            report({ type: 'task_run', event: 'finished', run: { id, accountId, status: 'success', endedAt: now(), error: null } });
            return result;
        } catch (error) {
            report({ type: 'task_run', event: 'finished', run: {
                id, accountId, status: 'failed', endedAt: now(), error: error && error.message ? error.message : String(error),
            } });
            throw error;
        }
    }

    return { run };
}

module.exports = { createTaskRunReporter };
