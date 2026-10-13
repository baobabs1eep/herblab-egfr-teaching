'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require('node:path').join(__dirname,'server.cjs'),'utf8');
const context={};vm.runInNewContext(source.slice(source.indexOf('function mergeResearchPage('),source.indexOf('function json(')),context);
test('merged research preserves incomplete extraction instead of turning failure into zero hits',()=>{
 const base={provider:'Europe PMC',records:[{pmid:'1'}],candidates:[{name:'chemical',identifier:'CHEBI:1',pmids:['1']}],candidateExtraction:{status:'complete',provider:'Europe PMC'},total:30};
 const failed={provider:'Europe PMC',records:[{pmid:'2'}],candidates:[],candidateExtraction:{status:'unavailable',provider:'Europe PMC'},total:30};
 const merged=context.mergeResearchPage(base,failed);assert.equal(merged.candidates.length,1);assert.equal(merged.records.length,2);assert.equal(merged.candidateExtraction.status,'partial');assert.equal(merged.extractionPages.length,2);
 const again=context.mergeResearchPage(merged,{...failed,candidateExtraction:{status:'no_annotations'}});assert.equal(again.candidateExtraction.status,'partial');
});
