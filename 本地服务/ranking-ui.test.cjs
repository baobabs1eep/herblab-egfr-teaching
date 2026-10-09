'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
test('dual ranking page explains surprisal and renders all parameter controls',()=>{
 const context={HerbRanking:require('../演示前端/ranking.js'),structuredClone,localStorage:{getItem:()=>null,setItem:()=>{}},document:{addEventListener:()=>{}},candidates:[],esc:x=>String(x??''),icon:()=>'',heading:(a,b,c)=>a+b+c,actions:()=>'',window:null};context.window=context;
 for(const file of ['ranking-data.js','ranking-ui.js'])vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../演示前端',file),'utf8'),context);
 const html=vm.runInNewContext('rankingView()',context);
 assert.match(html,/惊奇度/);assert.match(html,/匹配分/);assert.match(html,/rank-smoothing/);
 assert.doesNotMatch(html,/新颖度系数依次为/);
 assert.match(vm.runInNewContext('rankSummary()',context),/0\.2\.0/);
 const result=vm.runInNewContext('HerbRanking.compute(rankData,rankParams)',context);
 assert.equal(result.conventional.length,3);assert.equal(result.cold.length,3);
 assert.ok(result.cold.every(x=>Number.isFinite(x.surprisal)));
});
