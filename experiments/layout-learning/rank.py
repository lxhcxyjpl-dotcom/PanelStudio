"""Fit a weakly supervised ranker and evaluate publication geometry on held-out papers."""
import argparse
from collections import Counter, defaultdict
import json
from pathlib import Path

import numpy as np
from scipy.optimize import minimize
from scipy.special import logsumexp, softmax

from content import read, save

GEO=["engineCost","inkFill","extentRatio","areaSpread","rowHeightSpread","smallestWidth",
     "retrievalSupport","aspectPriorMean","aspectPriorNearest"]
SEM=["contentPriorMean","typeAligned","explicitPairAligned","plotWidth","imageArea"]
STRENGTHS=(.03,.3,3.)
POSITIVE_FLOOR=.42
POSITIVE_TIE=.07


def normalized(boxes):
    b=np.asarray(boxes,dtype=float)
    xy=b[:,:2].min(axis=0)
    return (b-np.tile(xy,2))/(b[:,2].max()-xy[0])


def iou(a,b):
    size=np.maximum(0,np.minimum(a[:,2:],b[:,2:])-np.maximum(a[:,:2],b[:,:2]))
    inter=size.prod(axis=1)
    area_a=(a[:,2:]-a[:,:2]).prod(axis=1)
    area_b=(b[:,2:]-b[:,:2]).prod(axis=1)
    return float(np.mean(inter/(area_a+area_b-inter)))


def adjacency(b):
    edges=set()
    for axis,name in ((0,"right"),(1,"down")):
        other=1-axis
        for i,row in enumerate(b):
            near=[]
            for j,v in enumerate(b):
                if i==j:
                    continue
                gap=v[axis]-row[axis+2]
                overlap=min(row[other+2],v[other+2])-max(row[other],v[other])
                size=min(row[other+2]-row[other],v[other+2]-v[other])
                if -.005<=gap<=.22 and overlap>=.35*size:
                    near.append((gap,j))
            if near:
                smallest=min(g for g,_ in near)
                edges.update((i,j,name) for g,j in near if g<=smallest+.03)
    return edges


def adj_f1(a,b):
    if not a and not b:
        return 1.
    return 2*len(a&b)/max(1,len(a)+len(b))


