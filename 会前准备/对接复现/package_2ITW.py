"""Package the common 2ITW protocol and narrowly scoped teaching-screen ranking input."""
from pathlib import Path
import copy,hashlib,json,math,re

ROOT=Path(__file__).resolve().parent
DATA=ROOT/'prepared_2ITW'

def first_heavy(path):
    out={}
    for line in path.read_text(encoding='utf-8').splitlines():
        if line.startswith('ENDMDL'): break
        if line.startswith('ATOM') and line.split()[-1] not in ('H','HD'):
            out[int(line[6:11])]=tuple(float(line[i:i+8]) for i in (30,38,46))
    return out

def score(log):
    match=re.search(r'^\s*1\s+(-?\d+(?:\.\d+)?)\s+0\s+0\s*$',log.read_text(encoding='utf-8'),re.MULTILINE)
    if not match: raise ValueError(f'First-ranked score missing: {log}')
    return float(match.group(1))

native=first_heavy(DATA/'ITQ_native.pdbqt')
pose=first_heavy(DATA/'ITQ_native-out.pdbqt')
if native.keys()!=pose.keys() or len(native)!=35: raise ValueError('Reference heavy-atom mapping failed')
rmsd=math.sqrt(sum(sum((a-b)**2 for a,b in zip(native[k],pose[k])) for k in native)/len(native))
if rmsd>=2: raise ValueError(f'Redocking failed the predeclared 2 Å threshold: {rmsd}')
protocol='2ITW-WT-Vina-1.2.7-vina-ex16-seed20260926-v1'
target='EGFR WT, PDB 2ITW chain A (ATP site)'
validation={'structure':'https://www.rcsb.org/structure/2ITW','reference_ligand':'ITQ/AFN941','top_pose_heavy_atom_rmsd_angstrom':round(rmsd,3),'predeclared_threshold_angstrom':2,'passes':True,'reference_score_kcal_mol':score(DATA/'ITQ_native.log'),'protein_prep':'chain A ATOM records; waters/HETATM removed; incomplete A:1018 (single N atom) ignored by Meeko because 6.8178 Å outside box','ligand_prep':'native ITQ coordinates and RCSB ITQ bond-order template, Meeko 0.8.0','box':json.loads((DATA/'box.json').read_text(encoding='utf-8')),'vina_version':'1.2.7','scoring':'vina','exhaustiveness':16,'seed':20260926,'cpu':2,'receptor_pdbqt_sha256':hashlib.sha256((DATA/'2ITW_chainA.pdbqt').read_bytes()).hexdigest(),'log_sha256':hashlib.sha256((DATA/'ITQ_native.log').read_bytes()).hexdigest(),'pose_sha256':hashlib.sha256((DATA/'ITQ_native-out.pdbqt').read_bytes()).hexdigest(),'limitation':'One reference ligand redocking checks pose recovery, not prospective binding-affinity or safety accuracy.'}
(DATA/'validation.json').write_text(json.dumps(validation,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
seed_scores={}
for seed in (20260926,20260927,20260928):
    seed_scores[str(seed)]={}
    for cid in ('C001','C002','C003'):
        directory=DATA if seed==20260926 else DATA/'seed_checks'
        name=f'{cid}.log' if seed==20260926 else f'{cid}-{seed}.log'
        seed_scores[str(seed)][cid]=score(directory/name)
seed_order={seed:sorted(values,key=values.get) for seed,values in seed_scores.items()}
seed_summary={'protocol':protocol,'scores_kcal_mol':seed_scores,'order_low_to_high':seed_order,'order_stable_in_three_seeds':len({tuple(x) for x in seed_order.values()})==1,'limitation':'Only three random seeds of one rigid receptor and one ligand state; this is a limited numerical sensitivity check, not predictive validation.'}
(DATA/'seed_checks'/'summary.json').write_text(json.dumps(seed_summary,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
source=ROOT.parent/'三候选已查热度与ADME_待对接.json'
data=copy.deepcopy(json.loads(source.read_text(encoding='utf-8')))
screen=json.loads((ROOT/'基础性质预筛_非安全结论.json').read_text(encoding='utf-8'))
screens={r['id']:r for r in screen['candidates']}
data['metadata'].update({'version':'egfr-wt-2itw-teaching-double-ranking-2026-09-27-v1','target':target,'protocol':protocol,'filterPolicy':screen['version'],'description':'可复核的 EGFR 野生型教学排序：同一结构/参数下三候选对接，参考 ITQ 首位回对接 RMSD 0.913 Å；三种随机种子名次相同；过滤仅限 SwissADME 基础性质预筛，非完整 ADMET/安全性；排序不是实测疗效。','dockingValidation':validation,'seedSensitivity':seed_summary,'filterScope':'Lipinski 0 violation AND predicted GI absorption High; PAINS/CYP warnings retained, not safety clearance'})
for c in data['candidates']:
    cid=c['id']; item=screens[cid]
    log=DATA/f'{cid}.log'; pose_file=DATA/f'{cid}-out.pdbqt'
    if not log.exists() or not pose_file.exists(): raise ValueError(f'Missing docking outputs for {cid}')
    c['docking']={'score':score(log),'target':target,'protocol':protocol,'source':f'对接复现/prepared_2ITW/{cid}.log','pose':f'对接复现/prepared_2ITW/{cid}-out.pdbqt','log_sha256':hashlib.sha256(log.read_bytes()).hexdigest(),'pose_sha256':hashlib.sha256(pose_file.read_bytes()).hexdigest(),'units':'Vina kcal/mol score, not measured binding free energy'}
    c['filter']={'status':item['status'],'policy':screen['version'],'source':'对接复现/基础性质预筛_非安全结论.json','reason':'仅通过 Lipinski 0 违反且预测胃肠吸收 High 的教学基础性质预筛；PAINS catechol_A 和 CYP 抑制预测仍为警示，未证明安全。'}
dest=ROOT.parent/'三候选EGFR_2ITW教学双排序_已回对接.json'
dest.write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(json.dumps({'rmsd':round(rmsd,3),'scores':{c['id']:c['docking']['score'] for c in data['candidates']},'output':str(dest)},ensure_ascii=False))
