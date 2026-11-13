"""Prepare leak-resistant paper splits, train a CPU panel classifier and extract caption links."""
import argparse
from collections import Counter, defaultdict
import hashlib
import json
from pathlib import Path
import re

import numpy as np
from PIL import Image
from sklearn.ensemble import ExtraTreesClassifier
from sklearn.metrics import confusion_matrix

SPLIT_SEED="panelstudio-layout-partition-v1"
CLASSES=["blot","diagram","image","mixed","plot","table"]
GROUP=re.compile(r"\(([A-H])\s*(?:,|and|&)\s*([A-H])\)",re.I)
START=re.compile(r"(?:^|[.!?]\s+)(?:(?:\(([a-h])\))|([A-H])\.)\s+")
REF=re.compile(r"\b(?:from|shown in|images? in|data in)\s+(?:panels?\s+)?\(([a-h])\)",re.I)


def read(work,name):
    return json.loads((work/name).read_text(encoding="utf-8"))


def save(work,name,obj):
    (work/name).write_text(json.dumps(obj,ensure_ascii=False,indent=1),encoding="utf-8")


def split_papers(figures):
    keys={r["paper"]:r["paper"] for r in figures}
    def root(v):
        while keys[v]!=v:
            v=keys[v]
        return v
    def merge(a,b):
        a,b=sorted((root(a),root(b)))
        keys[b]=a
    matches=[]
    for i,a in enumerate(figures):
        for b in figures[:i]:
            if a["paper"]==b["paper"]:
                continue
            d=(int(a["pHash"],16)^int(b["pHash"],16)).bit_count()
            if d<=6 or (a["doi"] and a["doi"]==b["doi"]) or a["imageSHA256"]==b["imageSHA256"]:
                merge(a["paper"],b["paper"])
                matches.append([a["id"],b["id"],d])
    # Exclude preprints from the publication benchmark. Any linked cluster follows it.
    external={root(r["paper"]) for r in figures if re.search("preprint|rxiv",r["journal"],re.I)}
    groups=sorted({root(k) for k in keys}-external,key=lambda k:hashlib.sha256((SPLIT_SEED+k).encode()).digest())
    nt=round(.65*len(groups)); nv=round(.15*len(groups))
    roles={g:("train" if i<nt else "validation" if i<nt+nv else "test") for i,g in enumerate(groups)}
    roles.update({g:"preprint" for g in external})
    return {p:dict(group=root(p),split=roles[root(p)]) for p in sorted(keys)},matches


def visual_features(path):
    with Image.open(path) as im:
        thumb=im.convert("RGB").resize((96,96),Image.Resampling.BILINEAR)
    rgb=np.asarray(thumb,dtype=np.float32)/255
    # Mask the usual outer panel-letter corner. Features have no source position/area.
    rgb[:12,:13,:]=1
    gray=rgb.mean(axis=2); color=rgb.max(axis=2)-rgb.min(axis=2)
    gx=np.abs(np.diff(gray,axis=1,append=gray[:,-1:]))
    gy=np.abs(np.diff(gray,axis=0,append=gray[-1:,:]))
    features=[]
    for x in (gray,color,gx,gy):
        features.extend(np.histogram(x,bins=8,range=(0,1))[0]/x.size)
        for patch in [x, *[x[y:y+48,z:z+48] for y in (0,48) for z in (0,48)]]:
            features.extend([patch.mean(),patch.std(),np.quantile(patch,.9)])
    for mask in (gray<.24, gray<.75, color>.12):
        for proj in (mask.mean(axis=0),mask.mean(axis=1)):
            features.extend((proj.std(), np.max(proj), np.mean(proj>.70)))
    return np.array(features)


