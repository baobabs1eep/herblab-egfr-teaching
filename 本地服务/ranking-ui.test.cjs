'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');

test('matching ranking page renders structure/channel/affinity matching without novelty controls',()=>{
 const context={HerbRanking:require('../演示前端/ranking.js'),structuredClone,localStorage:{getItem:()=>null,setItem:()=>{}},document:{addEventListener:()=>{}},esc:x=>String(x??''),icon:()=>'',heading:(a,b,c)=>a+b+c,actions:()=>'',window:null};
 context.window=context;
 for(const file of ['ranking-data.js','ranking-ui.js'])vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../演示前端',file),'utf8'),context);
 const html=vm.runInNewContext('rankingView()',context),summary=vm.runInNewContext('rankSummary()',context),result=vm.runInNewContext('HerbRanking.compute(rankData,rankParams)',context);
 assert.match(html,/结构 \/ 通道 \/ 亲和力/);
 assert.match(html,/匹配方法/);
 assert.match(html,/当前 EGFR 对接代理/);
 assert.match(html,/文献热度.*不参与排序/);
 assert.doesNotMatch(html,/rank-(bonus|smoothing)/);
 assert.doesNotMatch(html,/惊奇度|新颖度|冷门加分|非热门/);
 assert.doesNotMatch(summary,/惊奇度|新颖度|冷门|双排序/);
 assert.ok(Array.isArray(result.rows));
 assert.ok(Array.isArray(result.conventional));
 assert.equal(result.cold,undefined);
 assert.ok(Object.prototype.hasOwnProperty.call(result,'matchingWeights'));
});
