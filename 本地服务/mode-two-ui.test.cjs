'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

test('mode two UI keeps both automatic groups and the original manual input panel',()=>{
  const source=fs.readFileSync(path.join(__dirname,'../演示前端/mode-two-ui.js'),'utf8');
  assert.match(source,/groups\.length<10/);
  assert.match(source,/ECFP4/);
  assert.match(source,/≥40%/);
  assert.match(source,/只使用 TCMBank 官方成分表/);
  assert.match(source,/关联中药/);
  assert.doesNotMatch(source,/HERB 结构库作为候选来源/);
  assert.match(source,/data-mode2-more/);
  assert.match(source,/manualPanel/);
  assert.match(source,/data-mode2-view="automatic"/);
  assert.match(source,/data-mode2-view="manual"/);
  assert.match(source,/人工输入与计算/);
});

test('manual tab renders the retained ingredient, reference and target inputs',async()=>{
  const handlers={};
  const context={
    localStorage:{getItem(){return null},setItem(){}},
    document:{addEventListener(name,fn){(handlers[name]??=[]).push(fn)},querySelectorAll(){return[]}},
    URL,Blob,AbortSignal,setTimeout,clearTimeout,fetch:async()=>{throw new Error('unexpected fetch')},
    location:{hash:''},render(){},window:null,
  };
  context.window=context;
  vm.createContext(context);
  for(const file of ['structure-ui.js','mode-two-ui.js'])vm.runInContext(fs.readFileSync(path.join(__dirname,'../演示前端',file),'utf8'),context);
  assert.match(context.StructureUI.panel(),/自动生成十组/);
  const button={dataset:{mode2View:'manual'},id:'',closest(){return this}};
  for(const handler of handlers.click)await handler({target:button});
  const html=context.StructureUI.panel();
  assert.match(html,/id="structureNames"/);
  assert.match(html,/id="structureReference"/);
  assert.match(html,/id="structureAccession"/);
});
