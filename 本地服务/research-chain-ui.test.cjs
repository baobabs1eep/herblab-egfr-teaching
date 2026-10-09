'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

function boot(fetchImpl){
  const listeners={}; const store=new Map();
  const document={addEventListener:(n,f)=>{listeners[n]=f},querySelector:(sel)=>({value:sel.includes('Disease')?'三叉神经痛':''})};
  const context={window:{},document,localStorage:{getItem:k=>store.get(k)||null,setItem:(k,v)=>store.set(k,v)},location:{hash:''},fetch:fetchImpl,URL,AbortController,setTimeout,clearTimeout,setInterval,clearInterval,console};
  context.window=context; context.window.render=()=>{}; context.window.SourceUI={panel:()=>''}; context.window.HerbWorkspace={selectResearchCandidate:(c,x)=>{context.adopted={c,x}}};
  vm.runInNewContext(fs.readFileSync(require('node:path').join(__dirname,'..','演示前端','research-ui.js'),'utf8'),context);
  return {context,listeners};
}
const response=(data,status=200)=>({ok:status<400,status,json:async()=>data});

test('research chain defaults to trigeminal neuralgia and keeps adopt gated',async()=>{
  const f=async(url)=>String(url).includes('/api/research')?response({researchId:'r1',disease:{label:'三叉神经痛'},records:[],candidates:[{name:'A',identifier:'machine-id',pmids:[]}] }):response({});
  const {context}=boot(f); assert.match(context.ResearchUI.taskPanel(),/三叉神经痛/); assert.match(context.ResearchUI.taskPanel(),/EGFR/);
  context.ResearchUI.evidencePanel(); assert.equal(context.adopted,undefined);
});

test('candidate checks are user initiated, can adopt with canRank false, and stale results are isolated',async()=>{
  let resolveCheck; const f=async(url)=>{if(String(url).includes('/api/research'))return response({researchId:'r1',disease:{label:'三叉神经痛'},records:[],candidates:[{name:'A',identifier:'machine-id',pmids:[]}]}); if(String(url).includes('/api/candidate-check'))return new Promise(resolve=>{resolveCheck=()=>resolve(response({checkedAt:'t',identity:{pubchem:{status:'ok',data:{moleculeId:'CHEMBL1',cid:1,name:'A',smiles:'CC',url:'https://example.test/a'}},coconut:{status:'error',error:{message:'upstream'}}},target:{status:'ok'},readiness:{status:'pending_data',canRank:false,missing:[]}}))}); return response({});};
  const {context,listeners}=boot(f); listeners.click({target:{closest:s=>s==='#researchSearch'?{}:null}}); await new Promise(r=>setImmediate(r));
  listeners.click({target:{closest:s=>s==='[data-check-candidate]'?{dataset:{checkCandidate:'0'}}:null}}); resolveCheck(); await new Promise(r=>setImmediate(r));
  listeners.change({target:{dataset:{identitySelect:'0'},value:JSON.stringify({source:'pubchem',identifier:'CHEMBL1',name:'A',smiles:'CC',url:'https://example.test/a'}),closest:s=>s==='[data-identity-select]'?{dataset:{identitySelect:'0'},value:JSON.stringify({source:'pubchem',identifier:'CHEMBL1',name:'A',smiles:'CC',url:'https://example.test/a'})}:null}});
  listeners.input({target:{dataset:{candidateReview:'0',reviewField:'identityConfirmed'},checked:true,value:''}}); listeners.input({target:{dataset:{candidateReview:'0',reviewField:'relevanceConfirmed'},checked:true,value:''}}); listeners.input({target:{dataset:{candidateReview:'0',reviewField:'note'},value:'role and solvent'}});
  let html=context.ResearchUI.candidatePanel(); assert.match(html,/candidate-readiness.*pending_data/); assert.match(html,/CHEMBL1/); assert.match(html,/upstream/);
  listeners.click({target:{closest:s=>s==='[data-adopt-research]'?{dataset:{adoptResearch:'0'}}:null}}); assert.equal(context.adopted.c.selectedIdentity.identifier,'CHEMBL1');
  listeners.change({target:{dataset:{identitySelect:'0'},value:JSON.stringify({source:'pubchem',identifier:'2',name:'A2',smiles:'NN',url:'https://example.test/a2'}),closest:s=>s==='[data-identity-select]'?{dataset:{identitySelect:'0'},value:JSON.stringify({source:'pubchem',identifier:'2',name:'A2',smiles:'NN',url:'https://example.test/a2'})}:null}});
  html=context.ResearchUI.candidatePanel(); assert.match(html,/data-adopt-research="0" class="primary" disabled/);
});

test('late candidate response cannot write into a re-searched study',async()=>{
  let run=0,resolveOld; const f=async(url)=>{if(String(url).includes('/api/research')){run++;return response({researchId:`r${run}`,disease:{label:run===1?'旧题':'新题'},records:[],candidates:[{name:run===1?'old':'new',identifier:'id',pmids:[]}]})} if(String(url).includes('/api/candidate-check'))return new Promise(resolve=>{resolveOld=()=>resolve(response({checkedAt:'late',identity:{pubchem:{status:'ok',data:{moleculeId:'LATE'}}},readiness:{canRank:false}}))}); return response({});};
  const {context,listeners}=boot(f); const search={target:{closest:s=>s==='#researchSearch'?{}:null}};
  listeners.click(search); await new Promise(r=>setImmediate(r)); listeners.click({target:{closest:s=>s==='[data-check-candidate]'?{dataset:{checkCandidate:'0'}}:null}});
  listeners.click(search); await new Promise(r=>setImmediate(r)); resolveOld(); await new Promise(r=>setImmediate(r));
  const html=context.ResearchUI.candidatePanel(); assert.match(html,/new/); assert.match(html,/0 条已完成自动查询/); assert.doesNotMatch(html,/LATE/);
});
