'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createTCMBankService } = require('./tcmbank.cjs');

function response(data, status = 200) {
  return { ok: status >= 200 && status < 300, status, headers: { get: () => null }, async json() { return data; } };
}

test('ingredient search returns identity and website-provided target options', async () => {
  const calls = [];
  const fetchImpl = async url => {
    calls.push(String(url));
    if (url.pathname.endsWith('/ingredient/search')) return response({ status: true, data: { total_ingredients: 1, list: [{ TCMBank_ID: 'TCMBANKIN000001', name: 'Quercetin', Molecular_Formula: 'C15H10O7' }] } });
    return response({ status: true, data: [{ TCMBank_ID: 'TCMBANKTA000001', Target_id: 'T1', Gene_name: 'EGFR', Description: 'target relationship' }] });
  };
  const service = createTCMBankService({ fetchImpl, minIntervalMs: 1, sleep: async () => {} });
  const result = await service.searchIngredient('Quercetin');
  assert.equal(result.records[0].identifier, 'TCMBANKIN000001');
  assert.equal(result.records[0].targets[0].gene, 'EGFR');
  assert.equal(calls.length, 2);
});

test('disease target suggestion marks fuzzy disease matching for review', async () => {
  const fetchImpl = async url => url.pathname.endsWith('/disease/search')
    ? response({ status: true, data: { list: [{ TCMBank_ID: 'TCMBANKDI000001', Disease_name: 'Trigeminal neuralgia type 1' }] } })
    : response({ status: true, data: [{ TCMBank_ID: 'TCMBANKTA000002', Gene_name: 'SCN9A' }] });
  const result = await createTCMBankService({ fetchImpl, minIntervalMs: 1, sleep: async () => {} }).diseaseTargets('Trigeminal neuralgia');
  assert.equal(result.records[0].gene, 'SCN9A');
  assert.match(result.warnings[0], /模糊匹配/);
});
