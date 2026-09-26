"""Prepare a second, independent EGFR redocking check from RCSB 4I22."""
from pathlib import Path
import hashlib
import json
import math

from rdkit import Chem
from rdkit.Chem import AllChem

ROOT = Path(__file__).resolve().parent
PDB = ROOT / 'input' / '4I22.pdb'
OUT = ROOT / 'prepared_4I22'
OUT.mkdir(exist_ok=True)
lines = PDB.read_text(encoding='ascii').splitlines()
protein = [x[:16] + ' ' + x[17:] for x in lines if x.startswith('ATOM  ') and x[21] == 'A' and x[16] in (' ', 'A')]
ire = [x for x in lines if x.startswith('HETATM') and x[17:20] == 'IRE' and x[21] == 'A']
if len(protein) < 2000 or len(ire) != 31:
    raise ValueError(f'Unexpected 4I22 chain A or IRE atom count: {len(protein)}, {len(ire)}')
(OUT / '4I22_chainA_nohet.pdb').write_text('\n'.join(protein + ['TER', 'END']) + '\n', encoding='ascii')
coords = [[float(x[i:i+8]) for i in (30,38,46)] for x in ire]
mins = [min(x[d] for x in coords) for d in range(3)]
maxs = [max(x[d] for x in coords) for d in range(3)]
center = [(a+b)/2 for a,b in zip(mins,maxs)]
size = [max(22.0, math.ceil(b-a+10.0)) for a,b in zip(mins,maxs)]
box = {'center':center,'size':size,'source':'4I22 chain A IRE co-crystal heavy-atom bounding box + 5 Å per side'}
(OUT / 'box.json').write_text(json.dumps(box,indent=2)+'\n',encoding='utf-8')
serials = {int(x[6:11]) for x in ire}
connect = []
for x in lines:
    if not x.startswith('CONECT'):
        continue
    atoms = [int(x[i:i+5]) for i in range(6,len(x),5) if x[i:i+5].strip().isdigit()]
    if atoms and atoms[0] in serials:
        connect.append(x)
mol = Chem.MolFromPDBBlock('\n'.join(ire+connect+['END'])+'\n',sanitize=False,removeHs=False,proximityBonding=False)
if mol is None or mol.GetNumAtoms() != 31:
    raise ValueError('IRE coordinate parsing failed')
template = Chem.MolFromSmiles('COc1cc2ncnc(Nc3ccc(F)c(Cl)c3)c2cc1OCCCN4CCOCC4')
mol = AllChem.AssignBondOrdersFromTemplate(template,mol)
mol = Chem.AddHs(mol,addCoords=True)
mol.SetProp('_Name','IRE_gefitinib_native_4I22')
(OUT/'IRE_native.sdf').write_text(Chem.MolToMolBlock(mol)+'\n$$$$\n',encoding='utf-8')
manifest = {'structure':'https://www.rcsb.org/structure/4I22','sha256':hashlib.sha256(PDB.read_bytes()).hexdigest(),'target':'EGFR L858R/T790M/V948R chain A, co-crystal IRE (gefitinib)','caveat':'V948R is a crystallization-associated mutation; not a patient-specific target','box':box,'protein_atoms':len(protein),'ire_heavy_atoms':len(ire)}
(OUT/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(json.dumps(manifest,ensure_ascii=False))
