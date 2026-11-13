"""Refit the complete pipeline for nested training-paper subsets, using validation only."""
import argparse
import hashlib
from pathlib import Path
import subprocess

import content
import rank


def run(work):
    split=content.read(work,"split.json")["papers"]
    geometry=content.read(work,"geometry.json")
    sources={r["id"]:r for r in content.read(work,"sources.json")}
    train=sorted({v["group"] for v in split.values() if v["split"]=="train"},
                 key=lambda g:hashlib.sha256(("curve-v1|"+g).encode()).digest())
    results=[]
    for size in sorted({n for n in (10,20,len(train)) if n<=len(train)}):
        groups=set(train[:size])
        papers={p:v for p,v in split.items() if v["split"]=="validation" or v["group"] in groups}
        if size==len(train):
            result=content.read(work,"results.json")["validation"]
            included=content.read(work,"results.json")["train"]["figures"]
        else:
            target=work/"curve"/str(size)
            target.mkdir(parents=True,exist_ok=True)
            rows=[r for r in geometry if r["paper"] in papers]
            included=sum(papers[r["paper"]]["split"]=="train" for r in rows)
            content.save(target,"geometry.json",rows)
            content.save(target,"sources.json",[sources[r["id"]] for r in rows])
            content.main(target,papers,work/"panels")
            subprocess.run(["node",str(Path(__file__).with_name("candidates.mjs")),str(target.resolve())],check=True)
            rank.main(target)
            result=content.read(target,"results.json")["validation"]
        results.append(dict(trainingGroups=size,trainingFigures=included,validationPapers=result["papers"],
                            validationFigures=result["figures"],metrics=result["metrics"]))
    content.save(work,"learning-curve.json",results)

if __name__=="__main__":
    ap=argparse.ArgumentParser(description=__doc__);ap.add_argument("work",type=Path)
    run(ap.parse_args().work)

