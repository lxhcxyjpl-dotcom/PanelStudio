"""Export reviewed geometry and author-selected layouts for the API-assisted editor."""
import argparse
import json
from pathlib import Path
import xml.etree.ElementTree as ET

def paper_titles(metadata):
    if metadata is None:
        return {}
    result={}
    for row in ET.parse(metadata).getroot():
        if row.tag.rsplit("}",1)[-1]!="Article":
            continue
        fields={child.tag.rsplit("}",1)[-1]:(child.text or "").strip() for child in row}
        if fields.get("PMID") and fields.get("title"):
            result[fields["PMID"]]=fields["title"][:500]
    return result

def normalized(boxes):
    x=min(b[0] for b in boxes)
    y=min(b[1] for b in boxes)
    width=max(b[2] for b in boxes)-x
    height=max(b[3] for b in boxes)-y
    return width/height, [
        dict(x=(a-x)/width,y=(b-y)/height,width=(c-a)/width,height=(d-b)/height)
        for a,b,c,d in boxes
    ]

def export(work, output, field, metadata=None):
    read=lambda name:json.loads((work/name).read_text(encoding="utf-8-sig"))
    geometry={r["id"]:r for r in read("geometry.json")}
    titles=paper_titles(metadata)
    result=[]
    for row in geometry.values():
        labels=sorted(row["boxes"])
        aspect,slots=normalized([row["boxes"][label] for label in labels])
        result.append(dict(id="paper-"+row["id"],origin="paper",journal=row["journal"],field=field,title=titles.get(row["paper"],""),
                           sourceUrl="https://doi.org/"+row["doi"],aspect=aspect,slots=slots,
                           panelTypes=[row["types"][label] for label in labels]))
    choices=work/"feedback"/"author-01-comparison.json"
    if choices.is_file():
        inputs={r["id"]:r for r in read("candidates.json")}
        for vote in json.loads(choices.read_text(encoding="utf-8"))["trainingPairs"]:
            figure=geometry[vote["figure"]]
            entry=vote["alternatives"][vote["preferredSide"]]
            candidate=inputs[figure["id"]]["candidates"][entry["candidateIndex"]]
            aspect,slots=normalized(candidate["boxes"])
            result.append(dict(id="accepted-"+vote["question"],origin="accepted",journal=figure["journal"],field=field,title=titles.get(figure["paper"],""),
                               aspect=aspect,slots=slots,panelTypes=[figure["types"][label] for label in sorted(figure["boxes"])]))
    output.parent.mkdir(parents=True,exist_ok=True)
    output.write_text(json.dumps(result,ensure_ascii=False,indent=1),encoding="utf-8")
    print(len(result),"reference layouts exported to",output)

if __name__=="__main__":
    ap=argparse.ArgumentParser(description=__doc__)
    ap.add_argument("work",type=Path)
    ap.add_argument("output",type=Path)
    ap.add_argument("--field",required=True,help="Research scope of the reviewed corpus")
    ap.add_argument("--metadata",type=Path,help="Original Zotero RDF for article titles")
    args=ap.parse_args()
    export(args.work,args.output,args.field,args.metadata)

