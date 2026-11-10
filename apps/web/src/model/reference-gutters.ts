import type { Region } from "./reference-image";

type Bounds = { x: number; y: number; r: number; b: number };
type Cut = { pieces: [Bounds, Bounds]; score: number };

/** Split only along observed low-ink bands. The current number of layout units is
 * an upper bound. A chart with no plausible internal gutter stays unsplit. */
export function gutterRegions(mask: Uint8Array, w: number, h: number, target: number): Region[] {
  const stride = w + 1, prefix = new Uint32Array(stride * (h + 1));
  for (let y = 0; y < h; y++) {
    let sum = 0;
    for (let x = 0; x < w; x++) {
      sum += mask[y * w + x] ? 1 : 0;
      prefix[(y + 1) * stride + x + 1] = prefix[y * stride + x + 1]! + sum;
    }
  }
  const ink = ({x,y,r,b}: Bounds) => prefix[b*stride+r]! - prefix[b*stride+x]! - prefix[y*stride+r]! + prefix[y*stride+x]!;
  function trim(s: Bounds): Bounds {
    let {x,y,r,b} = s;
    while (x < r && !ink({x,y,r:x+1,b})) x++;
    while (x < r && !ink({x:r-1,y,r,b})) r--;
    while (y < b && !ink({x,y,r,b:y+1})) y++;
    while (y < b && !ink({x,y:b-1,r,b})) b--;
    return {x,y,r,b};
  }
  const whole = trim({x:0,y:0,r:w,b:h}), total = ink(whole);
  if (total < w*h*.007) return [];
  const substantial = (s: Bounds) => s.r-s.x >= .11*w && s.b-s.y >= .065*h &&
    (s.r-s.x)*(s.b-s.y) >= .021*w*h && ink(s) >= .012*total;
  function bestCut(box: Bounds): Cut | null {
    let best: Cut | null = null;
    for (const vertical of [false,true]) {
      const lo=vertical?box.x:box.y, hi=vertical?box.r:box.b, span=vertical?box.b-box.y:box.r-box.x;
      const line=(i: number)=>vertical?{...box,x:i,r:i+1}:{...box,y:i,b:i+1};
      let start=-1, residual=0;
      for (let i=lo;i<=hi;i++) {
        const n=i<hi?ink(line(i)):Infinity;
        if (n <= span*.012) {
          if (start<0) {start=i;residual=0;}
          residual+=n;
          continue;
        }
        if (start<0) continue;
        const a=start, gap=i-start; start=-1;
        if (a===lo || i===hi || gap<Math.max(2,(vertical?w:h)*.004)) continue;
        const first=trim(vertical?{...box,r:a}:{...box,b:a}), second=trim(vertical?{...box,x:i}:{...box,y:i});
        if (!substantial(first) || !substantial(second)) continue;
        const balance=Math.min(ink(first),ink(second))/Math.max(ink(first),ink(second));
        const cleanliness=1-Math.min(.55,residual/(span*gap*.025));
        const score=gap*span*cleanliness*(.65+.35*Math.sqrt(balance));
        if (!best || score>best.score) best={pieces:[first,second],score};
      }
    }
    return best;
  }
  const cells = [{bounds:whole,cut:bestCut(whole)}];
  while(cells.length<target) {
    let index=-1,score=0;
    for(const [i,cell] of cells.entries()) if(cell.cut && cell.cut.score>score){index=i;score=cell.cut.score;}
    if(index<0) break;
    const cut=cells[index]!.cut!;
    cells.splice(index,1,...cut.pieces.map(bounds=>({bounds,cut:bestCut(bounds)})));
  }
  return cells.length<2?[]:cells.map(({bounds:{x,y,r,b}})=>({x:x/w,y:y/h,width:(r-x)/w,height:(b-y)/h}));
}