def build_sample(d, pool, target, refs):
    labels=list("ABCDEFGH"[:len(d["aspects"])])
    source=normalized([target["boxes"][l] for l in labels]) if target is not None else None
    true_edges=adjacency(source) if source is not None else None
    post=np.asarray(d["posteriors"])
    aspects=np.log(d["aspects"])
    examples=[]
    for r,b in refs:
        if r["group"]==d["group"] or len(r["aspects"])!=len(aspects):
            continue
        geo=float(np.sqrt(np.mean((aspects-np.log(r["aspects"]))**2)))
        sem=geo+.35*float(np.mean(np.abs(post-r["posteriors"]).sum(axis=1)/2))
        examples.append((geo,sem,b,r["paper"]))
    # Give a single paper at most one representative among the nearest neighbors.
    def nearest(which):
        chosen=[]; papers=set()
        for row in sorted(examples,key=lambda v:v[which]):
            if row[3] in papers:
                continue
            chosen.append(row);papers.add(row[3])
            if len(chosen)==6:
                break
        weights=softmax([-3*row[which] for row in chosen]) if chosen else []
        return chosen,weights
    geo_refs,gw=nearest(0)
    sem_refs,sw=nearest(1)
    X=[]; overlap=[]; edges=[]; correspondence=[]
    for c in pool["candidates"]:
        b=normalized(c["boxes"])
        dims=b[:,2:]-b[:,:2]; w,h=dims.T; area=w*h
        bay=b[:,3].max()
        geo_values=[iou(b,r[2]) for r in geo_refs]
        sem_values=[iou(b,r[2]) for r in sem_refs]
        g=adjacency(b)
        sims=[]; aligns=[]
        for i in range(len(labels)):
            for j in range(i+1,len(labels)):
                sims.append(post[i]@post[j])
                linked=any((ii,jj,axis) in g for ii,jj in [(i,j),(j,i)] for axis in ["right","down"])
                aligns.append(float(linked)*max(np.exp(-abs(np.log(h[i]/h[j]))),np.exp(-abs(np.log(w[i]/w[j])))))
        explicit=[]
        for pair in d["pairs"]:
            i,j=labels.index(pair[0]),labels.index(pair[1])
            explicit.append(float(any((ii,jj,ax) in g for ii,jj in [(i,j),(j,i)] for ax in ["right","down"])))
        geom=[c["cost"],area.sum()/bay,np.log(max(bay,.01)),np.std(np.log(area)),
              np.std(np.log(h)),min(w),np.log1p(len(c["refs"])),np.dot(gw,geo_values) if geo_values else 0,
              geo_values[0] if geo_values else 0]
        soft=[np.dot(sw,sem_values) if sem_values else 0,np.dot(aligns,sims)/max(sum(sims),1e-9),
              np.mean(explicit) if explicit else 0,
              np.dot(post[:,4],w)/max(post[:,4].sum(),1e-9),np.dot(post[:,2],area)/max(post[:,2].sum(),1e-9)]
        X.append(geom+soft)
        if source is not None:
            overlap.append(iou(b,source)); edges.append(adj_f1(g,true_edges))
        correspondence.append(float(np.mean(explicit)) if explicit else None)
    return dict(id=d["id"],paper=d["paper"],group=d["group"],split=d["split"],X=np.asarray(X),
                iou=np.array(overlap),adj=np.array(edges),correspondence=correspondence,
                baseline=pool["baseline"],retrieved=pool["retrieved"])


def positives(sample):
    q=.8*sample["iou"]+.2*sample["adj"]
    return q>=max(POSITIVE_FLOOR,float(q.max())-POSITIVE_TIE)


def fit(rows,ncols,strength):
    useful=[r for r in rows if positives(r).any() and not positives(r).all()]
    if not useful:
        raise ValueError("No discriminating training groups")
    counts=Counter(r["paper"] for r in useful)
    data=[(r["X"][:,:ncols],positives(r),1/(len(counts)*counts[r["paper"]])) for r in useful]
    # Equal paper weight both in scaling and objective; normalize within each figure's candidate set.
    means=sum(w*x.mean(axis=0) for x,_,w in data)
    sd=np.maximum(.035,np.sqrt(sum(w*((x-means)**2).mean(axis=0) for x,_,w in data)))
    data=[((x-means)/sd,p,w) for x,p,w in data]
    def loss(coef):
        value=strength*(coef@coef)/2; grad=strength*coef
        for x,mask,w in data:
            z=x@coef
            value+=w*(logsumexp(z)-logsumexp(z[mask]))
            grad+=w*(softmax(z)@x-softmax(z[mask])@x[mask])
        return value,grad
    opt=minimize(loss,np.zeros(ncols),jac=True,method="L-BFGS-B")
    if not opt.success:
        raise ValueError(opt.message)
    return dict(features=(GEO+SEM)[:ncols],mean=means.tolist(),std=sd.tolist(),weights=opt.x.tolist(),
                regularization=strength,trainingFigures=len(useful),trainingPapers=len(counts))


def scores(sample,model):
    n=len(model["weights"])
    return ((sample["X"][:,:n]-model["mean"])/model["std"])@model["weights"]


def paper_mean(rows,measure):
    values=defaultdict(list)
    for r in rows:
        values[r["paper"]].append(measure(r))
    return float(np.mean([np.mean(vals) for vals in values.values()]))


