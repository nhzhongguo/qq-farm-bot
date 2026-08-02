const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-farm-card-log-test-'));
process.env.FARM_DATA_DIR = dataDir;

const userStore = require('../src/models/user-store');

test.after(() => {
    fs.rmSync(dataDir, { recursive: true, force: true });
});

test('registering with a card records a register card log', () => {
    const card = userStore.createCard('test card', 7, 'time');
    const result = userStore.registerUser('log_user_1', 'Abc123!', card.code);
    assert.equal(result.ok, true);

    const { logs } = userStore.getCardLogs();
    const log = logs.find(item => item.cardCode === card.code && item.action === 'register');
    assert.ok(log, 'register log should exist');
    assert.equal(log.username, 'log_user_1');
    assert.equal(log.cardType, 'time');
    assert.equal(log.days, 7);
    assert.ok(log.at > 0);
});

test('renewing with a card records a renew card log', () => {
    const card = userStore.createCard('renew card', 30, 'time');
    const result = userStore.renewUser('log_user_1', card.code);
    assert.equal(result.ok, true);

    const { logs } = userStore.getCardLogs();
    const log = logs.find(item => item.cardCode === card.code && item.action === 'renew');
    assert.ok(log, 'renew log should exist');
    assert.equal(log.username, 'log_user_1');
    assert.equal(log.days, 30);
});

test('claiming a card records a claim card log', () => {
    userStore.createCard('claim card', 3, 'time');
    userStore.setCardClaimStatus(true);

    const result = userStore.claimCardByUA('127.0.0.1|browser-cardlog', 'log_user_2');
    assert.equal(result.ok, true);

    const { logs } = userStore.getCardLogs();
    const log = logs.find(item => item.cardCode === result.cardCode && item.action === 'claim');
    assert.ok(log, 'claim log should exist');
    assert.equal(log.username, 'log_user_2');
    assert.equal(log.days, 3);
});

test('getCardLogs supports action filter and descending order', () => {
    const { total } = userStore.getCardLogs(200, 0, 'register');
    assert.ok(total >= 1);

    const all = userStore.getCardLogs(200);
    const timestamps = all.logs.map(item => item.at);
    for (let i = 1; i < timestamps.length; i++) {
        assert.ok(timestamps[i - 1] >= timestamps[i], 'logs should be sorted newest first');
    }
});

test('clearCardLogs empties the log file', () => {
    const before = userStore.getCardLogs();
    assert.ok(before.total > 0);

    const { cleared } = userStore.clearCardLogs();
    assert.equal(cleared, before.total);

    const after = userStore.getCardLogs();
    assert.equal(after.total, 0);
    assert.equal(after.logs.length, 0);
});
