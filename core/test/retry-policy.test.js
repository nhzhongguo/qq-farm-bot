const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createRetryPolicy, isRetryableError, computeDelay } = require('../src/services/retry-policy');

test('returns result on first success without retry', async () => {
    const policy = createRetryPolicy({ maxRetries: 3, baseDelayMs: 10 });
    let calls = 0;
    const result = await policy.execute(async () => {
        calls++;
        return 'ok';
    }, { label: 'test-success' });
    assert.equal(result, 'ok');
    assert.equal(calls, 1);
});

test('retries on retryable error and succeeds', async () => {
    const policy = createRetryPolicy({ maxRetries: 3, baseDelayMs: 10, jitterMs: 0 });
    let calls = 0;
    const result = await policy.execute(async () => {
        calls++;
        if (calls < 3) throw new Error('Connection timeout');
        return 'recovered';
    }, { label: 'test-retry' });
    assert.equal(result, 'recovered');
    assert.equal(calls, 3);
});

test('does not retry on non-retryable error', async () => {
    const policy = createRetryPolicy({ maxRetries: 3, baseDelayMs: 10 });
    let calls = 0;
    await assert.rejects(
        policy.execute(async () => {
            calls++;
            throw new Error('Invalid credentials');
        }, { label: 'test-no-retry' }),
        /Invalid credentials/,
    );
    assert.equal(calls, 1);
});

test('throws after max retries exhausted', async () => {
    const policy = createRetryPolicy({ maxRetries: 2, baseDelayMs: 10, jitterMs: 0 });
    let calls = 0;
    await assert.rejects(
        policy.execute(async () => {
            calls++;
            throw new Error('ETIMEDOUT');
        }, { label: 'test-max-retries' }),
        /ETIMEDOUT/,
    );
    assert.equal(calls, 3); // 1 initial + 2 retries
});

test('calls onRetry callback with attempt, error, and delay', async () => {
    const policy = createRetryPolicy({ maxRetries: 1, baseDelayMs: 10, jitterMs: 0 });
    const retries = [];
    await assert.rejects(
        policy.execute(async () => {
            throw new Error('ECONNRESET');
        }, {
            label: 'test-callback',
            onRetry: (attempt, error, delay) => retries.push({ attempt, error: error.message, delay }),
        }),
        /ECONNRESET/,
    );
    assert.equal(retries.length, 1);
    assert.equal(retries[0].attempt, 1);
    assert.equal(retries[0].error, 'ECONNRESET');
    assert.ok(retries[0].delay >= 10);
});

test('uses custom shouldRetry function', async () => {
    const policy = createRetryPolicy({ maxRetries: 3, baseDelayMs: 10 });
    let calls = 0;
    await assert.rejects(
        policy.execute(async () => {
            calls++;
            throw new Error('custom error');
        }, {
            label: 'test-custom-retry',
            shouldRetry: (error) => error.message === 'custom error',
        }),
        /custom error/,
    );
    // shouldRetry returns true, so all retries are used
    assert.equal(calls, 4);
});

test('isRetryableError identifies common retryable patterns', () => {
    assert.ok(isRetryableError(new Error('Connection timeout')));
    assert.ok(isRetryableError(new Error('ETIMEDOUT')));
    assert.ok(isRetryableError(new Error('socket hang up')));
    assert.ok(isRetryableError(new Error('request failed with status code 503')));
    assert.ok(!isRetryableError(new Error('Invalid credentials')));
    assert.ok(!isRetryableError(new Error('Not found')));
});

test('computeDelay uses exponential backoff with cap', () => {
    const config = { baseDelayMs: 1000, maxDelayMs: 10000, backoffMultiplier: 2, jitterMs: 0 };
    assert.equal(computeDelay(1, config), 1000);
    assert.equal(computeDelay(2, config), 2000);
    assert.equal(computeDelay(3, config), 4000);
    assert.equal(computeDelay(10, config), 10000); // capped
});

test('getConfig returns a copy of the config', () => {
    const policy = createRetryPolicy({ maxRetries: 5, baseDelayMs: 200 });
    const config = policy.getConfig();
    assert.equal(config.maxRetries, 5);
    assert.equal(config.baseDelayMs, 200);
    // Mutating the returned copy should not affect internal config
    config.maxRetries = 999;
    assert.equal(policy.getConfig().maxRetries, 5);
});
