const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../svfirebase.js'), 'utf8');
const start = source.indexOf('  function deleteRunData(');
const end = source.indexOf('\n  // ---- audit', start);
async function check(count, failCommit = false) {
  let events = Array.from({ length: count }, (_, i) => ({ ref: 'target-' + i, run_id: 'TARGET' }));
  events.push({ ref: 'preserve', run_id: 'SEPT' });
  let reads = 0, commits = 0;
  const api = {
    collection: (db, name) => name,
    where: (field, op, value) => ({ field, op, value }),
    limit: value => value,
    query: (collection, condition, limit) => ({ collection, condition, limit }),
    getDocs: async q => {
      reads++;
      assert.equal(q.collection, 'events');
      assert.deepEqual(q.condition, { field: 'run_id', op: '==', value: 'TARGET' });
      assert.equal(q.limit, 400);
      const docs = events.filter(e => e.run_id === q.condition.value).slice(0, q.limit);
      return { empty: !docs.length, size: docs.length, forEach: fn => docs.forEach(fn) };
    },
    writeBatch: () => {
      const refs = [];
      return {
        delete: ref => refs.push(ref),
        commit: async () => {
          commits++;
          assert.ok(refs.length <= 400);
          if (failCommit) throw new Error('permission-denied');
          events = events.filter(e => !refs.includes(e.ref));
        }
      };
    }
  };
  const ctx = vm.createContext({ init: async () => {}, sdk: { fs: api }, db: {}, C: { events: 'events' } });
  vm.runInContext(source.slice(start, end), ctx);
  await assert.rejects(ctx.deleteRunData(''), /session ID/);
  assert.equal(reads, 0);
  if (failCommit) {
    await assert.rejects(ctx.deleteRunData('TARGET'), /permission-denied/);
    assert.equal(events.length, count + 1);
  } else {
    assert.equal(await ctx.deleteRunData('TARGET'), count);
    assert.deepEqual(events, [{ ref: 'preserve', run_id: 'SEPT' }]);
    assert.equal(commits, Math.ceil(count / 400));
    assert.equal(reads, Math.floor(count / 400) + 1);
  }
}
(async () => {
  for (const count of [0, 1, 400, 805]) await check(count);
  await check(1, true);
  console.log('PASS: empty sessions use one filtered read; paged batch deletion preserves other sessions and reports failures.');
})().catch(e => { console.error(e); process.exitCode = 1; });
