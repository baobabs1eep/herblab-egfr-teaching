const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { importCandidates } = require('./import-candidates.cjs');

const script = path.join(__dirname, 'import-candidates.cjs');
function tempDir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'candidate-import-')); }
function write(dir, name, value) { const file = path.join(dir, name); fs.writeFileSync(file, value); return file; }
function run(dir, input, output, extra = []) {
  return spawnSync(process.execPath, [script, input, output, '--source', 'TCMSP', '--version', '2.3', '--source-url', 'https://old.tcmsp-e.com/attachment/tcmspDB/03_Info_Molecules.xlsx', '--retrieved-at', '2026-10-09T00:00:00Z', ...extra], { encoding: 'utf8' });
}

test('imports records and writes provenance with sha256', () => {
  const dir = tempDir();
  const input = write(dir, 'input.json', JSON.stringify({ records: [{ candidateId: 'c1', name: '槲皮素', smiles: null, sourceHerb: '黄芩', targets: ['EGFR'], literatureIds: ['PMID:1'] }] }));
  const output = path.join(dir, 'output.json');
  const result = importCandidates({ inputPath: input, outputPath: output, source: 'TCMSP', version: '2.3', sourceUrl: 'https://old.tcmsp-e.com/attachment/tcmspDB/03_Info_Molecules.xlsx', retrievedAt: '2026-10-09T00:00:00Z', now: '2026-10-09T01:00:00Z' });
  const saved = JSON.parse(fs.readFileSync(output, 'utf8'));
  assert.equal(saved.records[0].candidateId, 'c1');
  assert.equal(saved.provenance.validationStatus, 'needs_review');
  assert.equal(saved.provenance.importedAt, '2026-10-09T01:00:00Z');
  assert.match(saved.provenance.inputsha256, /^[a-f0-9]{64}$/);
  assert.deepEqual(saved.provenance, result.provenance);
});

test('rejects duplicate ids', () => {
  const dir = tempDir();
  const input = write(dir, 'input.json', JSON.stringify([{ candidateId: 'dup', name: 'A' }, { candidateId: 'dup', name: 'B' }]));
  assert.throws(() => importCandidates({ inputPath: input, outputPath: path.join(dir, 'out.json'), source: 'HERB', version: '2.0', sourceUrl: 'https://herb.ac.cn/v2', retrievedAt: '2026-10-09T00:00:00Z' }), /重复 candidateId/);
});

test('rejects HTML input clearly', () => {
  const dir = tempDir();
  const input = write(dir, 'input.json', '<html><body>error</body></html>');
  const result = run(dir, input, path.join(dir, 'out.json'));
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /HTML/);
});

test('rejects overwriting an existing output', () => {
  const dir = tempDir();
  const input = write(dir, 'input.json', JSON.stringify([{ candidateId: 'c1', name: 'A' }]));
  const output = write(dir, 'out.json', '{"keep":true}');
  const result = run(dir, input, output);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /拒绝覆盖/);
  assert.equal(fs.readFileSync(output, 'utf8'), '{"keep":true}');
});
