"""Compute unaligned redock RMSD with chemically equivalent heavy-atom mappings."""
from pathlib import Path
import math
from rdkit import Chem

ROOT = Path(__file__).resolve().parent

def atoms(path):
    out = {}
    for line in path.read_text(encoding='utf-8').splitlines():
        if line.startswith('ENDMDL'):
            break
        if line.startswith('ATOM') and line.split()[-1] not in ('H','HD'):
            out[int(line[6:11])] = tuple(float(line[i:i+8]) for i in (30,38,46))
    return out

def run(directory, label):
    sdf = Chem.MolFromMolBlock((directory/f'{label}.sdf').read_text(encoding='utf-8').split('$$$$')[0],removeHs=True)
    if sdf is None:
        raise ValueError('SDF read failed')
    native, docked = atoms(directory/f'{label}.pdbqt'),atoms(directory/f'{label}-out.pdbqt')
    if len(native)!=sdf.GetNumAtoms() or native.keys()!=docked.keys():
        raise ValueError('Atom counts or serials differ')
    coords = sdf.GetConformer().GetPositions()
    # Match SDF and native PDBQT heavy atoms by their unchanged crystal coordinates.
    assignment = {}
    for i,xyz in enumerate(coords):
        match = [k for k,v in native.items() if sum((float(a)-b)**2 for a,b in zip(xyz,v))<0.001]
        if len(match)!=1:
            raise ValueError(f'Atom {i}: ambiguous crystal coordinate match')
        assignment[i]=match[0]
    mappings = sdf.GetSubstructMatches(sdf,uniquify=False,maxMatches=10000)
    values=[]
    for mapping in mappings:
        values.append(math.sqrt(sum(sum((a-b)**2 for a,b in zip(native[assignment[i]],docked[assignment[mapping[i]]])) for i in range(len(mapping)))/len(mapping)))
    print(f'{directory.name}/{label}: automorphisms={len(mappings)}, direct={values[0]:.3f}, symmetry_best={min(values):.3f}')

run(ROOT/'prepared','AQ4_native')
run(ROOT/'prepared_4I22','IRE_native')
