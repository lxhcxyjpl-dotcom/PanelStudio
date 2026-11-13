"""Turn reviewed row/column boundaries into publication panel frames and inspection overlays."""
import argparse
from collections import Counter
import csv
import hashlib
import json
from pathlib import Path
import re

import numpy as np
from PIL import Image, ImageDraw
from scipy.fft import dctn

from corpus import make_sheets

KINDS={"p":"plot","d":"diagram","i":"image","b":"blot","m":"mixed","t":"table","u":"uncertain"}
COLORS=["#e00050","#0075ce","#008958","#ab451c","#8629d4","#007c87","#cd7500","#914376"]


def split_rule(s, symbol):
    level=0; parts=[]; cuts=[]; start=0; i=0
    while i<len(s):
        ch=s[i]
        if ch=="(":
            level+=1
        elif ch==")":
            level-=1
        elif ch==symbol and level==0:
            parts.append(s[start:i])
            i+=1
            number=re.match(r"\d+",s[i:])
            cuts.append(int(number[0])/100 if number else None)
            if number:
                i+=len(number[0])
            start=i
            continue
        i+=1
    if level!=0:
        raise ValueError("Unbalanced expression "+s)
    return [*parts,s[start:]], cuts


def cut_line(ink, box, horizontal_axis, fraction):
    x0,y0,x1,y1=box
    block=ink[y0:y1,x0:x1]
    profile=block.mean(axis=0 if horizontal_axis else 1)
    length=len(profile)
    center=round(length*fraction)
    radius=max(1,min(round(.045*length),24))
    lo=max(1,center-radius); hi=min(length-1,center+radius)
    if hi<lo:
        raise ValueError("Empty region in annotation")
    coords=np.arange(lo,hi+1)
    density=np.convolve(profile,[.25,.5,.25],mode="same")
    cost=density[coords]+.03*np.abs(coords-center)/max(radius,1)
    return int(coords[np.argmin(cost)]) + (x0 if horizontal_axis else y0)


def partition(rule, ink, box, cells):
    for symbol in ("/","|"):
        parts,cuts=split_rule(rule,symbol)
        if len(parts)<2:
            continue
        axis=symbol=="|"
        boundaries=[cut_line(ink,box,axis,frac if frac is not None else (i+1)/len(parts))
                    for i,frac in enumerate(cuts)]
        limits=[box[0 if axis else 1],*boundaries,box[2 if axis else 3]]
        if any(b-a<4 for a,b in zip(limits,limits[1:])):
            raise ValueError("Invalid cuts "+rule)
        for p,a,b in zip(parts,limits,limits[1:]):
            rect=(a,box[1],b,box[3]) if axis else (box[0],a,box[2],b)
            partition(p,ink,rect,cells)
        return
    if rule.startswith("(") and rule.endswith(")"):
        return partition(rule[1:-1],ink,box,cells)
    if rule=="_":
        return
    if not re.fullmatch("[A-H]",rule) or rule in cells:
        raise ValueError("Invalid leaf "+rule)
    cells[rule]=list(box)


def content_bounds(ink, cell):
    x0,y0,x1,y1=cell
    ys,xs=np.nonzero(ink[y0:y1,x0:x1])
    if not len(ys):
        raise ValueError("Blank panel")
    return [x0+int(xs.min()),y0+int(ys.min()),x0+int(xs.max())+1,y0+int(ys.max())+1]


def image_hash(image):
    gray=np.asarray(image.convert("L").resize((32,32),Image.Resampling.LANCZOS),dtype=float)
    low=dctn(gray,norm="ortho")[:8,:8].ravel()[1:]
    return format(int("".join("1" if val>np.median(low) else "0" for val in low),2),"016x")


