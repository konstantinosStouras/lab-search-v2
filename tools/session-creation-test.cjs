// Exercise the actual admin creation functions without a browser or live data.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '../admin/admin.js'), 'utf8');
function fn(name) {
  const start = source.indexOf('  function ' + name + '(');
  const end = source.indexOf('\n  function ', start + 1);
  return source.slice(start, end < 0 ? undefined : end);
}
const Specs = require('../specs.js');
const existing = { id: 'existing', code: 'SEPT', status: 'draft', ops: { entryOpen: false } };
const before = JSON.stringify(existing);
let saved = [existing], writes = 0, publicRun;
const ctx = vm.createContext({
  Specs, Pool: require('../pool.js'), Content: require('../content.js'),
  X: require('../admin/export.js'), clone: x => JSON.parse(JSON.stringify(x)),
  LOCAL: true, localRuns: () => saved,
  saveLocalRuns: list => { saved = list; writes++; },
  FB: {
    createRun: async obj => { writes++; assert.equal(obj.status, 'open'); return 'new-cloud-id'; },
    audit: () => {},
    putRunPublic: async (id, obj) => { publicRun = obj; }
  }
});
ctx.DEMO = { code: 'TEST', name: 'For testing purposes' };
vm.runInContext(['newRunDoc', 'createRun', 'artifacts', 'publicDoc', 'demoParams'].map(fn).join('\n'), ctx);
(async () => {
  const params = Specs.withDefaults();
  const paramsBefore = JSON.stringify(params);
  const obj = ctx.newRunDoc(params, 'New session', 'NEW', {});
  await ctx.createRun(obj);
  assert.equal(obj.status, 'open');
  assert.equal(obj.ops.entryOpen, true);
  assert.equal(obj.params.ops.entryOpen, true);
  assert.equal(JSON.stringify(params), paramsBefore);
  assert.equal(JSON.stringify(saved.find(r => r.code === 'SEPT')), before);
  const bad = ctx.newRunDoc(params, 'Invalid', 'BAD', {});
  const brokenSpecs = JSON.parse(bad.specsJson);
  brokenSpecs.pop();
  bad.specsJson = JSON.stringify(brokenSpecs);
  const previousWrites = writes;
  await assert.rejects(ctx.createRun(bad), /Validation failed/);
  assert.equal(writes, previousWrites);
  assert.equal(bad.status, 'draft');
  ctx.LOCAL = false;
  const cloud = ctx.newRunDoc(params, 'Cloud session', 'CLOUD', {});
  assert.equal(await ctx.createRun(cloud), 'new-cloud-id');
  assert.equal(publicRun.status, 'open');
  assert.equal(publicRun.ops.entryOpen, true);
  assert.equal(publicRun.params.ops.entryOpen, true);
  const cloudWrites = writes;
  await assert.rejects(ctx.createRun(bad), /Validation failed/);
  assert.equal(writes, cloudWrites);
  const demo = ctx.newRunDoc(ctx.demoParams(), 'Demo', 'TEST', {});
  await ctx.createRun(demo);
  assert.equal(demo.status, 'open');
  assert.equal(JSON.stringify(existing), before);
  console.log('PASS: new local/cloud sessions open after validation; invalid creation writes nothing; SEPT unchanged.');
})().catch(e => { console.error(e); process.exitCode = 1; });
