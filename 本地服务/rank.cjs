// node rank.cjs 数据.json [结果.json]
// 接受网页导出的完整计算记录或原始数据模板。不会调用智能体或读取密钥。
'use strict';
const fs=require('node:fs');
const ranking=require('../演示前端/ranking.js');
try{
 const file=process.argv[2];if(!file)throw new Error('用法：node 本地服务/rank.cjs 输入.json [结果.json]');
 const input=JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));
 const data=input.data||input,parameters=ranking.settings(input.data?input.parameters||{}:{});
 const result=ranking.compute(data,parameters);
 const output=JSON.stringify({exportedAt:new Date().toISOString(),warning:'教学排序规则草案，未作科学有效性验证',data,parameters,result},null,2)+'\n';
 if(process.argv[3])fs.writeFileSync(process.argv[3],output,{encoding:'utf8',flag:'wx'});else process.stdout.write(output);
}catch(err){console.error('排序未完成：'+err.message);process.exitCode=1;}
