"""Extract Vina mode 1 scores and compare the AQ4 redock pose in the unchanged receptor frame."""
from pathlib import Path
import hashlib
import json
import math
import re

ROOT=Path(__file__).resolve().parent
DATA=ROOT/'prepared'

def first_mode_atoms(path):
    lines=path.read_text(encoding='utf-8').splitlines()
    atoms=[]
    for line in lines:
        if line.startswith('ENDMDL'):
            break
        if line.startswith('ATOM'):
            atom_type=line.split()[-1]
            if atom_type in ('HD','H'):
                continue
            atoms.append((int(line[6:11]),[float(line[i:i+8]) for i in (30,38,46)]))
    return dict(atoms)

def all_mode_atoms(path):
    chunks=path.read_text(encoding='utf-8').split('MODEL')
    result=[]
    for chunk in chunks[1:]:
        block=chunk.split('ENDMDL')[0]
        atoms={}
        for line in block.splitlines():
            if line.startswith('ATOM') and line.split()[-1] not in ('HD','H'):
                atoms[int(line[6:11])]=[float(line[i:i+8]) for i in (30,38,46)]
        if atoms:result.append(atoms)
    return result

scores={}
for item in ['C001','C002','C003','AQ4_native']:
    log=DATA/f'{item}.log'; output=DATA/f'{item}-out.pdbqt'
    text=log.read_text(encoding='utf-8')
    match=re.search(r'^\s*1\s+(-?\d+\.\d+)\s+0\s+0\s*$',text,re.MULTILINE)
    if not match or not output.exists():
        raise ValueError(f'No complete first-ranked docking pose for {item}')
    scores[item]={'score_kcal_mol':float(match.group(1)),'log':log.name,'pose':output.name,'log_sha256':hashlib.sha256(log.read_bytes()).hexdigest(),'pose_sha256':hashlib.sha256(output.read_bytes()).hexdigest(),'heavy_atoms_first_mode':len(first_mode_atoms(output))}

native=first_mode_atoms(DATA/'AQ4_native.pdbqt')
docked=first_mode_atoms(DATA/'AQ4_native-out.pdbqt')
if native.keys()!=docked.keys() or len(native)!=29:
    raise ValueError('AQ4 heavy atom mapping changed; redock RMSD cannot be calculated')
rmsd=math.sqrt(sum(sum((a-b)**2 for a,b in zip(native[k],docked[k])) for k in native)/len(native))
scores['AQ4_native']['heavy_atom_rmsd_angstrom']=rmsd
scores['AQ4_native']['all_mode_rmsd_angstrom']=[math.sqrt(sum(sum((a-b)**2 for a,b in zip(native[k],pose[k])) for k in native)/len(native)) for pose in all_mode_atoms(DATA/'AQ4_native-out.pdbqt') if pose.keys()==native.keys()]
out={'protocol':'EGFR-1M17-WT-Vina-1.2.7-v1','software':'AutoDock Vina v1.2.7','scoring':'vina','receptor':'1M17 chain A, HETATM removed, Meeko 0.8.0 receptor template charges','box':json.loads((DATA/'box.json').read_text(encoding='utf-8')),'exhaustiveness':16,'seed':20260926,'cpu':2,'scores':scores,'warning':'Single conformer per neutral ligand and one seed; docking score is not measured binding affinity. Native AQ4 redock RMSD is a protocol check, not proof of predictions.'}
(DATA/'results.json').write_text(json.dumps(out,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(json.dumps({'scores':{k:v['score_kcal_mol'] for k,v in scores.items()},'AQ4_redock_RMSD_A':rmsd,'AQ4_all_pose_RMSD_A':scores['AQ4_native']['all_mode_rmsd_angstrom']},ensure_ascii=False,indent=2))
