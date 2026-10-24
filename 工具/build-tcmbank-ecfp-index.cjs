'use strict';

const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');
const zlib = require('node:zlib');
const {describe} = require('../本地服务/morgan.cjs');
const {screenSeed} = require('../本地服务/candidate-policy.cjs');

async function main() {
  const source = process.argv[2];
  const output = process.argv[3] || path.resolve(__dirname, '../本地服务/data/tcmbank-ecfp4.json.gz');
  if (!source || !fs.existsSync(source)) throw new Error('Usage: node build-tcmbank-ecfp-index.cjs tcmbank-ingredients.ndjson [output]');
  const byStructure = new Map();
  let invalid = 0;
  let excluded = 0;
  let processed = 0;
  const input = readline.createInterface({input: fs.createReadStream(source, 'utf8'), crlfDelay: Infinity});
  for await (const line of input) {
    if (!line.trim()) continue;
    processed += 1;
    try {
      const sourceRecord = JSON.parse(line);
      if (!sourceRecord.id || !sourceRecord.name || !sourceRecord.smiles || !Array.isArray(sourceRecord.herbs) || !sourceRecord.herbs.length) {
        invalid += 1;
        continue;
      }
      const chemical = await describe(sourceRecord.smiles);
      const policy = screenSeed(sourceRecord, chemical);
      if (!policy.eligible) {
        excluded += 1;
        continue;
      }
      const structureKey = chemical.canonicalSmiles;
      const existing = byStructure.get(structureKey);
      const herbs = sourceRecord.herbs.map(value => String(value).trim()).filter(Boolean);
      if (existing) {
        existing.identifiers = [...new Set([...existing.identifiers, String(sourceRecord.id)])];
        existing.herbs = [...new Set([...existing.herbs, ...herbs])];
        if (sourceRecord.pubchemId) existing.pubchemIds = [...new Set([...existing.pubchemIds, String(sourceRecord.pubchemId)])];
      } else {
        byStructure.set(structureKey, {
          id: String(sourceRecord.id),
          identifiers: [String(sourceRecord.id)],
          name: String(sourceRecord.name),
          smiles: structureKey,
          inchiKey: '',
          pubchemId: String(sourceRecord.pubchemId || ''),
          pubchemIds: sourceRecord.pubchemId ? [String(sourceRecord.pubchemId)] : [],
          herbs: [...new Set(herbs)],
          fingerprint: Buffer.from(chemical.fingerprint).toString('base64'),
        });
      }
    } catch { invalid += 1; }
    if (processed % 2000 === 0) process.stderr.write(`processed ${processed}\n`);
  }
  const records = [...byStructure.values()];
  const payload = {
    schemaVersion: 1,
    source: 'TCMBank ingredient_all.xlsx (official static export; records with TCM herb relation)',
    sourceURL: 'http://tcmbank.cn/file/TCM_database/ingredient_all.xlsx',
    relationRule: 'At least one non-empty TCM_name, TCM_name_en or TCM_name2 field',
    fingerprint: {type: 'Morgan/ECFP4', radius: 2, bits: 2048, metric: 'Tanimoto'},
    generatedAt: new Date().toISOString(),
    processed,
    deduplicatedBy: 'RDKit canonical SMILES',
    invalid,
    excluded,
    records,
  };
  fs.mkdirSync(path.dirname(output), {recursive: true});
  fs.writeFileSync(output, zlib.gzipSync(JSON.stringify(payload), {level: 9}));
  process.stdout.write(JSON.stringify({output, records: records.length, processed, invalid, excluded, bytes: fs.statSync(output).size}) + '\n');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
