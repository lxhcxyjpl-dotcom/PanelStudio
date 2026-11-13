"""Find and render compound-figure candidates from a local Zotero RDF export."""
import argparse
from collections import Counter, defaultdict
import hashlib
import json
from pathlib import Path
import re
import unicodedata
from urllib.parse import unquote
import xml.etree.ElementTree as ET

import pymupdf
from PIL import Image, ImageDraw

SEED = "panelstudio-layout-study-01"
HEAD = re.compile(r"^(?:fig(?:ure)?\.?\s*|图\s*)(\d{1,2})(?![\da-z])(?=[\s.|:：—–\-)]|$)", re.I)
BODY = re.compile(r"^(?:shows?|illustrates?|depicts?|demonstrates?|summari[sz]es?|is|was|also|and|in|of|can|we)\b", re.I)
GROUP = re.compile(r"\(([a-l](?:\s*(?:[-–—,，/&]|\band\b)\s*[a-l])*)\)", re.I)
MARK = re.compile(r"(?:^|[.;:]\s*)\(?([A-Ha-h])\)?[,.:]\s+(?=[A-Z])")


def stable(value):
    return hashlib.sha256((SEED + "|" + value).encode()).hexdigest()


def clean(text):
    return " ".join(unicodedata.normalize("NFKC", text).replace("\u00ad", "").split())


def field(element, name):
    return next((c for c in element if c.tag.rsplit("}", 1)[-1] == name), None)


def field_text(element, name):
    child = field(element, name)
    return (child.text or "").strip() if child is not None else ""


def read_papers(rdf):
    root = ET.parse(rdf).getroot()
    attachments = {}
    for row in root:
        if row.tag.rsplit("}", 1)[-1] != "Attachment":
            continue
        item = field(row, "path")
        if item is not None:
            path = rdf.parent / unquote(next(iter(item.attrib.values())))
            if path.suffix.lower() == ".pdf":
                attachments[next(iter(row.attrib.values()))] = path
    by_journal = defaultdict(list)
    seen = set()
    for row in root:
        if row.tag.rsplit("}", 1)[-1] != "Article":
            continue
        links = [attachments[key] for c in row if c.tag.endswith("}link")
                 for key in c.attrib.values() if key in attachments]
        if len(links) != 1:
            continue
        pmid = field_text(row, "PMID") or next(iter(row.attrib.values()))
        doi = field_text(row, "DOI").lower()
        if not doi:
            for el in row.iter():
                if el.tag.rsplit("}",1)[-1] not in ("identifier","value"):
                    continue
                m = re.fullmatch(r"(?:doi\s*:?\s*|https?://(?:dx\.)?doi\.org/)?(10\.\d{4,9}/\S+)", (el.text or "").strip(), re.I)
                if m:
                    doi=m[1].lower()
                    break
        identity = doi or pmid
        if identity in seen:
            continue
        seen.add(identity)
        parent = field(row, "isPartOf")
        journal = field_text(parent[0], "title") if parent is not None and len(parent) else ""
        by_journal[journal or "unknown"].append(dict(paper=pmid, doi=doi, journal=journal or "unknown",
                                                     source=str(links[0])))
    groups = sorted(by_journal.values(), key=lambda group: (-len(group), stable(group[0]["journal"])))
    for g in groups:
        g.sort(key=lambda row: stable(row["paper"]))
    for i in range(max(map(len, groups))):
        for g in groups:
            if i < len(g):
                yield g[i]


def explicit_letters(s):
    letters = set()
    for g in GROUP.finditer(s):
        seq = re.findall(r"\b[a-l]\b", g[1], re.I)
        letters.update(v.upper() for v in seq)
        intervals = re.findall(r"([a-l])\s*[-–—]\s*([a-l])", g[1].lower())
        for a, b in intervals:
            letters.update(chr(i).upper() for i in range(ord(a), ord(b) + 1))
    letters.update(v.upper() for v in MARK.findall(s))
    return sorted(letters)


