"""Make a layout-only, simulated manuscript with two alternative writing goals."""
import argparse
from pathlib import Path
import json
import numpy as np
from PIL import Image,ImageDraw,ImageFont
from scipy.ndimage import gaussian_filter


def make(output):
    output.mkdir(parents=True,exist_ok=True)
    rng=np.random.default_rng(137)
    fg="#27342e"; forest="#387c65"; ochre="#af673f"
    def font(size):
        try:
            return ImageFont.truetype("arial.ttf",size)
        except OSError:
            return ImageFont.load_default(size=size)
    def page(label,title):
        im=Image.new("RGB",(620,390),"white");draw=ImageDraw.Draw(im)
        draw.text((15,9),label,font=font(28),fill=fg)
        draw.text((55,13),title,font=font(22),fill=fg)
        return im,draw
    for label,mean in [("A",.6),("B",.95)]:
        im,draw=page(label,"Group "+("1" if label=="A" else "2"))
        noise=rng.normal(.025,.02,(300,535)); impulses=np.zeros(noise.shape)
        coords=(rng.integers(7,292,130),rng.integers(7,527,130))
        impulses[coords]=rng.uniform(.35,1.0,130)*mean
        field=np.clip(noise+gaussian_filter(impulses,2.8)*46,0,1)
        im.paste(Image.fromarray((field[:,:,None]*np.array([62,208,155])).astype("uint8")),(40,55))
        draw.line((469,330,552,330),fill="white",width=4)
        im.save(output/(label+".png"))
    im,d=page("C","Signal by group")
    d.line((85,70,85,318,574,318),fill=fg,width=3)
    for val in (0,1,2,3):
        y=318-70*val
        d.line((80,y,85,y),fill=fg,width=2);d.text((47,y-10),str(val),font=font(17),fill=fg)
    for j,(x,avg,color) in enumerate([(225,.95,forest),(445,2.05,ochre)],1):
        values=rng.normal(avg,.23,18)
        for v in values:
            cx=x+rng.normal(0,11);cy=318-v*70
            d.ellipse((cx-4,cy-4,cx+4,cy+4),fill=color)
        y=318-values.mean()*70;d.line((x-33,y,x+33,y),fill=fg,width=3)
        d.text((x-34,331),"Group "+str(j),font=font(19),fill=fg)
    im.save(output/"C.png")
    im,d=page("D","Study design")
    for i,word in enumerate(["Sample","Image","Compare"]):
        x=40+i*190;d.rounded_rectangle((x,151,x+145,220),radius=10,fill="#e8f1e9",outline=forest,width=2)
        d.text((x+72,185),word,anchor="mm",font=font(21),fill=fg)
        if i<2:
            d.line((x+148,185,x+180,185),fill=fg,width=3);d.polygon([(x+180,185),(x+171,180),(x+171,190)],fill=fg)
    im.save(output/"D.png")
    panels=[dict(file=k+".png",caption=cap) for k,cap in zip("ABCD",["第一组显微图","第二组显微图","组间定量比较","实验流程"])]
    for short,brief in [("quant","突出两组的定量差异"),("design","先解释实验流程")]:
        (output/(short+".json")).write_text(json.dumps(dict(panels=panels,brief=brief,pair=["A","B"],equalHeight=True),ensure_ascii=False,indent=2),encoding="utf-8")

if __name__=="__main__":
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output",type=Path)
    make(parser.parse_args().output)

