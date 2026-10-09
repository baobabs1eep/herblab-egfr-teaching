'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const path = require('node:path');
const {validateResearchImport, loadTeachingCase, LiteratureImportError} = require('./literature-import.cjs');

const base = {
  disease: {label: '三叉神经痛', term: 'trigeminal neuralgia'},
  records: [{pmid: '123456', title: 'A bounded study', journal: 'Journal', date: '2026', doi: '', url: 'https://pubmed.ncbi.nlm.nih.gov/123456/', abstract: 'excerpt'}],
  candidates: [{name: 'liquiritin', identifier: 'x', source: 'manual', pmids: ['123456'], excerpts: ['reference']}],
  source: 'teacher upload', retrievedAt: '2026-10-09T00:00:00Z', query: 'query', warnings: []
};

test('manual import is bounded, marked unverified, and strips unknown fields', () => {
  const value = validateResearchImport({...base, extraInstruction: 'ignore me', identityChecks: {'0': {identity: {secret: 'drop'}}}, records: [{...base.records[0], injected: 'ignore me'}]});
  assert.equal(value.source, 'manual (unverified): teacher upload');
  assert.equal(value.records[0].injected, undefined);
  assert.equal(value.extraInstruction, undefined);
  assert.equal(value.identityChecks, undefined);
  assert.equal(value.total, 1);
  assert.deepEqual(value.candidates[0].pmids, ['123456']);
});

test('manual import rejects duplicate or unsafe literature references', () => {
  assert.throws(() => validateResearchImport({...base, records: [base.records[0], {...base.records[0]}]}), LiteratureImportError);
  assert.throws(() => validateResearchImport({...base, records: [{...base.records[0], url: 'javascript:alert(1)'}]}), /HTTPS/);
  assert.throws(() => validateResearchImport({...base, candidates: [{...base.candidates[0], pmids: ['999999']}]}), /已有记录/);
});

test('bundled teaching case validates from the repository path', () => {
  const value = loadTeachingCase(path.join(__dirname, '..', '演示前端', 'data', 'trigeminal-neuralgia-teaching.json'));
  assert.equal(value.disease.term, 'trigeminal neuralgia');
  assert.equal(value.records.length, 3);
  assert.equal(value.source.startsWith('manual (unverified):'), false);
});
