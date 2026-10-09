/* 可复现的教学排序规则；无网络、无隐式补值。浏览器与 Node 共用。 */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.HerbRanking=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
 'use strict';
 const VERSION='herblab-ranking-0.2.0';
 const DEFAULTS=Object.freeze({strong:-12,weak:-4,minBase:50,bonus:10,smoothing:1});
 const text=v=>typeof v==='string'&&!!v.trim();
 const finite=v=>typeof v==='number'&&Number.isFinite(v);
 const date=v=>text(v)&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v;
 function normalizedWeights(value){
  if(value==null)return [1/3,1/3,1/3];
  if(!Array.isArray(value)||value.length!==3||!value.every(x=>finite(x)&&x>0))throw new Error('matchWeights 须为三个正数。');
  const max=Math.max(...value),scaled=value.map(x=>x/max),sum=scaled.reduce((a,b)=>a+b,0);
  return scaled.map(x=>x/sum);
 }
 function validate(data){
  if(!data||typeof data!=='object'||!data.metadata||typeof data.metadata!=='object'||!Array.isArray(data.candidates)||!data.candidates.length||data.candidates.length>5000)throw new Error('数据须包含 metadata 和 1–5000 条 candidates。');
  if(!text(data.metadata.version)||!text(data.metadata.target))throw new Error('请填写数据版本 version 和统一靶点 target。');
  const ids=new Set();
  for(const c of data.candidates){
   if(!c||!text(c.id)||!text(c.name)||ids.has(c.id))throw new Error('每条候选须有唯一 id 和 name。');ids.add(c.id);
   if(!['pass','fail','unknown'].includes(c.filter?.status))throw new Error(`${c.id} 的 filter.status 须为 pass、fail 或 unknown。`);
   if(!['verified','pending'].includes(c.identity?.status))throw new Error(`${c.id} 的 identity.status 须为 verified 或 pending。`);
   if(c.docking?.score!=null&&!finite(c.docking.score))throw new Error(`${c.id} 的 docking.score 须为数值或 null，不能填字符串。`);
   if(c.heat?.count!=null&&(!Number.isSafeInteger(c.heat.count)||c.heat.count<0))throw new Error(`${c.id} 的 heat.count 须为非负整数或 null。`);
   if(c.match?.score!=null&&(!finite(c.match.score)||c.match.score<0||c.match.score>100))throw new Error(`${c.id} 的 match.score 须为 0–100 数值或 null。`);
  }
  return data;
 }
 function settings(input={}){const p={...DEFAULTS,...input};if(![p.strong,p.weak,p.minBase,p.bonus,p.smoothing].every(finite)||!Number.isFinite(p.weak-p.strong)||p.strong>=p.weak||p.minBase<0||p.minBase>100||p.bonus<0||p.bonus>20||p.smoothing<=0||p.smoothing>100)throw new Error('参数无效：强锚点须小于弱锚点，基础门槛 0–100，冷门加分上限 0–20，平滑项须为 0–100 的正数。');return p;}
 function ranked(rows,key){let prior=null,rank=0;return [...rows].sort((a,b)=>b[key]-a[key]||(a.id<b.id?-1:a.id>b.id?1:0)).map((r,i)=>{if(prior===null||r[key]!==prior)rank=i+1;prior=r[key];return {...r,rank};});}
 function compute(data,input={}){
  validate(data);const p=settings(input),m=data.metadata,matchingWeights=normalizedWeights(m.matchWeights);
  const rows=data.candidates.map(c=>{
   const matchMissing=[];
   if(c.identity.status!=='verified'||!text(c.identity.source))matchMissing.push('分子身份与结构核验记录');
   if(c.filter.status==='unknown')matchMissing.push('硬过滤结论');
   if(!text(c.filter.source))matchMissing.push('硬过滤执行记录（含 ADMET 风险）');
   if(c.filter.policy!==m.filterPolicy||!text(c.filter.policy))matchMissing.push('与统一规则一致的过滤版本');
   let base=null,matchMethod=null,matchSource=null,componentInfo=null;
   if(c.match!=null){
    const common=text(c.match.source)&&c.match.target===m.target&&text(m.matchPolicy)&&c.match.policy===m.matchPolicy;
    const scoreOk=finite(c.match.score)&&c.match.score>=0&&c.match.score<=100;
    if(common&&scoreOk){base=c.match.score;matchMethod='provided-score';matchSource=c.match.source;}
    else if(common&&c.match.score==null&&c.match.components&&typeof c.match.components==='object'){
     const names=['structure','channel','affinity'], components=names.map(name=>c.match.components[name]);
     const componentOk=components.every(x=>x&&finite(x.value)&&x.value>=0&&x.value<=100&&text(x.source));
     if(componentOk){base=components.reduce((s,x,i)=>s+x.value*matchingWeights[i],0);matchMethod='structured-components';matchSource=c.match.source;componentInfo={weights:matchingWeights,components:c.match.components};}
     else matchMissing.push('完整且可追溯的结构、通道、亲和力匹配分量');
    }else matchMissing.push('与统一靶点及匹配规则一致的显式匹配结果');
   }else{
    const dockingOk=finite(c.docking?.score)&&text(m.protocol)&&c.docking.protocol===m.protocol&&c.docking.target===m.target&&text(c.docking.source);
    if(dockingOk){base=c.docking.score<=p.strong?100:c.docking.score>=p.weak?0:(p.weak-c.docking.score)/(p.weak-p.strong)*100;matchMethod='docking';matchSource=c.docking.source;}
    else{
     if(!finite(c.docking?.score))matchMissing.push('对接分数');
     if(!text(c.docking?.source))matchMissing.push('对接结果出处');
     if(c.docking?.protocol!==m.protocol||!text(c.docking?.protocol))matchMissing.push('与统一协议一致的对接版本');
     if(c.docking?.target!==m.target)matchMissing.push('与统一靶点一致的对接目标');
    }
   }
   const heatMissing=[];
   if(!text(m.heatDefinition))heatMissing.push('统一文献检索口径');
   if(!date(m.heatDate))heatMissing.push('有效的统一检索日期');
   if(c.heat?.count==null)heatMissing.push('文献热度计数（未知不作 0）');
   if(!text(c.heat?.query)||!text(c.heat?.source))heatMissing.push('可复核的检索式和计数出处');
   if(c.heat?.date!==m.heatDate||!date(c.heat?.date))heatMissing.push('与统一日期一致的检索记录');
   const excluded=c.filter.status==='fail';
   const below=base!==null&&base<p.minBase;
   const matchEligible=!excluded&&!matchMissing.length&&!below;
   return {id:c.id,name:c.name,base,heat:c.heat?.count??null,boost:null,cold:null,eligible:false,matchEligible,status:excluded?'过滤未通过':matchMissing.length?'待补数据':below?'低于基础门槛':'可排序',missing:[...matchMissing,...heatMissing],matchMissing,heatMissing,reason:c.filter.reason||'',evidence:c.evidence||'未填写',risk:c.risk||'未填写',matchSource,matchMethod,componentInfo,heatProbability:null,surprisal:null,novelty:null};
  });
  const coldPool=rows.filter(r=>r.matchEligible&&!r.heatMissing.length&&r.heat!==null);
  const counts=coldPool.map(r=>r.heat);
  const maxCount=counts.length?Math.max(...counts):0;
  const scaledSum=maxCount?counts.reduce((s,n)=>s+n/maxCount,0):0;
  const denom=maxCount?scaledSum+p.smoothing*counts.length/maxCount:p.smoothing*counts.length;
  const values=coldPool.map(r=>{const I=maxCount?Math.log2(maxCount)+Math.log2(denom)-Math.log2(r.heat+p.smoothing):Math.log2(counts.length);return {r,q:2**(-I),I};});
  const minI=values.length?Math.min(...values.map(v=>v.I)):null,maxI=values.length?Math.max(...values.map(v=>v.I)):null;
  for(const v of values){const novelty=minI===null||maxI===minI||values.length<2?0:(v.I-minI)/(maxI-minI);v.r.heatProbability=v.q;v.r.surprisal=v.I;v.r.novelty=novelty;v.r.boost=p.bonus*novelty;v.r.cold=v.r.base+v.r.boost;v.r.eligible=true;}
  const conventional=ranked(rows.filter(r=>r.matchEligible),'base'),cold=ranked(rows.filter(r=>r.eligible),'cold');
  const firstRanks=new Map(conventional.map(r=>[r.id,r.rank]));
  const coldBaseline=ranked(coldPool,'base'),baseRanks=new Map(coldBaseline.map(r=>[r.id,r.rank]));
  for(const r of rows){r.firstRankOriginal=firstRanks.get(r.id)||null;r.baselineRankInColdPool=baseRanks.get(r.id)||null;}
  for(const r of cold){r.firstRankOriginal=firstRanks.get(r.id)||null;r.baselineRankInColdPool=baseRanks.get(r.id)||null;r.delta=r.baselineRankInColdPool-r.rank;}
  return {engineVersion:VERSION,parameters:p,total:rows.length,eligible:cold.length,rows,conventional,cold,reference:{method:'candidate-report-share',poolSize:values.length,totalReports:counts.reduce((s,n)=>s+n,0),smoothing:p.smoothing,minSurprisal:minI,maxSurprisal:maxI,deltaScope:'same-heat-known-pool'},conventionalEligible:conventional.length,matchingWeights};
 }
 return {VERSION,DEFAULTS,validate,settings,compute};
});
