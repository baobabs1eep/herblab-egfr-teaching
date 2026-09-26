"""Package measured docking logs and QC without promoting them to validated rankings."""
from pathlib import Path
import copy
import hashlib
import json
import math
import re

ROOT = Path(__file__).resolve().parent
OUT = ROOT / 'prepared_4I22'
BASE = ROOT / 'prepared'

def heavy_atoms(path):
    result = {}
    for line in path.read_text(encoding='utf-8').splitlines():
        if line.startswith('ENDMDL'):
            break
        if line.startswith('ATOM') and line.split()[-1] not in ('H','HD'):
            result[int(line[6:11])] = tuple(float(line[i:i+8]) for i in (30,38,46))
    return result

def rmsd(native, docked):
    if native.keys() != docked.keys():
        raise ValueError('Atom map changed; direct RMSD invalid')
    return math.sqrt(sum(sum((a-b)**2 for a,b in zip(native[k],docked[k])) for k in native)/len(native))

native = heavy_atoms(OUT/'IRE_native.pdbqt')
docked = heavy_atoms(OUT/'IRE_native-out.pdbqt')
qc = {'structure':'4I22','ligand':'IRE (gefitinib)','heavy_atoms':len(native),'top_pose_rmsd_angstrom':round(rmsd(native,docked),3),'passes_2_angstrom':rmsd(native,docked)<2,'input_sha256':hashlib.sha256((ROOT/'input'/'4I22.pdb').read_bytes()).hexdigest(),'log_sha256':hashlib.sha256((OUT/'IRE_native.log').read_bytes()).hexdigest(),'log':'IRE_native.log','pose':'IRE_native-out.pdbqt','protocol':'AutoDock Vina 1.2.7; vina scoring; chain A rigid receptor; exhaustiveness 16; seed 20260926; CPU 2'}
(OUT/'validation.json').write_text(json.dumps(qc,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')

source = ROOT.parent/'三候选已查热度与ADME_待对接.json'
data = copy.deepcopy(json.loads(source.read_text(encoding='utf-8')))
data['metadata']['version'] = 'egfr-wt-1m17-docking-exploratory-2026-09-27-v1'
data['metadata']['target'] = 'EGFR WT, PDB 1M17 chain A'
data['metadata']['protocol'] = '1M17-WT-Vina-1.2.7-ex16-seed20260926-v1'
data['metadata']['description'] = '探索性教学试算：3 个候选已按统一协议对接，但共晶 AQ4 首位姿势回对接 RMSD 5.976 Å，不满足预设 <2 Å 自检；不应视为经验证的结合能力或正式双排名。硬过滤亦未确认。'
data['metadata']['dockingValidation'] = {'status':'failed','nativeLigand':'AQ4 (erlotinib)','topPoseRmsdAngstrom':5.976,'thresholdAngstrom':2,'secondaryCheck':f'4I22 IRE top pose RMSD {qc["top_pose_rmsd_angstrom"]:.3f} Å, also failed','details':'对接复现/prepared/results.json; 对接复现/prepared_4I22/validation.json'}
results = json.loads((BASE/'results.json').read_text(encoding='utf-8'))
for c in data['candidates']:
    item = results['scores'][c['id']]
    c['docking'] = {'score':item['score_kcal_mol'],'target':data['metadata']['target'],'protocol':data['metadata']['protocol'],'source':f'对接复现/prepared/{item["log"]}','validation':'failed','pose':f'对接复现/prepared/{item["pose"]}'}
    c['filter']['reason'] = '已获得 SwissADME 预测，但综合硬过滤规则未确定；对接协议共晶回放自检亦未通过，故不得作为正式排名候选。'
dest = ROOT.parent/'三候选对接试算_验证未通过_不作正式排名.json'
dest.write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(json.dumps({'second_qc':qc['top_pose_rmsd_angstrom'],'scores':{c['id']:c['docking']['score'] for c in data['candidates']},'packaged':str(dest)},ensure_ascii=False))