def caption_pairs(caption, labels):
    found={}
    for m in GROUP.finditer(caption):
        if m[0].upper()=="(H&E)":
            continue  # Histology stain abbreviation.
        key="".join(sorted((m[1].upper(),m[2].upper())))
        if key[0]!=key[1] and set(key)<=set(labels):
            found[key]="same-caption-clause"
    marks=list(START.finditer(caption))
    for i,m in enumerate(marks):
        owner=(m[1] or m[2]).upper()
        phrase=caption[m.end():marks[i+1].start() if i+1<len(marks) else len(caption)]
        # Restrict to quantitative statements and explicit cross-references.
        for sentence in re.split(r"(?<=[.!?])\s+",phrase):
            if not re.search(r"quantif|quantitat|densitometr",sentence,re.I):
                continue
            for ref in REF.finditer(sentence):
                other=ref[1].upper()
                if other!=owner and {owner,other}<=set(labels):
                    found["".join(sorted((owner,other)))]="explicit-quantification"
    return found


def main(work, fixed_split=None, panel_root=None):
    figs=read(work,"geometry.json")
    sources={r["id"]:r for r in read(work,"sources.json")}
    if fixed_split is None:
        papers,duplicates=split_papers(figs)
    else:
        papers,duplicates=fixed_split,[]
    save(work,"split.json",dict(papers=papers,duplicateCandidates=duplicates,seed=SPLIT_SEED))
    panels=[(r,label) for r in figs for label in sorted(r["boxes"])]
    panel_root=panel_root or (work/"panels")
    X=np.array([visual_features(panel_root/(r["id"]+"-"+l+".png")) for r,l in panels])
    y=np.array([r["types"][l] for r,l in panels])
    group=np.array([papers[r["paper"]]["group"] for r,_ in panels])
    split=np.array([papers[r["paper"]]["split"] for r,_ in panels])
    train=split=="train"
    if set(y)-set(CLASSES):
        raise ValueError("Unknown panel type")
    def classifier(mask):
        if not mask.any():
            raise ValueError("No training observations")
        # Each paper has equal total weight.
        counts=Counter(group[mask])
        weights=[1/counts[g] for g in group[mask]]
        return ExtraTreesClassifier(n_estimators=80,min_samples_leaf=2,max_features=.7,
                                    random_state=17,n_jobs=1).fit(X[mask],y[mask],sample_weight=weights)
    def predict(forest,mask):
        probabilities=forest.predict_proba(X[mask])
        for j,c in enumerate(forest.classes_):
            post[mask,CLASSES.index(c)]=probabilities[:,j]
    post=np.zeros((len(X),len(CLASSES)))
    for g in sorted(set(group[train])):
        targets=group==g
        predict(classifier(train & ~targets),targets)
    forest=classifier(train)
    predict(forest,~train)
    from joblib import dump
    dump(forest,work/"panel-classifier.joblib",compress=3)
    pred=np.array(CLASSES)[post.argmax(axis=1)]
    typed=defaultdict(dict)
    for idx,(r,l) in enumerate(panels):
        typed[r["id"]][l]=post[idx].round(5).tolist()
    descriptors=[]
    for r in figs:
        labels=sorted(r["boxes"])
        aspects=[]
        for l in labels:
            x,y0,x1,y1=r["boxes"][l]
            aspects.append((x1-x)/(y1-y0))
        descriptors.append(dict(id=r["id"],paper=r["paper"],**papers[r["paper"]],aspects=aspects,
                                posteriors=[typed[r["id"]][l] for l in labels],
                                pairs=caption_pairs(sources[r["id"]]["caption"],labels)))
    save(work,"inputs.json",descriptors)
    majority=Counter(y[train]).most_common(1)[0][0]
    stats={}
    for name in ("train","validation","test","preprint"):
        mask=split==name
        if mask.any():
            stats[name]=dict(panels=int(mask.sum()),accuracy=float(np.mean(pred[mask]==y[mask])),
                             majorityAccuracy=float(np.mean(y[mask]==majority)),
                             confusion=confusion_matrix(y[mask],pred[mask],labels=CLASSES).tolist())
    save(work,"classifier-results.json",dict(classes=CLASSES,majority=majority,results=stats))
    print(Counter(v["split"] for v in papers.values()),"papers;",Counter(v["split"] for v in descriptors),"figures")
    print("cross-paper duplicate alerts",len(duplicates),"caption links",sum(len(v["pairs"]) for v in descriptors))

if __name__=="__main__":
    ap=argparse.ArgumentParser(description=__doc__)
    ap.add_argument("work",type=Path)
    main(ap.parse_args().work)

