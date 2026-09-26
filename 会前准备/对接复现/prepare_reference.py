"""用 1M17 中厄洛替尼 AQ4 的实测坐标准备回放对照分子。"""
from pathlib import Path
from rdkit import Chem
from rdkit.Chem import AllChem

root=Path(__file__).resolve().parent
lines=(root/'input'/'1M17.pdb').read_text(encoding='ascii').splitlines()
ligand=[x for x in lines if x.startswith('HETATM') and x[17:20]=='AQ4' and x[21]=='A']
serials={int(x[6:11]) for x in ligand}
connect=[]
for x in lines:
    if not x.startswith('CONECT'):continue
    atoms=[int(x[i:i+5]) for i in range(6,len(x),5) if x[i:i+5].strip().isdigit()]
    if atoms and atoms[0] in serials:
        connect.append(x)
block='\n'.join(ligand+connect+['END'])+'\n'
mol=Chem.MolFromPDBBlock(block,sanitize=False,removeHs=False,proximityBonding=False)
if mol is None or mol.GetNumAtoms()!=29:
    raise ValueError('AQ4 coordinate parsing failed')
template=Chem.MolFromSmiles('COCCOc1cc2ncnc(Nc3cccc(c3)C#C)c2cc1OCCOC')
mol=AllChem.AssignBondOrdersFromTemplate(template,mol)
mol=Chem.AddHs(mol,addCoords=True)
mol.SetProp('_Name','AQ4_erlotinib_native_1M17')
(root/'prepared'/'AQ4_native.sdf').write_text(Chem.MolToMolBlock(mol)+'\n$$$$\n',encoding='utf-8')
print('AQ4 heavy atoms:',len(ligand),'RDKit atoms with H:',mol.GetNumAtoms())