def page_hits(page):
    raw = page.get_text("dict", flags=pymupdf.TEXTFLAGS_DICT & ~pymupdf.TEXT_PRESERVE_IMAGES)
    blocks = []
    for block in raw["blocks"]:
        if block.get("type") != 0:
            continue
        lines = [(clean("".join(s["text"] for s in l["spans"])), l["bbox"]) for l in block["lines"]]
        lines = [l for l in lines if l[0]]
        if lines:
            blocks.append((lines, block["bbox"]))
    images = None
    for bi, (lines, box) in enumerate(blocks):
        for idx, (lead, rect) in enumerate(lines):
            following = [t for t, _ in lines[idx+1:]]
            if lead.lower() in ("figure", "fig.", "fig") and following:
                lead += " " + following.pop(0)
            match = HEAD.match(lead)
            if not match:
                continue
            tail = lead[match.end():].lstrip()
            if tail.startswith((",", ";", ")")) or BODY.match(tail):
                continue
            caption = " ".join([lead, *following])
            end = box[3]
            for more, nb in blocks[bi+1:bi+5]:
                if not (-3 <= nb[1] - end <= 10 and abs(nb[0] - box[0]) <= 18):
                    break
                if HEAD.match(more[0][0]):
                    break
                caption += " " + " ".join(t for t, _ in more)
                end = nb[3]
            caption = clean(caption)[:3200]
            letters = explicit_letters(caption)
            if not (2 <= len(letters) <= 8 and letters[0]=="A" and max(letters)<="H"):
                continue
            if images is None:
                images = [i["bbox"] for i in page.get_image_info()]
            x, y, r, b = rect
            width, height = page.rect.width, page.rect.height
            neighbors = []
            for xx, yy, rr, bb in images:
                area = (rr-xx)*(bb-yy)
                if area < .035*width*height or area > .95*width*height:
                    continue
                overlap = min(r,rr)-max(x,xx)
                if overlap < .30*min(r-x,rr-xx):
                    continue
                distance = y-bb
                if -5 <= distance <= 32:
                    neighbors.append((max(distance,0) - min(area/(width*height), .8)*3, (xx,yy,rr,bb)))
            if neighbors:
                crop = min(neighbors)[1]
                method = "embedded-region"
            else:
                # Recompose vector and multi-object illustrations from the page.
                full = box[2]-box[0] > width*.53
                left = max(page.rect.x0, min(x, box[0])-5)
                right = min(width-10, max(r,box[2])+6)
                if full:
                    right = max(right, width-left)
                else:
                    right = max(right, min(width-12, left+.43*width))
                prior = [br[3] for ls,br in blocks if br[3] < y-10 and br[3] > 25
                         and min(right,br[2])-max(left,br[0]) > (right-left)*.35
                         and len(" ".join(t for t,_ in ls)) > 170]
                top = max(prior, default=35)+3
                if y - top < 42:
                    continue
                crop = (left,top,right,y-1)
                method = "page-region"
            crop = tuple(pymupdf.Rect(crop) & page.rect)
            if (crop[2]-crop[0])<35 or (crop[3]-crop[1])<28:
                continue
            yield dict(fig=int(match[1]), page=page.number+1, caption=caption, cues=letters, region=crop,
                       captionRect=rect, method=method)


def save_crop(doc, hit, path):
    page = doc[hit["page"]-1]
    clip = pymupdf.Rect(hit["region"])
    scale = min(2.4, 1280/max(clip.width,clip.height))
    pix = page.get_pixmap(matrix=pymupdf.Matrix(scale,scale), clip=clip, alpha=False)
    im = Image.frombytes("RGB", (pix.width,pix.height), pix.samples)
    im.save(path, quality=93, subsampling=0)
    return im.size


def make_sheets(rows, directory, source_dir, prefix="screen", cols=3, per_page=9):
    directory.mkdir(exist_ok=True, parents=True)
    written=set()
    for start in range(0,len(rows),per_page):
        canvas = Image.new("RGB",(cols*360,((per_page+cols-1)//cols)*305),"#e8e5dd")
        pen = ImageDraw.Draw(canvas)
        for k,r in enumerate(rows[start:start+per_page]):
            x,y = k%cols*360,k//cols*305
            with Image.open(source_dir/(r["id"]+".jpg")) as im:
                im.thumbnail((352,276))
                canvas.paste(im,(x+(360-im.width)//2,y+24+(278-im.height)//2))
            pen.text((x+6,y+5),r["id"]+"   "+"".join(r["cues"])+"  "+r["method"],fill="#161312")
        target=directory/f"{prefix}-{start//per_page+1:02}.jpg"
        canvas.save(target,quality=90)
        written.add(target)
    for old in directory.glob(f"{prefix}-*.jpg"):
        if re.fullmatch(re.escape(prefix)+r"-\d+\.jpg",old.name) and old not in written:
            old.unlink()


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("rdf",type=Path)
    parser.add_argument("output",type=Path)
    parser.add_argument("--papers",type=int,default=50)
    parser.add_argument("--per-paper",type=int,default=3)
    opts=parser.parse_args()
    work=opts.output
    (work/"crops").mkdir(parents=True,exist_ok=True)
    kept=[]; screened=[]; good_papers=0
    for record in read_papers(opts.rdf):
        best={}
        with pymupdf.open(record["source"]) as doc:
            for page in doc:
                for hit in page_hits(page):
                    n=hit["fig"]
                    quality=(hit["method"]=="embedded-region",len(hit["cues"]),len(hit["caption"]))
                    if n not in best or quality>best[n][0]:
                        best[n]=(quality,hit)
            screened.append(dict(paper=record["paper"],journal=record["journal"],candidates=len(best)))
            if len(best)<2:
                continue
            good_papers+=1
            # Prefer distinct sizes, good source regions and reproducible choices within strata.
            choices=sorted((h for _,h in best.values()), key=lambda h: (
                h["method"]!="embedded-region", stable(record["paper"]+"-"+str(h["fig"]))))
            selected=[]
            for h in choices:
                if len(selected)<opts.per_paper and len(h["cues"]) not in [len(v["cues"]) for v in selected]:
                    selected.append(h)
            for h in choices:
                if len(selected)>=opts.per_paper:
                    break
                if h not in selected:
                    selected.append(h)
            for h in sorted(selected,key=lambda row:row["fig"]):
                ident=f"P{good_papers:02}F{h['fig']:02}"
                size=save_crop(doc,h,work/"crops"/(ident+".jpg"))
                kept.append({**record,**h,"id":ident,"size":size})
        if good_papers>=opts.papers:
            break
    (work/"screened.json").write_text(json.dumps(screened,ensure_ascii=False),encoding="utf-8")
    (work/"sources.json").write_text(json.dumps(kept,ensure_ascii=False),encoding="utf-8")
    make_sheets(kept,work/"sheets",work/"crops")
    print(len(kept),"figure candidates in",good_papers,"papers from",len(screened),"screened;",
          dict(Counter(r["method"] for r in kept)),flush=True)

if __name__=="__main__":
    main()

