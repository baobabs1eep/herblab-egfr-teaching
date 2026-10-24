'use strict';

const initRDKitModule = require('@rdkit/rdkit');

const ECFP_OPTIONS = Object.freeze({radius: 2, fplen: 2048});
let modulePromise;

function rdkit() {
  if (!modulePromise) modulePromise = initRDKitModule();
  return modulePromise;
}

function popcount(value) {
  let n = value;
  let count = 0;
  while (n) { n &= n - 1; count += 1; }
  return count;
}

function tanimoto(left, right) {
  if (!(left instanceof Uint8Array) || !(right instanceof Uint8Array) || left.length !== right.length || left.length === 0) {
    throw new TypeError('Morgan fingerprints must be equal-length Uint8Array values');
  }
  let intersection = 0;
  let union = 0;
  for (let i = 0; i < left.length; i += 1) {
    intersection += popcount(left[i] & right[i]);
    union += popcount(left[i] | right[i]);
  }
  return union === 0 ? 1 : intersection / union;
}

async function describe(smiles) {
  if (typeof smiles !== 'string' || !smiles.trim() || smiles.length > 10000) throw new Error('SMILES is invalid');
  const kit = await rdkit();
  const mol = kit.get_mol(smiles.trim());
  try {
    if (!mol?.is_valid()) throw new Error('SMILES could not be parsed by RDKit');
    const fingerprint = new Uint8Array(mol.get_morgan_fp_as_uint8array(JSON.stringify(ECFP_OPTIONS)));
    if (fingerprint.length !== 256) throw new Error('RDKit returned an unexpected ECFP length');
    const descriptors = JSON.parse(mol.get_descriptors());
    return {
      fingerprint,
      descriptors,
      canonicalSmiles: mol.get_smiles(),
      method: 'Morgan fingerprint (ECFP4), radius 2, 2048 bits; Tanimoto',
    };
  } finally { mol?.delete?.(); }
}

module.exports = {describe, tanimoto, ECFP_OPTIONS};
