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

test('backup keeps last good copy when main becomes corrupted before write', () => {
    const usersFile = path.join(dataDir, 'users.json');
    const backupFile = `${usersFile}.bak`;

    // Snapshot current good state into backup, then corrupt main and write again.
    const goodUsers = JSON.parse(fs.readFileSync(usersFile, 'utf8'));
    fs.writeFileSync(backupFile, JSON.stringify(goodUsers, null, 2), 'utf8');
    fs.writeFileSync(usersFile, '{broken-before-write', 'utf8');

    const second = userStore.registerUser('second_user', 'Abc123!', userStore.createCard('second', 1, 'time').code);
    assert.equal(second.ok, true);

    // After successful write, both main and backup should contain latest good state.
    const mainUsers = JSON.parse(fs.readFileSync(usersFile, 'utf8'));
    const backupUsers = JSON.parse(fs.readFileSync(backupFile, 'utf8'));
    assert.equal(mainUsers.users.some(user => user.username === 'second_user'), true);
    assert.equal(backupUsers.users.some(user => user.username === 'second_user'), true);

    // And a subsequent corruption can still recover from the latest backup.
    fs.writeFileSync(usersFile, '{broken-after-write', 'utf8');
    const recovered = userStore.getAllUsers();
    assert.equal(recovered.some(user => user.username === 'second_user'), true);
});

test('legacy cards without type can still be claimed', () => {
    const cardsFile = path.join(dataDir, 'cards.json');
    const cards = JSON.parse(fs.readFileSync(cardsFile, 'utf8'));
    const legacyCode = 'LEGACYCARD000001';
    cards.cards.push({
        code: legacyCode,
        description: 'legacy no type',
        days: 3,
        enabled: true,
        usedBy: null,
        usedAt: null,
        createdAt: Date.now(),
    });
    fs.writeFileSync(cardsFile, JSON.stringify(cards, null, 2), 'utf8');

    // Different identity to avoid 24h claim limit from earlier cases.
    const claim = userStore.claimCardByUA('10.0.0.8|legacy-browser');
    assert.equal(claim.ok, true);
    assert.equal(claim.cardCode, legacyCode);
});

test('corrupted accounts file restores from backup', () => {
    store.addOrUpdateAccount({ name: 'Restore farm', username: 'restore_user' });
    const accountsFile = path.join(dataDir, 'accounts.json');
    const backupFile = `${accountsFile}.bak`;
    assert.equal(fs.existsSync(backupFile), true);

    fs.writeFileSync(accountsFile, '{broken-accounts', 'utf8');
    const restored = store.getAccounts();
    assert.equal(restored.accounts.some(account => account.username === 'restore_user'), true);
    assert.doesNotThrow(() => JSON.parse(fs.readFileSync(accountsFile, 'utf8')));
});

test('default admin password verifies and forces change', () => {
    const result = userStore.validateUser('admin', 'admin', '127.0.0.1');
    assert.equal(result.error, undefined);
    assert.equal(result.username, 'admin');
    assert.equal(result.mustChangePassword, true);

    const bad = userStore.validateUser('admin', 'wrong-password', '127.0.0.1');
    assert.equal(bad.error, 'invalid_credentials');
});
