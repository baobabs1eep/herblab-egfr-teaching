'use strict';

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const {tanimoto} = require('./morgan.cjs');

const DEFAULT_PATH = path.join(__dirname, 'data', 'tcmbank-ecfp4.json.gz');

function normalized(value) { return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, ''); }

function createTCMBankStructureIndex({file = DEFAULT_PATH} = {}) {
  let loaded;
  function publicRecord(record, similarity = null) {
    return {id: record.id, identifiers: record.identifiers || [record.id], name: record.name, smiles: record.smiles, inchiKey: record.inchiKey, pubchemId: record.pubchemId, herbs: record.herbs, similarity};
  }
  function load() {
    if (loaded) return loaded;
    const raw = JSON.parse(zlib.gunzipSync(fs.readFileSync(file)).toString('utf8'));
    if (raw?.fingerprint?.type !== 'Morgan/ECFP4' || raw?.fingerprint?.bits !== 2048 || !Array.isArray(raw.records)) throw new Error('TCMBank ECFP index is invalid');
    const records = raw.records.map(record => ({...record, fingerprintBytes: new Uint8Array(Buffer.from(record.fingerprint, 'base64'))}));
    const byId = new Map();
    for (const record of records) for (const id of record.identifiers || [record.id]) byId.set(String(id).toUpperCase(), record);
    loaded = {
      metadata: {source: raw.source, sourceURL: raw.sourceURL, relationRule: raw.relationRule, generatedAt: raw.generatedAt, fingerprint: raw.fingerprint, total: records.length},
      records,
      byId,
      byName: new Map(records.map(record => [normalized(record.name), record])),
    };
    return loaded;
  }
  function find(identifier, name) {
    const data = load();
    const record = data.byId.get(String(identifier || '').toUpperCase()) || data.byName.get(normalized(name));
    return record || null;
  }
  function similar(fingerprint, threshold = 0.8) {
    const {records} = load();
    const matches = [];
    for (const record of records) {
      const score = tanimoto(fingerprint, record.fingerprintBytes);
      if (score >= threshold) matches.push(publicRecord(record, score));
    }
    return matches.sort((a, b) => b.similarity - a.similarity || a.name.localeCompare(b.name));
  }
  function similarity(fingerprint, identifier, name) {
    const record = find(identifier, name);
    return record ? publicRecord(record, tanimoto(fingerprint, record.fingerprintBytes)) : null;
  }
  return {load, find, similar, similarity};
}

module.exports = {createTCMBankStructureIndex, DEFAULT_PATH};
