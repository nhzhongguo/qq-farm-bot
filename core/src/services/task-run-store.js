const crypto = require('node:crypto');
const process = require('node:process');
const { getDataFile } = require('../config/runtime-paths');
const { readJsonFile, writeJsonFileAtomic } = require('./json-db');

const SCHEMA_VERSION = 1;
const DEFAULT_RETENTION_DAYS = 30;
const DEFAULT_MAX_RECORDS = 2000;
const VALID_STATUSES = new Set(['running', 'success', 'failed']);

function positiveInteger(value, fallback) {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function errorMessage(error) {
    if (error == null || error === '') return null;
    const message = error instanceof Error ? error.message : String(error);
    return message.slice(0, 2000) || null;
}

function normalizeRun(run) {
    const source = run && typeof run === 'object' ? run : {};
    const status = VALID_STATUSES.has(source.status) ? source.status : 'running';
    const startedAt = Math.max(0, Number(source.startedAt) || 0);
    const endedAt = status === 'running' ? null : Math.max(startedAt, Number(source.endedAt) || startedAt);
    return {
        id: String(source.id || ''),
        accountId: String(source.accountId || ''),
        taskName: String(source.taskName || ''),
        trigger: String(source.trigger || 'scheduler'),
        status,
        startedAt,
        endedAt,
        durationMs: endedAt == null ? null : Math.max(0, endedAt - startedAt),
        error: status === 'failed' ? errorMessage(source.error) : null,
    };
}

function createTaskRunStore(options = {}) {
    const filePath = options.filePath || getDataFile('task_runs.json');
    const retentionDays = positiveInteger(options.retentionDays ?? process.env.TASK_RUN_RETENTION_DAYS, DEFAULT_RETENTION_DAYS);
    const maxRecords = positiveInteger(options.maxRecords ?? process.env.TASK_RUN_MAX_RECORDS, DEFAULT_MAX_RECORDS);
    const now = typeof options.now === 'function' ? options.now : Date.now;
    const idFactory = typeof options.idFactory === 'function' ? options.idFactory : crypto.randomUUID;

    function retain(runs) {
        const cutoff = now() - retentionDays * 24 * 60 * 60 * 1000;
        return [...runs]
            .filter(run => run.startedAt >= cutoff)
            .sort((a, b) => b.startedAt - a.startedAt || b.id.localeCompare(a.id))
            .slice(0, maxRecords);
    }

    function readRuns() {
        const data = readJsonFile(filePath, () => ({ schemaVersion: SCHEMA_VERSION, runs: [] }));
        if (!data || !Array.isArray(data.runs)) return [];
        return data.runs.map(normalizeRun).filter(run => run.id && run.accountId && run.taskName && run.startedAt > 0);
    }

    function persist(runs) {
        const retained = retain(runs);
        writeJsonFileAtomic(filePath, { schemaVersion: SCHEMA_VERSION, runs: retained });
        return retained;
    }

    function startRun(input = {}) {
        const accountId = String(input.accountId || '').trim();
        const taskName = String(input.taskName || '').trim();
        if (!accountId) throw new Error('accountId 不能为空');
        if (!taskName) throw new Error('taskName 不能为空');
        const run = normalizeRun({
            id: input.id || idFactory(), accountId, taskName,
            trigger: input.trigger || 'scheduler', status: 'running', startedAt: Number(input.startedAt) || now(),
        });
        persist([run, ...readRuns().filter(item => item.id !== run.id)]);
        return run;
    }

    function finishRun(runId, result = {}) {
        const id = String(runId || '').trim();
        const runs = readRuns();
        const index = runs.findIndex(run => run.id === id);
        if (index < 0) return null;
        const status = result.status === 'failed' ? 'failed' : 'success';
        const completed = normalizeRun({
            ...runs[index], status, endedAt: Number(result.endedAt) || now(), error: status === 'failed' ? result.error : null,
        });
        runs[index] = completed;
        persist(runs);
        return completed;
    }

    function recordTaskRunEvent(accountId, event, run = {}) {
        const trustedAccountId = String(accountId || '').trim();
        if (event === 'started') {
            return startRun({ id: run.id, accountId: trustedAccountId, taskName: run.taskName, trigger: run.trigger, startedAt: run.startedAt });
        }
        if (event === 'finished') {
            return finishRun(run.id, { status: run.status, endedAt: run.endedAt, error: run.error });
        }
        return null;
    }

    function listRuns(filters = {}) {
        const existing = readRuns();
        const runs = retain(existing);
        if (runs.length !== existing.length) persist(runs);
        const accountIds = Array.isArray(filters.accountIds) ? new Set(filters.accountIds.map(value => String(value))) : null;
        const status = String(filters.status || '').trim();
        const taskName = String(filters.taskName || '').trim();
        const limit = Math.min(500, positiveInteger(filters.limit, 100));
        return runs.filter((run) => {
            if (accountIds && !accountIds.has(run.accountId)) return false;
            if (status && run.status !== status) return false;
            if (taskName && run.taskName !== taskName) return false;
            return true;
        }).slice(0, limit);
    }

    return { startRun, finishRun, recordTaskRunEvent, listRuns };
}

const defaultStore = createTaskRunStore();

module.exports = {
    SCHEMA_VERSION,
    createTaskRunStore,
    startRun: defaultStore.startRun,
    finishRun: defaultStore.finishRun,
    recordTaskRunEvent: defaultStore.recordTaskRunEvent,
    listRuns: defaultStore.listRuns,
};
