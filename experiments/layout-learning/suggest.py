"""Suggest editable layouts for 2–8 independent local panel images using the fitted pilot."""
import argparse
import json
from pathlib import Path
import re
import subprocess

from joblib import load
import numpy as np
from PIL import Image,ImageOps

from blind import render, svg
from content import CLASSES, caption_pairs, read, save, visual_features
from rank import build_sample, normalized, scores

BRIEF_TYPES={"diagram":r"流程|设计|机制|示意|workflow|schematic|design",
             "plot":r"定量|组间差异|统计|quantitat|statistic",
             "image":r"显微|形态|microscop|morpholog"}


def main(work,manifest,output):
    spec=json.loads(manifest.read_text(encoding="utf-8-sig"))
    panels=spec["panels"]
    if not isinstance(panels,list) or not 2<=len(panels)<=8:
        raise ValueError("The layout pilot accepts 2–8 panel images")
    labels=list("ABCDEFGH"[:len(panels)])
    focus=spec.get("focus"); pair=spec.get("pair")
    if focus is not None and focus not in labels:
        raise ValueError("Unknown focus label")
    if pair is not None and (not isinstance(pair,list) or len(pair)!=2 or pair[0]==pair[1] or not set(pair)<=set(labels)):
        raise ValueError("Pair must name two different input panels")
    equal_height=spec.get("equalHeight",False)
    if type(equal_height) is not bool or (equal_height and not pair):
        raise ValueError("equalHeight requires a comparison pair")
    if output.exists() and any(output.iterdir()):
        raise ValueError("Choose an empty output directory for the new manuscript")
    paths=[(manifest.parent/r["file"]).resolve(strict=True) for r in panels]
    (output/"panels").mkdir(parents=True,exist_ok=True)
    ident="manuscript"; features=[]; aspects=[]
    for label,path in zip(labels,paths):
        dest=output/"panels"/(ident+"-"+label+".png")
        with Image.open(path) as raw:
            img=ImageOps.exif_transpose(raw).convert("RGBA")
            flattened=Image.new("RGB",img.size,"white")
            flattened.paste(img,mask=img.getchannel("A"))
            flattened.save(dest)
            aspects.append(img.width/img.height)
        features.append(visual_features(dest))
    classifier=load(work/"panel-classifier.joblib")
    measured=classifier.predict_proba(features)
    proba=np.zeros((len(labels),len(CLASSES)))
    for i,cls in enumerate(classifier.classes_):
        proba[:,CLASSES.index(cls)]=measured[:,i]
    why="作者指定" if focus else "无明确主图"
    if not focus:
        targets=[kind for kind,pattern in BRIEF_TYPES.items() if re.search(pattern,spec.get("brief",""),re.I)]
        if len(targets)==1:
            kind=targets[0]
            # A panel-level text description is evidence independent of published size or position.
            evidence=proba[:,CLASSES.index(kind)].copy()
            for i,panel in enumerate(panels):
                if re.search(BRIEF_TYPES[kind],panel.get("caption",""),re.I):
                    evidence[i]+=.85
            ranking=np.argsort(-evidence,kind="stable")
            if evidence[ranking[0]]>=.55 and evidence[ranking[0]]-evidence[ranking[1]]>=.15:
                focus=labels[ranking[0]]; why="写作目标与子图说明、图型匹配"
    links=caption_pairs(spec.get("caption",""),labels)
    if pair:
        links["".join(sorted(pair))]="author"
    d=dict(id=ident,group="user-input",paper="user-input",split="manuscript",aspects=aspects,
           posteriors=proba.round(5).tolist(),pairs=links)
    if focus or pair:
        d["intent"]={k:v for k,v in {"focus":focus,"pair":pair,"equalHeight":equal_height}.items() if v}
    save(output,"inputs.json",[d])
    subprocess.run(["node",str(Path(__file__).with_name("candidates.mjs")),str(work.resolve()),str(output.resolve())],check=True)
    pool=read(output,"candidates.json")[0]
    eligible=pool.get("requestedIndices",list(range(len(pool["candidates"]))))
    first=bool(focus and re.search(r"先|首先|\bfirst\b|\bstart\b",spec.get("brief",""),re.I))
    focal_index=labels.index(focus) if focus else None
    if first:
        def begins_reading(i):
            boxes=np.asarray(pool["candidates"][i]["boxes"])
            x,y,_,bottom=boxes[focal_index]
            if y>boxes[:,1].min()+1.:
                return False
            for left,top,_,end in boxes:
                shared=min(bottom,end)-max(y,top)
                if shared>=.45*min(bottom-y,end-top) and left<x-1.:
                    return False
            return True
        eligible=[i for i in eligible if begins_reading(i)]
    if not eligible:
        save(output,"suggestion.json",dict(status="no-fit",focus=focus,reason=why,pair=pair,first=first))
        print("没有同时满足当前主图、配对和尺寸要求的候选。")
        return
    library=read(work,"inputs.json"); geom={r["id"]:r for r in read(work,"geometry.json")}
    refs=[(r,normalized([geom[r["id"]]["boxes"][l] for l in sorted(geom[r["id"]]["boxes"])]))
          for r in library if r["split"]=="train"]
    sample=build_sample(d,pool,None,refs)
    rank=scores(sample,read(work,"ranker.json")["models"]["content"])
    # Publication IoU normalizes occupied widths. On a real manuscript also reward using
    # the actual column width so that a vertically stacked thumbnail strip cannot win by shape alone.
    for i in eligible:
        candidate=pool["candidates"][i]
        boxes=np.asarray(candidate["boxes"])
        areas=(boxes[:,2:]-boxes[:,:2]).prod(axis=1)
        width,height=candidate["canvas"]
        occupied=(boxes[:,2].max()-boxes[:,0].min())/width
        fill=areas.sum()/(width*height)
        rank[i]+=2.*np.log(occupied)+np.log(fill)
        if focus:
            # Mild visual emphasis in the new-manuscript workflow.
            ratio=areas[focal_index]/np.mean(np.delete(areas,focal_index))
            rank[i]-=2.*abs(np.log(ratio/1.6))
    ordered=sorted(eligible,key=lambda i:-rank[i])
    chosen=[]
    for i in ordered:
        boxes=normalized(pool["candidates"][i]["boxes"])
        if any(np.max(abs(boxes-other))<.04 for _,other in chosen):
            continue
        chosen.append((i,boxes))
        if len(chosen)==3:
            break
    for n,(i,_) in enumerate(chosen,1):
        c=pool["candidates"][i]
        svg(output,ident,c,output/f"layout-{n}.svg")
        render(output,ident,c,output/f"layout-{n}.webp")
    save(output,"suggestion.json",dict(status="ok",focus=focus,reason=why,pair=pair,first=first,
         predictedTypes={l:CLASSES[int(np.argmax(p))] for l,p in zip(labels,proba)},eligible=len(eligible),
         selected=[i for i,_ in chosen]))
    print("主图",focus or "并列","依据",why,"方案",len(chosen))

if __name__=="__main__":
    ap=argparse.ArgumentParser(description=__doc__)
    ap.add_argument("work",type=Path);ap.add_argument("manifest",type=Path);ap.add_argument("output",type=Path)
    args=ap.parse_args()
    main(args.work,args.manifest,args.output)

