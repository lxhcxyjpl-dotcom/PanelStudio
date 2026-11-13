"""Create an offline blind ballot from all differing held-out recommendations."""
import argparse
from base64 import b64encode
from collections import Counter
import hashlib
from io import BytesIO
import json
from pathlib import Path
import random
from xml.etree import ElementTree as ET

from PIL import Image
import pymupdf

from content import read, save

VERSION="panelstudio-layout-01"


def render(work,figure,candidate,filename,pixels_per_mm=6):
    w,h=candidate["canvas"]
    image=Image.new("RGB",(round(w*pixels_per_mm),round(h*pixels_per_mm)),"white")
    for i,(x,y,r,b) in enumerate(candidate["boxes"]):
        with Image.open(work/"panels"/(figure+"-"+chr(65+i)+".png")) as im:
            size=(max(1,round((r-x)*pixels_per_mm)),max(1,round((b-y)*pixels_per_mm)))
            image.paste(im.resize(size,Image.Resampling.LANCZOS),(round(x*pixels_per_mm),round(y*pixels_per_mm)))
    image.save(filename,"WEBP",quality=96,method=4)


def svg(work,figure,candidate,dest):
    ns="http://www.w3.org/2000/svg"; xl="http://www.w3.org/1999/xlink"
    ET.register_namespace("",ns); ET.register_namespace("xlink",xl)
    w,h=candidate["canvas"]
    root=ET.Element("{"+ns+"}svg",width=f"{w:.5f}mm",height=f"{h:.5f}mm",viewBox=f"0 0 {w:.5f} {h:.5f}",version="1.1")
    for i,(x,y,r,b) in enumerate(candidate["boxes"]):
        label=chr(65+i)
        group=ET.SubElement(root,"{"+ns+"}g",id="panel-"+label)
        raw=(work/"panels"/(figure+"-"+label+".png")).read_bytes()
        ET.SubElement(group,"{"+ns+"}image",x=f"{x:.6f}",y=f"{y:.6f}",width=f"{r-x:.6f}",height=f"{b-y:.6f}",
                      attrib={"{"+xl+"}href":"data:image/png;base64,"+b64encode(raw).decode("ascii")})
    ET.ElementTree(root).write(dest,encoding="utf-8",xml_declaration=True)


def question_html(media, question, number, total):
    figures = []
    for side in ("A", "B"):
        path = media / f"{question}-{side}.webp"
        with Image.open(path) as picture:
            width, height = picture.size
        data = b64encode(path.read_bytes()).decode("ascii")
        figures.append(
            f'<figure><figcaption>方案 {side}</figcaption>'
            f'<img class="art" data-side="{side}" alt="第 {number} 组，方案 {side}" '
            f'width="{width}" height="{height}" src="data:image/webp;base64,{data}"></figure>'
        )
    choices = (("A", "选 A"), ("B", "选 B"), ("tie", "一样合适"), ("neither", "都不采用"))
    options = "".join(
        f'<label class="choice"><input type="radio" name="{question}" value="{value}">{label}</label>'
        for value, label in choices
    )
    return (
        f'<section class="case" data-question="{question}" aria-labelledby="heading-{question}">'
        f'<h2 id="heading-{question}" tabindex="-1">第 {number} 组 / 共 {total} 组</h2>'
        f'<div class="pair">{"".join(figures)}</div>'
        f'<fieldset class="answers"><legend class="sr-only">第 {number} 组的选择</legend>{options}</fieldset>'
        '</section>'
    )


def printable_ballot(directory, prompts):
    media = directory / "media"
    font_file = Path(__file__).resolve().parents[2] / "fonts" / "NotoSansSC-Regular.ttf"
    font_name = "BallotSans"
    page_width, page_height = pymupdf.paper_size("a4-l")
    margin, gap, image_top = 30, 22, 69
    column = (page_width - 2 * margin - gap) / 2
    max_ratio = 0
    for question in prompts:
        for side in ("A", "B"):
            with Image.open(media / f"{question}-{side}.webp") as im:
                max_ratio = max(max_ratio, im.height / im.width)
    # Both alternatives use the same physical width, including when one is much taller.
    picture_width = min(column, (page_height - image_top - 36) / max_ratio) if max_ratio else column
    with pymupdf.open() as doc:
        for index, question in enumerate(prompts or [None], 1):
            page = doc.new_page(width=page_width, height=page_height)
            page.insert_font(fontname=font_name, fontfile=str(font_file))
            def label(x, y, value, size=12):
                page.insert_text((x, y), value, fontname=font_name, fontsize=size, color=(.19, .18, .16))
            label(margin, 28, "PanelStudio  组图盲选", 16)
            if question is None:
                label(margin, 62, "本轮两种方法推荐一致。")
                continue
            label(page_width - margin - 105, 28, f"第 {index} 组 / 共 {len(prompts)} 组")
            for col, side in enumerate(("A", "B")):
                left = margin + (column + gap) * col + (column - picture_width) / 2
                label(left, 56, f"方案 {side}")
                with Image.open(media / f"{question}-{side}.webp") as im:
                    height = picture_width * im.height / im.width
                    png = BytesIO()
                    im.convert("RGB").save(png, format="PNG")
                rect = pymupdf.Rect(left, image_top, left + picture_width, image_top + height)
                page.insert_image(rect, stream=png.getvalue())
                page.draw_rect(rect, color=(.87, .86, .83), width=.45)
            label(margin, page_height - 15, "我的选择     A     /     B     /     一样合适     /     都不采用")
        doc.set_metadata({"title": "PanelStudio 组图盲选"})
        doc.subset_fonts()
        doc.save(directory / "组图盲选.pdf", garbage=4, deflate=True)
        if prompts:
            doc[0].get_pixmap(matrix=pymupdf.Matrix(2, 2), alpha=False).save(directory / "第1组.png")


