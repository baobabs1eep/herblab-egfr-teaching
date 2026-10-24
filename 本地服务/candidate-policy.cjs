'use strict';

const NAME_BLOCKS = [
  [/^(?:water|distilled water|purified water|h2o)$/i, '水或溶剂'],
  [/^(?:ethanol|methanol|isopropanol|acetone|chloroform|dimethyl sulfoxide|dmso)$/i, '常用溶剂'],
  [/^(?:sodium chloride|potassium chloride|phosphate buffered saline|pbs|saline)$/i, '缓冲液或无机盐'],
  [/^(?:vehicle|solvent|buffer|control|placebo|extract|fraction|mixture)$/i, '实验辅助物或未定义混合物'],
];

function screenSeed(candidate = {}, chemical = null) {
  const name = String(candidate.name || '').trim();
  if (!name) return {eligible: false, reason: '缺少候选名称'};
  for (const [pattern, reason] of NAME_BLOCKS) if (pattern.test(name)) return {eligible: false, reason};
  if (!chemical) return {eligible: true, reason: null};
  const d = chemical.descriptors || {};
  if (Number(d.NumHeavyAtoms) < 5) return {eligible: false, reason: '分子过小，疑似溶剂、离子或实验辅助物'};
  if (Number(d.exactmw) < 70) return {eligible: false, reason: '分子量过低，疑似非有效候选'};
  if (!/[Cc]/.test(String(chemical.canonicalSmiles || ''))) return {eligible: false, reason: '不含碳骨架，疑似无机物'};
  return {eligible: true, reason: null};
}

module.exports = {screenSeed, NAME_BLOCKS};
