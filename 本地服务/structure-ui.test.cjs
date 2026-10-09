'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
function boot(saved={},fetch=async()=>{throw new Error('unexpected fetch')}){const handlers={},memory=new Map([['herblab-structure-pool-v1',JSON.stringify(saved)]]);const c={localStorage:{getItem:k=>memory.get(k),setItem:(k,v)=>memory.set(k,v)},document:{addEventListener:(n,f)=>handlers[n]=f},URL,Blob,AbortSignal,fetch,setTimeout,window:null};c.window=c;c.render=()=>{};vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../演示前端/structure-ui.js'),'utf8'),c);return {c,handlers};}
test('database-only pool imports without papers, but cannot invent complete matching',()=>{
 const {c}=boot({accession:'P00533',result:{reference:{cid:1},candidates:[{name:'unreported',identity:{sourceURL:'https://pubchem.ncbi.nlm.nih.gov/compound/2'},structure:{status:'computed',score:60,method:'Tanimoto',referenceCID:1},binding:{status:'pending',total:null,records:[]}}]}});
 const pool=c.StructureUI.parsePool({provenance:{source:'HERB'},records:[{name:'unreported',smiles:'CC'}]});assert.equal(pool.length,1);assert.equal(pool[0].source,'HERB');
 const data=c.StructureUI.template();assert.equal(data.candidates[0].match.components.structure.value,60);assert.equal(data.candidates[0].match.components.affinity.value,null);assert.equal(data.candidates[0].match.components.channel.value,null);
 const result=require('../演示前端/ranking.js').compute(data);assert.equal(result.conventionalEligible,0);
 assert.match(c.StructureUI.panel(),/不要求已有疾病文献/);assert.doesNotMatch(c.StructureUI.panel(),/惊奇度/);
});
test('structure action submits only batch names reference and target, with no literature request',async()=>{
 const calls=[];const {handlers}=boot({names:'candidate',reference:'reference',accession:'P00533',pool:[{name:'extra'}]},async(url,options)=>{calls.push({url,body:JSON.parse(options.body)});return {ok:true,json:async()=>({reference:{cid:1},candidates:[]})}});
 await handlers.click({target:{closest:()=>({id:'structureRun'})}});assert.equal(calls.length,1);assert.equal(calls[0].url,'/api/structure-screen');assert.deepEqual(calls[0].body,{names:['candidate'],reference:'reference',accession:'P00533'});
});