def prepare(row, note, work):
    with Image.open(work/"crops"/(row["id"]+".jpg")) as raw:
        im=raw.convert("RGB")
    if note["roi"]:
        pct=[int(n)/100 for n in note["roi"].split(",")]
        if len(pct)!=4 or not (0<=pct[0]<pct[2]<=1 and 0<=pct[1]<pct[3]<=1):
            raise ValueError("Invalid crop bounds")
        crop=[round(v*(im.width if i%2==0 else im.height)) for i,v in enumerate(pct)]
        im=im.crop(crop)
    # Ignore almost-white JPEG compression residue when finding visible content.
    ink=np.asarray(im).min(axis=2)<221
    outer=content_bounds(ink,[0,0,im.width,im.height])
    rule=re.sub(r"(?<=[A-H_)])(?=[A-H_(])","|",note["layout"])
    cells={}
    partition(rule,ink,outer,cells)
    labels=sorted(cells)
    if labels!=list("ABCDEFGH"[:len(cells)]) or not 2<=len(labels)<=8 or len(note["types"])!=len(labels):
        raise ValueError("Check label sequence and panel types")
    boxes={lbl:content_bounds(ink,cells[lbl]) for lbl in labels}
    kinds={lbl:KINDS[code] for lbl,code in zip(labels,note["types"])}
    (work/"panels").mkdir(exist_ok=True)
    for lbl,rect in boxes.items():
        im.crop(rect).save(work/"panels"/(row["id"]+"-"+lbl+".png"))
    marked=im.copy()
    draw=ImageDraw.Draw(marked)
    for i,lbl in enumerate(labels):
        x,y,r,b=boxes[lbl]
        color=COLORS[i]
        draw.rectangle([x,y,r-1,b-1],outline=color,width=max(2,round(im.width/330)))
        draw.rectangle([x,y,x+17,y+16],fill=color)
        draw.text((x+3,y+1),lbl,fill="white")
    marked.thumbnail((1000,950))
    marked.save(work/"overlays"/(row["id"]+".jpg"),quality=93)
    return dict(id=row["id"],paper=row["paper"],doi=row["doi"],journal=row["journal"],page=row["page"],
                figure=row["fig"],layout=note["layout"],types=kinds,cells=cells,boxes=boxes,
                pHash=image_hash(im.crop(outer)),pixelSize=im.size,method=row["method"],
                imageSHA256=hashlib.sha256((work/"crops"/(row["id"]+".jpg")).read_bytes()).hexdigest())


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("work",type=Path)
    parser.add_argument("review",type=Path)
    args=parser.parse_args(); work=args.work
    source=json.loads((work/"sources.json").read_text(encoding="utf-8"))
    with args.review.open(encoding="utf-8-sig",newline="") as f:
        notes={r["id"]:r for r in csv.DictReader(f,delimiter="\t")}
    if set(notes)-{r["id"] for r in source}:
        raise ValueError("Unknown source ID")
    (work/"overlays").mkdir(exist_ok=True)
    rows=[]; rendered=[]
    for row in source:
        note=notes.get(row["id"])
        if not note or note["layout"]=="-":
            continue
        try:
            record=prepare(row,note,work)
        except ValueError as exc:
            raise ValueError(row["id"]+" "+str(exc)) from exc
        rows.append(record)
        rendered.append(dict(row,cues=list(record["boxes"]),method=note["layout"]))
    (work/"geometry.json").write_text(json.dumps(rows,ensure_ascii=False,indent=1),encoding="utf-8")
    make_sheets(rendered,work/"overlay-sheets",work/"overlays","check",cols=3,per_page=9)
    accepted={r["id"]:set(r["boxes"]) for r in rows}
    for row in source:
        ident=row["id"]
        if not re.fullmatch(r"P\d+F\d+",ident):
            raise ValueError("Unexpected source ID")
        if ident not in accepted:
            (work/"overlays"/(ident+".jpg")).unlink(missing_ok=True)
        for label in set("ABCDEFGH")-accepted.get(ident,set()):
            (work/"panels"/(ident+"-"+label+".png")).unlink(missing_ok=True)
    print(len(rows),"figures,",sum(len(r["boxes"]) for r in rows),"panels,",
          len({r["paper"] for r in rows}),"papers",dict(Counter(len(r["boxes"]) for r in rows)))


if __name__=="__main__":
    main()

