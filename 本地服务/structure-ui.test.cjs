'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
function boot(saved={},fetch=async()=>{throw new Error('unexpected fetch')}){const handlers={},memory=new Map([['herblab-structure-pool-v1',JSON.stringify(saved)]]);const c={localStorage:{getItem:k=>memory.get(k),setItem:(k,v)=>memory.set(k,v)},document:{addEventListener:(n,f)=>handlers[n]=f},URL,Blob,AbortSignal,fetch,setTimeout,window:null};c.window=c;c.render=()=>{};vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../演示前端/structure-ui.js'),'utf8'),c);return {c,handlers};}
test('database-only pool imports without papers, but cannot invent complete matching',()=>{
 const {c}=boot({accession:'P00533',result:{reference:{cid:1},candidates:[{name:'unreported',identity:{sourceURL:'https://pubchem.ncbi.nlm.nih.gov/compound/2'},structure:{status:'computed',score:60,method:'Tanimoto',referenceCID:1},binding:{status:'pending',total:null,records:[]}}]}});
 const pool=c.StructureUI.parsePool({provenance:{source:'HERB'},records:[{name:'unreported',smiles:'CC'}]});assert.equal(pool.length,1);assert.equal(pool[0].source,'HERB');
 const data=c.StructureUI.template();assert.equal(data.candidates[0].dimensions.structure.score,60);assert.equal(data.candidates[0].dimensions.admet,null);assert.equal(data.candidates[0].dimensions.bbb,null);
 assert.equal(data.mode,'independent-dimensions');assert.equal(data.candidates[0].totalScore,undefined);
 assert.match(c.StructureUI.panel(),/不要求已有疾病文献/);assert.doesNotMatch(c.StructureUI.panel(),/惊奇度/);
});
test('imported mechanism dimensions remain visible without fabricated values',()=>{
 const {c}=boot({pool:[{name:'candidate-a',source:'TCMSP',smiles:'CC',target:'SCN9A',affinity:'7.2',admet:'oral bioavailability 42',bbb:'unknown',toxicity:'pending',dimensionSource:'licensed export v1'}]});
 const html=c.StructureUI.panel();assert.match(html,/模式二候选单体/);assert.match(html,/candidate-a/);assert.match(html,/机制与性质 5\/5/);assert.match(html,/licensed export v1/);
 const parsed=c.StructureUI.parsePool({records:[{name:'candidate-b',target:'TRPV1',admet:61,dimensionSource:'source record'}]});assert.equal(parsed[0].target,'TRPV1');assert.equal(parsed[0].admet,61);assert.equal(parsed[0].bbb,null);
});
test('structure action submits only batch names reference and target, with no literature request',async()=>{
 const calls=[];const {handlers}=boot({names:'candidate',reference:'reference',accession:'P00533',pool:[{name:'extra'}]},async(url,options)=>{calls.push({url,body:JSON.parse(options.body)});return {ok:true,json:async()=>({reference:{cid:1},candidates:[]})}});
 await handlers.click({target:{closest:()=>({id:'structureRun'})}});assert.equal(calls.length,1);assert.equal(calls[0].url,'/api/structure-screen');assert.deepEqual(calls[0].body,{names:['candidate'],reference:'reference',accession:'P00533'});
});

test('switching study scopes hides old structure results and restores the correct study',async()=>{
 const {c,handlers}=boot();c.StructureUI.panel({scope:'tn',disease:'三叉神经痛'});
 handlers.input({target:{id:'structureNames',value:'Liquiritin'}});
 assert.match(c.StructureUI.panel({scope:'tn',disease:'三叉神经痛'}),/Liquiritin/);
 assert.doesNotMatch(c.StructureUI.panel({scope:'diabetes',disease:'Ⅱ型糖尿病'}),/Liquiritin/);
 assert.match(c.StructureUI.panel({scope:'tn',disease:'三叉神经痛'}),/Liquiritin/);
});

test('late structure response stays in original study after disease switch',async()=>{
 let finish;const {c,handlers}=boot({},async()=>new Promise(resolve=>{finish=()=>resolve({ok:true,json:async()=>({reference:{cid:1},candidates:[{name:'TN_ONLY',structure:{status:'computed',score:90},binding:{status:'pending'}}]})})}));
 c.StructureUI.panel({scope:'tn',disease:'三叉神经痛'});
 handlers.input({target:{id:'structureNames',value:'Liquiritin'}});handlers.input({target:{id:'structureReference',value:'reference'}});
 const pending=handlers.click({target:{closest:()=>({id:'structureRun'})}});
 c.StructureUI.panel({scope:'diabetes',disease:'Ⅱ型糖尿病'});finish();await pending;
 assert.doesNotMatch(c.StructureUI.panel({scope:'diabetes',disease:'Ⅱ型糖尿病'}),/TN_ONLY/);
 assert.match(c.StructureUI.panel({scope:'tn',disease:'三叉神经痛'}),/TN_ONLY/);
});