def display_ballot(directory, prompts, digest):
    template = Path(__file__).with_name("ballot.html").read_text(encoding="utf-8-sig")
    cards = "\n".join(
        question_html(directory / "media", question, number, len(prompts))
        for number, question in enumerate(prompts, 1)
    )
    page = template.replace("__CARDS__", cards or "<p>本轮两种方法推荐一致。</p>")
    page = page.replace("__DIGEST__", digest).replace("__VERSION__", VERSION)
    (directory / "index.html").write_text(page, encoding="utf-8")
    printable_ballot(directory, prompts)


def build(work):
    out=work/"blind"; media=out/"media"; media.mkdir(exist_ok=True,parents=True)
    pools={r["id"]:r for r in read(work,"candidates.json")}
    data=[r for r in read(work,"outcomes.json") if r["split"]=="test" and r["indices"]["default"]!=r["indices"]["content"]]
    data.sort(key=lambda r:hashlib.sha256((VERSION+"|order|"+r["id"]).encode()).digest())
    sides=["A","B"]*(len(data)//2)+(["A"] if len(data)%2 else [])
    random.Random(7132).shuffle(sides)
    key=[]; prompts=[]; ai_specs=[]
    for i,(r,default_side) in enumerate(zip(data,sides),1):
        q=f"Q{i:02}"
        candidates=pools[r["id"]]["candidates"]
        images={}
        for side in ("A","B"):
            model="default" if side==default_side else "content"
            cand=candidates[r["indices"][model]]
            picture=media/f"{q}-{side}.webp"
            render(work,r["id"],cand,picture)
            images[side]=hashlib.sha256(picture.read_bytes()).hexdigest()
            if i==1:
                svg(work,r["id"],cand,media/f"{q}-{side}.svg")
                ai_specs.append(dict(file=f"{q}-{side}.svg",canvas=cand["canvas"],boxes=cand["boxes"]))
        prompts.append(q)
        key.append(dict(question=q,figure=r["id"],paper=r["paper"],defaultSide=default_side,images=images))
    digest=hashlib.sha256(json.dumps(key,sort_keys=True).encode()).hexdigest()[:16]
    save(work,"blind-key.json",dict(version=VERSION,digest=digest,questions=key))
    save(out,"illustrator-input.json",ai_specs)
    display_ballot(out, prompts, digest)
    print("blind pairs",len(prompts),"of",sum(r["split"]=="test" for r in read(work,"outcomes.json")),"held-out figures")


def tally(work,files):
    k=read(work,"blind-key.json")
    key={i["question"]:i["defaultSide"] for i in k["questions"]}
    people=set(); total=Counter()
    for f in files:
        ballot=json.loads(f.read_text(encoding="utf-8-sig"))
        if ballot["version"]!=k["version"] or ballot["digest"]!=k["digest"]:
            raise ValueError("Different experiment or key")
        person=ballot["ballotId"]
        if not isinstance(person,str) or not person or person in people:
            raise ValueError("Missing/duplicate ballot ID")
        people.add(person)
        for q,choice in ballot["choices"].items():
            if q not in key or choice not in ("A","B","tie","neither"):
                raise ValueError("Unknown question or answer")
            total[choice if choice in ("tie","neither") else "default" if key[q]==choice else "content"]+=1
    print(json.dumps(dict(ballots=len(people),votes=dict(total),unanswered=len(people)*len(key)-sum(total.values()))))

if __name__=="__main__":
    ap=argparse.ArgumentParser(description=__doc__)
    ap.add_argument("work",type=Path)
    ap.add_argument("--tally",type=Path,nargs="+")
    args=ap.parse_args()
    if args.tally:
        tally(args.work,args.tally)
    else:
        build(args.work)

