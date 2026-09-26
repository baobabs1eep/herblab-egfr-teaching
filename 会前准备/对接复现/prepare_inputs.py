"""从 1M17 与已核验 SMILES 制备教学对接输入，不改动原始文件。"""
from pathlib import Path
from csv import DictReader
import hashlib
import json
import math

from rdkit import Chem, rdBase
from rdkit.Chem import AllChem

ROOT = Path(__file__).resolve().parent
PDB = ROOT / 'input' / '1M17.pdb'
OUT = ROOT / 'prepared'
OUT.mkdir(exist_ok=True)

lines = PDB.read_text(encoding='ascii').splitlines()
protein = [line[:16]+' '+line[17:] for line in lines if line.startswith('ATOM  ') and line[21] == 'A' and line[16] in (' ', 'A')]
aq4 = [line for line in lines if line.startswith('HETATM') and line[17:20] == 'AQ4' and line[21] == 'A']
if len(protein) < 2000 or len(aq4) < 20:
    raise ValueError('1M17 的蛋白链或 AQ4 共晶配体不完整')
(OUT / '1M17_chainA_nohet.pdb').write_text('\n'.join(protein + ['TER', 'END']) + '\n', encoding='ascii')
coords = [[float(line[i:i+8]) for i in (30,38,46)] for line in aq4]
mins = [min(x[d] for x in coords) for d in range(3)]
maxs = [max(x[d] for x in coords) for d in range(3)]
center = [(a+b)/2 for a,b in zip(mins,maxs)]
size = [max(22.0, math.ceil(b-a+10.0)) for a,b in zip(mins,maxs)]
box = {'center':center,'size':size,'source':'1M17 chain A AQ4 co-crystal heavy-atom bounding box + 5 Å per side'}
(OUT / 'box.json').write_text(json.dumps(box,indent=2)+'\n',encoding='utf-8')

csv_file = ROOT.parent / '肺癌EGFR教学候选_首批核验.csv'
records = list(DictReader(csv_file.open(encoding='utf-8-sig',newline='')))
results=[]
for row in records:
    cid=row['candidate_id']; smiles=row['smiles']
    mol=Chem.MolFromSmiles(smiles)
    if mol is None:
        raise ValueError(f'{cid}: invalid SMILES')
    mol=Chem.AddHs(mol)
    code=AllChem.EmbedMolecule(mol,randomSeed=20260926,useRandomCoords=False)
    if code!=0:
        raise ValueError(f'{cid}: RDKit 3D embedding failed')
    code=AllChem.MMFFOptimizeMolecule(mol,maxIters=500)
    if code<0:
        raise ValueError(f'{cid}: MMFF optimization failed')
    mol.SetProp('_Name',f'{cid}_{row["compound_name_en"]}')
    (OUT / f'{cid}.sdf').write_text(Chem.MolToMolBlock(mol)+'\n$$$$\n',encoding='utf-8')
    results.append({'id':cid,'name':row['compound_name_en'],'cid':row['pubchem_cid'],'smiles':smiles,'MMFF_converged':code==0,'input_file':f'{cid}.sdf'})

manifest={'structure':'https://www.rcsb.org/structure/1M17','structure_sha256':hashlib.sha256(PDB.read_bytes()).hexdigest(),'rdkit_version':rdBase.rdkitVersion,'ligand_prep':'CSV SMILES -> neutral H added -> ETKDG one 3D conformer seed 20260926 -> MMFF 500 iterations','protein_prep':'1M17 chain A ATOM records; alternate locations blank or A; waters, AQ4 and other HETATM removed','grid_box':box,'ligands':results}
(OUT / 'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(json.dumps({'protein_atoms':len(protein),'aq4_atoms':len(aq4),'box':box,'ligands':len(results)},ensure_ascii=False))
