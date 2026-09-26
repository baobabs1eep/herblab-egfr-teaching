"""Prepare 2ITW EGFR WT with the relatively rigid co-crystal AFN941/ITQ for QC."""
from pathlib import Path
import hashlib,json,math
from rdkit import Chem
from rdkit.Chem import AllChem

ROOT=Path(__file__).resolve().parent
PDB=ROOT/'input'/'2ITW.pdb'
OUT=ROOT/'prepared_2ITW'
OUT.mkdir(exist_ok=True)
lines=PDB.read_text(encoding='ascii').splitlines()
protein=[x[:16]+' '+x[17:] for x in lines if x.startswith('ATOM  ') and x[21]=='A' and x[16] in (' ','A')]
ligand=[x for x in lines if x.startswith('HETATM') and x[17:20]=='ITQ' and x[21]=='A']
if len(protein)<2000 or len(ligand)!=35:
    raise ValueError(f'Unexpected 2ITW atom counts: protein={len(protein)}, ITQ={len(ligand)}')
(OUT/'2ITW_chainA_nohet.pdb').write_text('\n'.join(protein+['TER','END'])+'\n',encoding='ascii')
coords=[[float(x[i:i+8]) for i in (30,38,46)] for x in ligand]
mins=[min(x[d] for x in coords) for d in range(3)]
maxs=[max(x[d] for x in coords) for d in range(3)]
center=[(a+b)/2 for a,b in zip(mins,maxs)]
size=[max(22.0,math.ceil(b-a+10)) for a,b in zip(mins,maxs)]
box={'center':center,'size':size,'source':'2ITW chain A ITQ co-crystal heavy-atom bbox + 5 Å each side'}
(OUT/'box.json').write_text(json.dumps(box,indent=2)+'\n',encoding='utf-8')
serials={int(x[6:11]) for x in ligand}
connect=[]
for x in lines:
    if x.startswith('CONECT'):
        atoms=[int(x[i:i+5]) for i in range(6,len(x),5) if x[i:i+5].strip().isdigit()]
        if atoms and atoms[0] in serials:
            connect.append(x)
mol=Chem.MolFromPDBBlock('\n'.join(ligand+connect+['END'])+'\n',sanitize=False,removeHs=False,proximityBonding=False)
if mol is None or mol.GetNumAtoms()!=35:
    raise ValueError('ITQ coordinate parsing failed')
template=Chem.MolFromSmiles('C[C@@]12[C@@H]([C@@H](CC(O1)n3c4c(c5c3c6n2c7ccccc7c6c8c5C(=O)N=C8)CCCC4)NC)OC')
mol=AllChem.AssignBondOrdersFromTemplate(template,mol)
mol=Chem.AddHs(mol,addCoords=True)
mol.SetProp('_Name','ITQ_AFN941_native_2ITW')
(OUT/'ITQ_native.sdf').write_text(Chem.MolToMolBlock(mol)+'\n$$$$\n',encoding='utf-8')
manifest={'structure':'https://www.rcsb.org/structure/2ITW','sha256':hashlib.sha256(PDB.read_bytes()).hexdigest(),'target':'EGFR WT chain A co-crystal ITQ/AFN941','box':box,'protein_atoms':len(protein),'ligand_atoms':len(ligand),'ligand_smiles_source':'https://www.rcsb.org/ligand/ITQ'}
(OUT/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(json.dumps(manifest,ensure_ascii=False))
