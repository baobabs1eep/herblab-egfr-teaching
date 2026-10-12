'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
test('two ranking modes keep evidence and docking dimensions separate',()=>{
 const context={structuredClone,localStorage:{getItem:()=>null,setItem:()=>{}},document:{addEventListener:()=>{}},esc:x=>String(x??''),icon:()=>'',heading:(a,b,c)=>a+b+c,actions:()=>'',window:null,URL:{createObjectURL:()=>'',revokeObjectURL:()=>{}},Blob:function(){}};context.window=context;
 for(const file of ['evidence-ranking.js','teaching-candidates.js','ranking-data.js','ranking-ui.js'])vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../演示前端',file),'utf8'),context);
 const html=vm.runInNewContext('rankingView()',context),summary=vm.runInNewContext('rankSummary()',context);
 assert.match(html,/证据教学排名/); assert.match(html,/三叉神经痛/); assert.match(html,/假设/); assert.match(html,/待补/);
 assert.doesNotMatch(summary,/综合分/);
 const docking=vm.runInNewContext('dockingView()',context); assert.match(docking,/结构 \/ 对接 \/ ADMET/); assert.match(docking,/独立示例/); assert.doesNotMatch(docking,/综合分[:：]\s*\d/);
 assert.throws(()=>context.validateCases({version:'bad',cases:[]}),/cases/);
 assert.throws(()=>context.validateCases({version:'bad',cases:[{id:'same',disease:'疾病',candidates:[]},{id:'same',disease:'疾病',candidates:[]}]}),/重复/);
 const dimensions={version:'test',mode:'independent-dimensions',disease:'Ⅱ型糖尿病',candidates:[{id:'one',name:'候选',dimensions:{structure:{score:42,source:'test fixture'},bbb:null}}]};
 context.dimensionData=undefined;
 context.inputDimensions=dimensions;
 vm.runInNewContext('dimensionData=validateDimensions(inputDimensions)',context);
 const output=vm.runInNewContext('dimensionView()',context);assert.match(output,/Ⅱ型糖尿病/);assert.match(output,/BBB/);assert.match(output,/待补/);assert.match(output,/42/);
 assert.equal(dimensions.candidates[0].totalScore,undefined);
});
