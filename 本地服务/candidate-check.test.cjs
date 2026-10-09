'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createCandidateChecker } = require('./candidate-check.cjs');

function services(overrides = {}) {
  const calls = [];
  const research = {
    compound: async name => { calls.push(['pubchem', name]); await new Promise(resolve => setTimeout(resolve, 10)); return { cid: 123, records: [{ cid: 123, name, abstract: 'too much detail' }] }; },
    naturalProduct: async name => { calls.push(['coconut', name]); return { records: [{ identifier: 'COC-1', name }] }; },
  };
  const sources = {
    molecule: async name => { calls.push(['chembl', name]); throw new Error('ChEMBL unavailable'); },
    target: async target => { calls.push(['target', target]); return { records: [{ accession: 'P00533', target }] }; },
  };
  return { research: { ...research, ...overrides.research }, sources: { ...sources, ...overrides.sources }, calls };
}

test('checks identity sources concurrently and keeps partial failures', async () => {
  const s = services();
  const result = await createCandidateChecker(s).check({
    candidate: { name: 'quercetin', source: 'research-cache' },
    records: Array.from({ length: 5 }, (_, i) => ({ pmid: String(i), abstract: 'large' })),
    target: 'EGFR', disease: '肺癌', query: 'q', retrievedAt: '2026-10-09T00:00:00.000Z',
  });
  assert.deepEqual(s.calls.map(x => x[0]).sort(), ['chembl', 'coconut', 'pubchem', 'target']);
  assert.equal(result.identity.pubchem.status, 'ok');
  assert.equal(result.identity.coconut.status, 'ok');
  assert.equal(result.identity.chembl.status, 'error');
  assert.equal(result.target.status, 'ok');
  assert.equal(result.provenance.records.length, 3);
  assert.equal(result.provenance.records[0].abstract, undefined);
  assert.equal(result.readiness.canRank, false);
  assert.equal(result.reviewRequired, true);
  assert.deepEqual(result.candidate, { name: 'quercetin', source: 'research-cache' });
});

test('missing records and invalid target do not query target', async () => {
  const s = services();
  const result = await createCandidateChecker(s).check({ candidate: { name: 'A' }, target: 'EGFR TP53', records: null });
  assert.equal(result.target.status, 'not_requested');
  assert.equal(result.provenance.records.length, 0);
  assert.equal(s.calls.some(x => x[0] === 'target'), false);
});

test('empty candidate name is rejected', async () => {
  await assert.rejects(() => createCandidateChecker(services()).check({ candidate: { name: '  ' } }), /candidate\.name is required/);
});
