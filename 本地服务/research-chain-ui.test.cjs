'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

function boot(fetchImpl, extras={}){
  const listeners={}; const store=new Map();
  const document={addEventListener:(n,f)=>{listeners[n]=f},querySelector:(sel)=>({value:sel.includes('Disease')?'三叉神经痛':''})};
  const context={window:{},document,localStorage:{getItem:k=>store.get(k)||null,setItem:(k,v)=>store.set(k,v)},location:{hash:''},fetch:fetchImpl,URL,AbortController,setTimeout,clearTimeout,setInterval,clearInterval,console,...extras};
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

test('teaching case is explicit offline load and keeps archived identity snapshots',async()=>{
  const f=async(url)=>String(url).includes('/api/teaching-case')?response({researchId:'case-1',disease:{label:'三叉神经痛'},source:'课堂精选资料',retrievedAt:'2026-10-09',records:[{pmid:'1',title:'课堂记录'}],candidates:[{name:'liquiritin'}],identityChecks:{0:{checkedAt:'2026-10-08',identity:{pubchem:{status:'ok',data:{moleculeId:'CID1',name:'liquiritin'}}},readiness:{status:'pending_data'}}}}):response({});
  const {context,listeners}=boot(f); const target={closest:s=>s==='#loadTeachingCase'?{}:null}; listeners.click({target}); await new Promise(r=>setImmediate(r));
  const saved=JSON.parse(context.localStorage.getItem('herblab-research-v2')); assert.equal(context.location.hash,'evidence'); assert.equal(saved.result.researchId,'case-1'); assert.equal(saved.result.offline,true); assert.equal(saved.checks['0'].identitySnapshot,true); assert.match(context.ResearchUI.provenance(),/离线资料来源/);
});

test('malformed manual import is rejected before network submission',async()=>{
  let calls=0; const f=async()=>{calls++;return response({})};
  class Reader{readAsText(){this.result='{bad';this.onload()}}
  const {context,listeners}=boot(f,{FileReader:Reader});
  listeners.change({target:{id:'researchImportFile',dataset:{},files:[{}],value:'x',closest:()=>null}}); await new Promise(r=>setImmediate(r));
  const saved=JSON.parse(context.localStorage.getItem('herblab-research-v2')); assert.equal(calls,0); assert.ok(saved.error);
});

test('valid manual file stages without fetch until confirmation',async()=>{
  const calls=[]; const f=async(url,options)=>{calls.push({url,options});return response({researchId:'import-1',disease:{label:'三叉神经痛'},records:[{pmid:'9',title:'Imported'}],candidates:[]})};
  class Reader{readAsText(){this.result=JSON.stringify({disease:{label:'三叉神经痛'},source:'手动资料',records:[{pmid:'9',title:'Imported'}],candidates:[]});this.onload()}}
  const {context,listeners}=boot(f,{FileReader:Reader});
  listeners.change({target:{id:'researchImportFile',dataset:{},files:[{name:'manual.json'}],value:'x',closest:()=>null}}); await new Promise(r=>setImmediate(r));
  assert.equal(calls.length,0); assert.match(context.ResearchUI.taskPanel(),/确认导入资料/);
  listeners.click({target:{closest:s=>s==='#confirmResearchImport'?{}:null}}); await new Promise(r=>setImmediate(r));
  assert.equal(calls.length,1); assert.equal(calls[0].url,'/api/research-import'); assert.equal(JSON.parse(calls[0].options.body).records[0].pmid,'9'); assert.equal(JSON.parse(context.localStorage.getItem('herblab-research-v2')).checks && Object.keys(JSON.parse(context.localStorage.getItem('herblab-research-v2')).checks).length,0);
});

test('ranking template keeps missing match and heat data null and is offered as a manual import',async()=>{
  const f=async(url)=>String(url).includes('/api/research')?response({researchId:'r-template',disease:{label:'偏头痛'},records:[{pmid:'123'}],query:'migraine',candidates:[{name:'候选甲',identifier:'machine-1',pmids:['123']}] }):response({});
  const {context,listeners}=boot(f); listeners.click({target:{closest:s=>s==='#researchSearch'?{}:null}}); await new Promise(r=>setImmediate(r));
  assert.match(context.ResearchUI.candidatePanel(),/导出本轮双排名待补模板/);
  const data=context.ResearchUI.rankingTemplate();
  assert.match(data.metadata.version,/^research-template-\d{4}-\d{2}-\d{2}$/);
  assert.equal(data.metadata.target,'研究主题：偏头痛');
  assert.equal(data.metadata.matchPolicy,'teacher-match-rubric-v1');
  assert.equal(data.metadata.filterPolicy,'classroom-inclusion-v1');
  assert.equal(data.metadata.heatDefinition,''); assert.equal(data.metadata.heatDate,'');
  assert.equal(data.candidates[0].id,'R001'); assert.equal(data.candidates[0].identity.status,'pending');
  assert.equal(data.candidates[0].match.score,null); assert.equal(data.candidates[0].heat.count,null);
  assert.equal(data.candidates[0].match.components.structure.value,null);
  assert.match(data.candidates[0].evidence,/PMID 123/); assert.match(data.candidates[0].evidence,/无报道不等于不匹配/);
  const result=require('../演示前端/ranking.js').compute(data);
  assert.equal(result.conventional.length,0); assert.equal(result.cold.length,0);
  assert.equal(result.rows[0].base,null); assert.equal(result.rows[0].heat,null);
});