def select(rows,valid,ncols):
    probes=[]
    for lam in STRENGTHS:
        m=fit(rows,ncols,lam)
        merit=paper_mean(valid,lambda r:.8*r["iou"][np.argmax(scores(r,m))]+.2*r["adj"][np.argmax(scores(r,m))])
        probes.append((merit,lam,m))
    _,_,chosen=max(probes,key=lambda row:(round(row[0],8),row[1]))
    return chosen,[dict(regularization=lam,validation=float(merit)) for merit,lam,_ in probes]


def evaluate(rows,models):
    records=[]
    for r in rows:
        order=dict(default=r["baseline"],retrieved=r["retrieved"],**{
            name:int(np.argmax(scores(r,m))) for name,m in models.items()})
        order["oracleIoU"]=int(np.argmax(r["iou"]))
        records.append(dict(id=r["id"],paper=r["paper"],split=r["split"],candidateCount=len(r["X"]),
                            indices=order,metrics={name:dict(iou=float(r["iou"][i]),adj=float(r["adj"][i]),
                            captionAdjacency=r["correspondence"][i]) for name,i in order.items()}))
    return records


def summarize(rows):
    papers=sorted({r["paper"] for r in rows})
    methods=rows[0]["indices"]
    metrics={m:{kind:paper_mean(rows,lambda r:r["metrics"][m][kind]) for kind in ("iou","adj")} for m in methods}
    diffs=[np.mean([r["metrics"]["content"]["iou"]-r["metrics"]["default"]["iou"] for r in rows if r["paper"]==p]) for p in papers]
    rng=np.random.default_rng(24)
    boots=rng.choice(diffs,size=(10000,len(diffs)),replace=True).mean(axis=1)
    delta=[r["metrics"]["content"]["iou"]-r["metrics"]["default"]["iou"] for r in rows]
    return dict(figures=len(rows),papers=len(papers),metrics=metrics,pairedIoUDifference=float(np.mean(diffs)),
                bootstrap95=np.quantile(boots,[.025,.975]).tolist(),win=sum(v>1e-6 for v in delta),
                tie=sum(abs(v)<=1e-6 for v in delta),loss=sum(v< -1e-6 for v in delta))


def main(work):
    inputs=read(work,"inputs.json"); geo={r["id"]:r for r in read(work,"geometry.json")}
    pools={r["id"]:r for r in read(work,"candidates.json")}
    refs=[(d,normalized([geo[d["id"]]["boxes"][l] for l in sorted(geo[d["id"]]["boxes"])]))
          for d in inputs if d["split"]=="train"]
    rows=[build_sample(d,pools[d["id"]],geo[d["id"]],refs) for d in inputs if pools[d["id"]]["baseline"] is not None]
    sets={s:[r for r in rows if r["split"]==s] for s in ("train","validation","test","preprint")}
    models={}; tuning={}
    for name,n in (("geometry",len(GEO)),("content",len(GEO+SEM))):
        models[name],tuning[name]=select(sets["train"],sets["validation"],n)
    save(work,"ranker.json",dict(models=models,validation=tuning,positiveFloor=POSITIVE_FLOOR,tieMargin=POSITIVE_TIE))
    # Validation above fixes all coefficients and hyperparameters before held-out reporting.
    records=evaluate(rows,models)
    save(work,"outcomes.json",records)
    summary={s:summarize([r for r in records if r["split"]==s]) for s in sets if sets[s]}
    summary["candidateCounts"]={s:sum(len(r["X"]) for r in rs) for s,rs in sets.items()}
    summary["noCover"]={s:sum(not positives(r).any() for r in rs) for s,rs in sets.items()}
    summary["noLegalDefault"]=[d["id"] for d in inputs if pools[d["id"]]["baseline"] is None]
    save(work,"results.json",summary)
    print(json.dumps(summary.get("test",summary["validation"]),ensure_ascii=False))

if __name__=="__main__":
    ap=argparse.ArgumentParser(description=__doc__)
    ap.add_argument("work",type=Path)
    main(ap.parse_args().work)

