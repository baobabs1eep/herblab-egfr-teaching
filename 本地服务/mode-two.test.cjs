'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {createModeTwoService} = require('./mode-two.cjs');

test('mode two combines ECFP and shared-target routes without claiming affinity', async () => {
  const sources = {
    async ingredient(){return {records:[{identifier:'TCMBANKIN000001',name:'Quercetin',targets:[{tcmbankId:'TCMBANKGE000001',gene:'EGFR'}]}]};},
    async ingredientDetail(){return {records:[{name:'Quercetin',smiles:'O=c1cc(-c2ccc(O)c(O)c2)oc2cc(O)cc(O)c12'}]};},
    async geneIngredients(){return {records:[{identifier:'TCMBANKIN000099',name:'Target-linked compound',reference:'12345'}]};},
  };
  const index={
    load(){return {metadata:{source:'test',fingerprint:{type:'Morgan/ECFP4',bits:2048}}};},
    similar(){return [{id:'TCMBANKIN000003',identifiers:['TCMBANKIN000003'],name:'Structure analogue',smiles:'CC',inchiKey:'A',herbs:['Herb A'],similarity:0.83},{id:'TCMBANKIN000002',identifiers:['TCMBANKIN000002','TCMBANKIN000099'],name:'Target-linked compound',smiles:'CCC',inchiKey:'',herbs:['Herb B'],similarity:0.81}];},
    similarity(_fingerprint,identifier){return identifier==='TCMBANKIN000099'?{id:'TCMBANKIN000002',identifiers:['TCMBANKIN000002','TCMBANKIN000099'],name:'Target-linked compound',smiles:'CCC',inchiKey:'',herbs:['Herb B'],similarity:0.81}:null;},
  };
  const result=await createModeTwoService({sources,index}).buildGroup({name:'Quercetin'},{diseaseTargets:[{gene:'EGFR'}]});
  assert.equal(result.status,'ready');
  assert.equal(result.criteria.structure.threshold,0.4);
  assert.equal(result.criteria.target.confidenceOrAffinityClaimed,false);
  assert.equal(result.members.find(item=>item.name==='Structure analogue').targetRelevance,'结构上可能相关');
  assert.deepEqual(result.members.find(item=>item.name==='Structure analogue').herbs,['Herb A']);
  const linked=result.members.find(item=>item.name==='Target-linked compound');
  assert.equal(linked.targetRelevance,'有报道');
  assert.deepEqual(linked.routes.sort(),['structure','target']);
  assert.equal(linked.targets[0].diseaseRelated,true);
});

test('target reverse lookup cannot add a compound without a TCMBank herb relation', async () => {
  const sources = {
    async ingredient(){return {records:[{identifier:'TCMBANKIN000001',name:'Quercetin',targets:[{tcmbankId:'TCMBANKGE000001',gene:'EGFR'}]}]};},
    async ingredientDetail(){return {records:[{name:'Quercetin',smiles:'O=c1cc(-c2ccc(O)c(O)c2)oc2cc(O)cc(O)c12'}]};},
    async geneIngredients(){return {records:[{identifier:'TCMBANKIN999999',name:'Unlinked external compound'}]};},
  };
  const index={load(){return {metadata:{source:'strict TCMBank'}};},similar(){return [];},similarity(){return null;}};
  const result=await createModeTwoService({sources,index}).buildGroup({name:'Quercetin'});
  assert.equal(result.status,'empty');
  assert.equal(result.total,0);
});

test('mode two rejects obvious non-candidate before database calls', async () => {
  let called=false;
  const sources={async ingredient(){called=true;return {records:[]};},async geneIngredients(){return {records:[]};}};
  const result=await createModeTwoService({sources,index:{load(){return {metadata:{}};},similar(){return [];}}}).buildGroup({name:'water'});
  assert.equal(result.status,'excluded');
  assert.match(result.exclusion.reason,/水|溶剂/);
  assert.equal(called,false);
});
