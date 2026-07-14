const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-farm-data-test-'));
process.env.FARM_DATA_DIR = dataDir;

const store = require('../src/models/store');
const userStore = require('../src/models/user-store');

test.after(() => {
    fs.rmSync(dataDir, { recursive: true, force: true });
});

test('claimed cards are reserved until registration', () => {
    const card = userStore.createCard('test card', 1, 'time');
    userStore.setCardClaimStatus(true);

    const firstClaim = userStore.claimCardByUA('127.0.0.1|browser-a');
    assert.equal(firstClaim.ok, true);
    assert.equal(firstClaim.cardCode, card.code);

    const secondClaim = userStore.claimCardByUA('127.0.0.2|browser-b');
    assert.equal(secondClaim.ok, false);
    assert.match(secondClaim.error, /库存不足/);

    const registration = userStore.registerUser('test_user', 'Abc123!', card.code);
    assert.equal(registration.ok, true);

    const savedCard = userStore.getAllCards().find(item => item.code === card.code);
    assert.equal(savedCard.usedBy, 'test_user');
    assert.equal(savedCard.claimedAt, undefined);
});

test('valid backup restores a corrupted user file', () => {
    const usersFile = path.join(dataDir, 'users.json');
    const backupFile = `${usersFile}.bak`;
    assert.equal(fs.existsSync(backupFile), true);

    fs.writeFileSync(usersFile, '{broken', 'utf8');
    const users = userStore.getAllUsers();

    assert.equal(users.some(user => user.username === 'test_user'), true);
    assert.doesNotThrow(() => JSON.parse(fs.readFileSync(usersFile, 'utf8')));
});

test('renaming and deleting users updates account ownership', () => {
    store.addOrUpdateAccount({ name: 'Alice farm', username: 'alice' });
    store.addOrUpdateAccount({ name: 'Bob farm', username: 'bob' });

    const renamed = store.renameUserOwnership('alice', 'alice_new');
    assert.equal(renamed.updatedAccounts, 1);
    assert.equal(store.getAccountsByUser('alice_new').accounts.length, 1);
    assert.equal(store.getAccountsByUser('alice').accounts.length, 0);

    const deleted = store.deleteAccountsByUser('alice_new');
    assert.equal(deleted.deletedCount, 1);
    assert.equal(store.getAccountsByUser('bob').accounts.length, 1);
});
