const test = require('node:test');
const assert = require('node:assert/strict');
const ranking = require('../演示前端/ranking.js');

const NODE = 'synthetic-fixture';

function candidate(id, overrides = {}) {
  return {
    id,
    name: id,
    identity: { status: 'verified', source: NODE },
    docking: { score: -8, source: NODE, protocol: 'dock-v1', target: 'EGFR-L858R' },
    filter: { status: 'pass', source: NODE, policy: 'filter-v1' },
    heat: { count: 10, query: 'synthetic query', source: NODE, date: '2026-09-26' },
    ...overrides,
  };
}

function data(candidates = [candidate('A')], metadata = {}) {
  return {
    metadata: {
      version: 'synthetic-v1',
      target: 'EGFR-L858R',
      protocol: 'dock-v1',
      filterPolicy: 'filter-v1',
      heatDefinition: 'synthetic count',
      heatDate: '2026-09-26',
      ...metadata,
    },
    candidates,
  };
}

test('exports compute, validate, and settings', () => {
  assert.equal(typeof ranking.compute, 'function');
  assert.equal(typeof ranking.validate, 'function');
  assert.equal(typeof ranking.settings, 'function');
});

test('incomplete real-shaped data is retained as excluded, with synthetic fixture only', () => {
  const result = ranking.compute(data([
    candidate('real-shaped-missing', {
      identity: { status: 'pending', source: NODE },
      docking: { score: null, source: '', protocol: '', target: '' },
      filter: { status: 'unknown', source: '', policy: '' },
      heat: { count: null, query: '', source: '', date: '' },
    }),
  ]));
  assert.equal(result.total, 1);
  assert.equal(result.eligible, 0);
  assert.equal(result.rows[0].status, '待补数据');
  assert.deepEqual(result.conventional, []);
  assert.deepEqual(result.cold, []);
});

test('cold ranking can reverse conventional ranking', () => {
  const result = ranking.compute(data([
    candidate('high-base', { docking: { score: -8.8, source: NODE, protocol: 'dock-v1', target: 'EGFR-L858R' }, heat: { count: 1000, query: 'q', source: NODE, date: '2026-09-26' } }),
    candidate('low-base-cold', { docking: { score: -8.4, source: NODE, protocol: 'dock-v1', target: 'EGFR-L858R' }, heat: { count: 0, query: 'q', source: NODE, date: '2026-09-26' } }),
  ], {}), { minBase: 0 });
  assert.deepEqual(result.conventional.map(r => r.id), ['high-base', 'low-base-cold']);
  assert.deepEqual(result.cold.map(r => r.id), ['low-base-cold', 'high-base']);
});

test('missing count is not treated as zero, while explicit zero receives novelty bonus', () => {
  const missing = ranking.compute(data([candidate('missing-count', { heat: { count: null, query: 'q', source: NODE, date: '2026-09-26' } })]));
  assert.equal(missing.rows[0].heat, null);
  assert.equal(missing.rows[0].novelty, null);
  assert.equal(missing.eligible, 0);

  const zero = ranking.compute(data([candidate('zero-count', { heat: { count: 0, query: 'q', source: NODE, date: '2026-09-26' } })]));
  assert.equal(zero.rows[0].novelty, 1);
  assert.equal(zero.rows[0].boost, 10);
  assert.equal(zero.rows[0].cold, zero.rows[0].base + 10);
});

test('filter fail and unknown, plus pending identity, stay out of the queue', () => {
  const result = ranking.compute(data([
    candidate('filter-fail', { filter: { status: 'fail', source: NODE, policy: 'filter-v1' } }),
    candidate('filter-unknown', { filter: { status: 'unknown', source: NODE, policy: 'filter-v1' } }),
    candidate('identity-pending', { identity: { status: 'pending', source: NODE } }),
  ]));
  assert.equal(result.eligible, 0);
  assert.equal(result.rows.find(r => r.id === 'filter-fail').status, '过滤未通过');
  assert.equal(result.rows.find(r => r.id === 'filter-unknown').status, '待补数据');
  assert.equal(result.rows.find(r => r.id === 'identity-pending').status, '待补数据');
});

test('protocol, target, date, and filter policy mismatches exclude candidates', () => {
  const fields = [
    ['protocol', { docking: { score: -8, source: NODE, protocol: 'other', target: 'EGFR-L858R' } }],
    ['target', { docking: { score: -8, source: NODE, protocol: 'dock-v1', target: 'EGFR-T790M' } }],
    ['date', { heat: { count: 2, query: 'q', source: NODE, date: '2026-09-25' } }],
    ['policy', { filter: { status: 'pass', source: NODE, policy: 'other' } }],
  ];
  for (const [label, overrides] of fields) {
    const result = ranking.compute(data([candidate(label, overrides)]));
    assert.equal(result.eligible, 0, label);
    assert.equal(result.rows[0].status, '待补数据', label);
  }
});

test('invalid numeric values and duplicate ids are rejected', () => {
  assert.throws(() => ranking.validate(data([candidate('bad-score', { docking: { score: 'bad', source: NODE, protocol: 'dock-v1', target: 'EGFR-L858R' } })])), /docking\.score/);
  assert.throws(() => ranking.validate(data([candidate('bad-count', { heat: { count: 1.5, query: 'q', source: NODE, date: '2026-09-26' } })])), /heat\.count/);
  assert.throws(() => ranking.validate(data([candidate('same'), candidate('same')])), /唯一 id/);
});

test('threshold excludes below-minimum rows and ties share a competition rank', () => {
  const result = ranking.compute(data([
    candidate('tie-b', { docking: { score: -8, source: NODE, protocol: 'dock-v1', target: 'EGFR-L858R' }, heat: { count: 10, query: 'q', source: NODE, date: '2026-09-26' } }),
    candidate('tie-a', { docking: { score: -8, source: NODE, protocol: 'dock-v1', target: 'EGFR-L858R' }, heat: { count: 10, query: 'q', source: NODE, date: '2026-09-26' } }),
    candidate('below', { docking: { score: -6, source: NODE, protocol: 'dock-v1', target: 'EGFR-L858R' } }),
  ]));
  assert.deepEqual(result.conventional.map(r => r.id), ['tie-a', 'tie-b']);
  assert.deepEqual(result.conventional.map(r => r.rank), [1, 1]);
  assert.equal(result.rows.find(r => r.id === 'below').status, '低于基础门槛');
});

test('bonus zero makes conventional and cold order and ranks identical', () => {
  const result = ranking.compute(data([
    candidate('A', { docking: { score: -9, source: NODE, protocol: 'dock-v1', target: 'EGFR-L858R' }, heat: { count: 0, query: 'q', source: NODE, date: '2026-09-26' } }),
    candidate('B', { docking: { score: -7, source: NODE, protocol: 'dock-v1', target: 'EGFR-L858R' }, heat: { count: 1000, query: 'q', source: NODE, date: '2026-09-26' } }),
  ], {}), { bonus: 0 });
  assert.deepEqual(result.conventional.map(r => r.id), result.cold.map(r => r.id));
  assert.deepEqual(result.conventional.map(r => r.rank), result.cold.map(r => r.rank));
});
