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

test('keeps a candidate pending when identity or binding data is missing', async () => {
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
  assert.equal(result.candidates[1].binding.status, 'unavailable');
});

test('does not infer efficacy from target mapping and preserves raw activity fields', async () => {
  const fingerprint = fp([1]);
  const fetchImpl = async url => {
    if (url.includes('/name/reference/')) return response(pubchem(10, 'REF', fingerprint));
    if (url.includes('/name/candidate/')) return response(pubchem(11, 'KEY', fingerprint));
    if (url.includes('/target.json')) return response({ targets: [{ target_chembl_id: 'CHEMBLT1', target_type: 'SINGLE PROTEIN', organism: 'Homo sapiens', target_components: [{ accession: 'P12345' }] }] });
    if (url.includes('/molecule.json')) return response({ molecules: [{ molecule_chembl_id: 'CHEMBL1', molecule_structures: { standard_inchi_key: 'KEY' } }] });
    return response({ activities: [{ standard_type: 'Ki', standard_relation: '=', standard_value: '4', standard_units: 'nM', assay_type: 'B', assay_chembl_id: 'CHEMBLA', document_chembl_id: 'CHEMBLD', potential_duplicate: true }], page_meta: { total_count: 1 } });
  };
  const result = await createStructureScreen({ fetchImpl }).screen({ names: ['candidate'], reference: 'reference', accession: 'P12345' });
  assert.equal(result.candidates[0].binding.status, 'recorded');
  assert.equal(result.candidates[0].binding.records[0].type, 'Ki');
  assert.equal(result.candidates[0].binding.records[0].flags.potentialDuplicate, true);
  assert.equal(result.candidates[0].efficacy, undefined);
});

test('rejects malformed fingerprints', async () => {
  const fetchImpl = async () => response(pubchem(1, 'REF', Buffer.alloc(10).toString('base64')));
  await assert.rejects(() => createStructureScreen({ fetchImpl }).screen({ names: ['candidate'], reference: 'reference' }), /malformed/);
});

test('target source failure cannot remove candidates or stop structure ranking',async()=>{
 const fingerprint=fp([1]);const service=createStructureScreen({fetchImpl:async url=>url.includes('/target.json')?response({},false,503):response(pubchem(1,'KEY',fingerprint))});
 const result=await service.screen({names:['candidate'],reference:'reference',accession:'P12345'});
 assert.equal(result.candidates[0].structure.score,100);assert.equal(result.candidates[0].binding.status,'pending');assert.equal(result.candidates[0].binding.total,null);
});

test('malformed activity response is pending, never a verified zero-hit result',async()=>{
 const fingerprint=fp([1]);const service=createStructureScreen({fetchImpl:async url=>{
  if(url.includes('/target.json'))return response({targets:[{target_chembl_id:'CHEMBL1',target_type:'SINGLE PROTEIN',organism:'Homo sapiens',target_components:[{accession:'P12345'}]}]});
  if(url.includes('/molecule.json'))return response({molecules:[{molecule_chembl_id:'CHEMBL2',molecule_structures:{standard_inchi_key:'KEY'}}]});
  if(url.includes('/activity.json'))return response({unexpected:true});return response(pubchem(1,'KEY',fingerprint));
 }});
 const result=await service.screen({names:['candidate'],reference:'reference',accession:'P12345'});assert.equal(result.candidates[0].binding.status,'pending');assert.equal(result.candidates[0].binding.total,null);
});

test('query budget retains unprocessed candidates as pending instead of timing out whole batch',async()=>{
 let clock=0;const fingerprint=fp([1]);const service=createStructureScreen({now:()=>clock,batchBudgetMs:1000,fetchImpl:async()=>{clock+=1100;return response(pubchem(1,'KEY',fingerprint))}});
 const result=await service.screen({names:['candidate'],reference:'reference'});assert.equal(result.candidates.length,1);assert.equal(result.candidates[0].structure.status,'pending');assert.equal(result.candidates[0].binding.total,null);
});
