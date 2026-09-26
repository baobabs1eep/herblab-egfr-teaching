"""Apply a narrow, versioned SwissADME property screen; never assert clinical safety."""
from pathlib import Path
import json

ROOT = Path(__file__).resolve().parent
source = ROOT.parent/'三候选已查热度与ADME_待对接.json'
data = json.loads(source.read_text(encoding='utf-8'))
policy = 'egfr-basic-property-screen-v1'
rows = []
for c in data['candidates']:
    a = c['adme_prediction']
    lipinski = a.get('Lipinski')
    gi = a.get('GI_absorption')
    if lipinski is None or gi is None:
        status = 'unknown'
    elif lipinski == 'Yes; 0 violation' and gi == 'High':
        status = 'pass'
    else:
        status = 'fail'
    rows.append({'id':c['id'],'name':c['name'],'policy':policy,'status':status,'checks':{'Lipinski':lipinski,'GI_absorption':gi},'warnings':{'PAINS':a.get('PAINS'),'CYP1A2_inhibitor':a.get('CYP1A2_inhibitor'),'CYP2D6_inhibitor':a.get('CYP2D6_inhibitor'),'CYP3A4_inhibitor':a.get('CYP3A4_inhibitor')},'source':a['source'],'scope':'Basic predicted properties only; no toxicity or clinical safety decision'})
out = {'version':policy,'definition':'Pass only when SwissADME Lipinski is Yes; 0 violation AND predicted GI absorption is High. Missing inputs -> unknown. Other values -> fail. PAINS/CYP are retained as warnings, not used for binary exclusion.','date':'2026-09-27','candidates':rows,'limitation':'This is a basic property screen, not complete ADMET, toxicity, pharmacokinetics, or safety clearance. It does not override docking validation failure.'}
dest = ROOT/'基础性质预筛_非安全结论.json'
dest.write_text(json.dumps(out,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(json.dumps({'policy':policy,'statuses':{r['id']:r['status'] for r in rows}},ensure_ascii=False))
