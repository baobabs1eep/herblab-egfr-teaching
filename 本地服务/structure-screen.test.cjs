'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createStructureScreen, fingerprintTanimoto } = require('./structure-screen.cjs');

function fp(bits = []) {
  const bytes = Buffer.alloc(115);
  bytes.writeUInt32BE(881, 0);
  for (const bit of bits) bytes[4 + Math.floor(bit / 8)] |= 1 << (7 - (bit % 8));
  return bytes.toString('base64');
}
function response(value, ok = true, status = 200) { return { ok, status, async json() { return value; } }; }
function pubchem(cid, key, fingerprint) { return { PropertyTable: { Properties: [{ CID: cid, InChIKey: key, ConnectivitySMILES: `C${cid}`, MolecularFormula: 'C', Fingerprint2D: fingerprint }] } }; }

test('computes low and high fingerprint Tanimoto scores with fixed PubChem URLs', async () => {
  const ref = fp([0, 8]);
  const high = fp([0, 8, 16]);
  const low = fp([80]);
  const urls = [];
  const fetchImpl = async url => {
    urls.push(url);
    if (url.includes('/name/ref%20compound/')) return response(pubchem(1, 'REF', ref));
    if (url.includes('/name/high/')) return response(pubchem(2, 'HIGH', high));
    return response(pubchem(3, 'LOW', low));
  };
  const result = await createStructureScreen({ fetchImpl }).screen({ names: ['high', 'low'], reference: 'ref compound' });
  assert.equal(result.candidates[0].structure.tanimoto, 2 / 3);
  assert.equal(result.candidates[1].structure.tanimoto, 0);
  assert.ok(urls.every(url => url.startsWith('https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/')));
  assert.ok(urls.every(url => url.endsWith('/property/Fingerprint2D,ConnectivitySMILES,InChIKey,MolecularFormula/JSON')));
  assert.equal(fingerprintTanimoto(ref, ref), 1);
});

test('keeps a candidate pending when PubChem identity is missing', async () => {
  const fingerprint = fp([1]);
  const fetchImpl = async url => {
    if (url.includes('/name/reference/')) return response(pubchem(10, 'REF', fingerprint));
    if (url.includes('/name/missing/')) return response({}, false, 404);
    return response(pubchem(11, 'OK', fingerprint));
  };
  const result = await createStructureScreen({ fetchImpl }).screen({ names: ['missing', 'ok'], reference: 'reference' });
  assert.equal(result.candidates.length, 2);
  assert.equal(result.candidates[0].structure.status, 'pending');
  assert.equal(result.candidates[1].structure.status, 'computed');
  assert.equal(result.candidates[1].tcmbank.status, 'unavailable');
});

test('does not infer efficacy from TCMBank target relationships', async () => {
  const fingerprint = fp([1]);
  const fetchImpl = async url => {
    if (url.includes('/name/reference/')) return response(pubchem(10, 'REF', fingerprint));
    if (url.includes('/name/candidate/')) return response(pubchem(11, 'KEY', fingerprint));
    return response(pubchem(11, 'KEY', fingerprint));
  };
  const tcmbank={ingredient:async()=>({records:[{identifier:'TCMBANKIN000001',name:'candidate',targets:[{gene:'SCN9A',description:'relationship'}]}],total:1})};
  const result = await createStructureScreen({ fetchImpl,tcmbank }).screen({ names: ['candidate'], reference: 'reference', accession: 'SCN9A' });
  assert.equal(result.candidates[0].tcmbank.status, 'recorded');
  assert.equal(result.candidates[0].tcmbank.targets[0].gene, 'SCN9A');
  assert.equal(result.target.requested, 'SCN9A');
  assert.equal(result.candidates[0].efficacy, undefined);
});

test('rejects malformed fingerprints', async () => {
  const fetchImpl = async () => response(pubchem(1, 'REF', Buffer.alloc(10).toString('base64')));
  await assert.rejects(() => createStructureScreen({ fetchImpl }).screen({ names: ['candidate'], reference: 'reference' }), /malformed/);
});

test('TCMBank failure cannot remove candidates or stop structure ranking',async()=>{
 const fingerprint=fp([1]);const service=createStructureScreen({fetchImpl:async()=>response(pubchem(1,'KEY',fingerprint)),tcmbank:{ingredient:async()=>{throw new Error('TCMBank unavailable')}}});
 const result=await service.screen({names:['candidate'],reference:'reference',accession:'SCN9A'});
 assert.equal(result.candidates[0].structure.score,100);assert.equal(result.candidates[0].tcmbank.status,'pending');assert.equal(result.candidates[0].tcmbank.total,null);
});

test('empty TCMBank relationship response is no_record, not verified target absence',async()=>{
 const fingerprint=fp([1]);const service=createStructureScreen({fetchImpl:async()=>response(pubchem(1,'KEY',fingerprint)),tcmbank:{ingredient:async()=>({records:[],total:0})}});
 const result=await service.screen({names:['candidate'],reference:'reference',accession:'SCN9A'});assert.equal(result.candidates[0].tcmbank.status,'no_record');assert.equal(result.candidates[0].tcmbank.targets.length,0);
});

test('query budget retains unprocessed candidates as pending instead of timing out whole batch',async()=>{
 let clock=0;const fingerprint=fp([1]);const service=createStructureScreen({now:()=>clock,batchBudgetMs:1000,fetchImpl:async()=>{clock+=1100;return response(pubchem(1,'KEY',fingerprint))}});
 const result=await service.screen({names:['candidate'],reference:'reference'});assert.equal(result.candidates.length,1);assert.equal(result.candidates[0].structure.status,'pending');assert.equal(result.candidates[0].tcmbank.total,null);
});
