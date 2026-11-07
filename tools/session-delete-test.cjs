// No live database access: exercise the admin handler with explicit failure cases.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../admin/admin.js'), 'utf8');
const start = source.indexOf('  function runAction(');
const end = source.indexOf('\n  function exportRun(', start + 1);
function setup({ local = false, locked = false, failAt = '', confirmed = true } = {}) {
  const calls = [], alerts = [];
  const sept = { id: 'sept', code: 'SEPT', locked: true };
  const target = { id: 'sdf', code: 'SDF', name: 'test', locked };
  let rows = [sept, target];
  const ctx = vm.createContext({
    LOCAL: local, current: sept, editingId: 'sept', runs: rows,
    esc: value => String(value),
    askSummary: (title, message, body, label, onOk) => {
      if (label === 'Delete session') return confirmed ? onOk() : undefined;
      alerts.push(message);
    },
    $: () => ({ innerHTML: 'created' }),
    localRuns: () => rows, saveLocalRuns: value => { rows = value; },
    renderRuns: () => { calls.push('render'); },
    FB: Object.fromEntries(['deleteRunData', 'deleteRun', 'audit'].map(name => [name, async id => {
      calls.push(name);
      assert.equal(id, 'sdf');
      if (failAt === name) throw new Error('permission-denied');
    }]))
  });
  vm.runInContext(source.slice(start, end), ctx);
  const button = { disabled: false, textContent: 'Delete' };
  return { ctx, calls, alerts, target, button, rows: () => rows, sept };
}
(async () => {
  for (const options of [{ locked: true }, { confirmed: false }]) {
    const t = setup(options);
    await t.ctx.runAction('delete', t.target, t.button);
    assert.deepEqual(t.calls, []);
  }
  for (const failAt of ['deleteRunData', 'deleteRun']) {
    const t = setup({ failAt });
    const pending = t.ctx.runAction('delete', t.target, t.button);
    assert.equal(t.button.disabled, true);
    await pending;
    assert.match(t.alerts[0], /permission-denied/);
    assert.equal(t.button.disabled, false);
    assert.equal(t.button.textContent, 'Delete');
    assert.ok(!t.calls.includes('audit'));
    if (failAt === 'deleteRunData') assert.ok(!t.calls.includes('deleteRun'));
  }
  const cloud = setup();
  await cloud.ctx.runAction('delete', cloud.target, cloud.button);
  assert.deepEqual(cloud.calls, ['deleteRunData', 'deleteRun', 'render', 'audit']);
  assert.equal(cloud.ctx.runs.length, 1);
  assert.equal(cloud.ctx.runs[0], cloud.sept);
  assert.deepEqual(cloud.alerts, []);
  assert.equal(cloud.ctx.current, cloud.sept);
  const local = setup({ local: true });
  await local.ctx.runAction('delete', local.target, local.button);
  assert.deepEqual(local.rows(), [local.sept]);
  assert.equal(local.ctx.editingId, 'sept');
  console.log('PASS: cancellation, locked sessions, visible failures, progress, and deletion scoped to SDF.');
})().catch(e => { console.error(e); process.exitCode = 1; });
