import { RESOURCE_LIMITS, type Asset, type FigureDocumentV1, type LayoutRequest, type PublicationContext } from "@panelstudio/contracts";
import { namedUnits, parsePreferences } from "./guided-preferences";

export type WishAsset = Pick<Asset, "id" | "originalFilename"> & { evidence?: string; ignoreName?: boolean };
function clues(a: WishAsset, note = "") {
  return [a.evidence, note, a.ignoreName ? "" : a.originalFilename].filter(Boolean).join(" ");
}
type Text = [RegExp, RegExp];
const microscopy: Text = [
  /显微|染色|组织切片|microscop|micrograph|staining/i,
  /显微|染色|组织切片|micro(graph|scop)|stain|immunofluor|fluorescen/i,
];
const control: Text = [/对照|未处理|\bcontrol\b|\bvehicle\b/iu, /对照|未处理|control|vehicle|untreated/iu];
const treatment: Text = [/(?<!未)处理|治疗|\btreat/iu, /(?<!未)处理|治疗|(?<![a-z])treated|treatment|drug/iu];
const subjects: Text[] = [
  microscopy,
  [/散点|scatter(?:plot)?/i, /散点|scatter(?:plot)?/i],
  [/定量|统计图|quantif|quantitative/i, /定量|统计|quant|count|intensity|violin|boxplot/i],
  control,
  treatment,
  [/流程|示意|schematic|workflow/i, /流程|示意|schematic|workflow|diagram/i],
  [/样本量|样本数|数量图|counts per group|sample size/i, /样本量|样本数|数量|group.count|sample.size/i],
  [/时间|time.?course/i, /时间|time.?course|kinetic/i],
];
/** A standalone decision about which source images to use can be followed by a layout instruction. */
export function allImagesClause(text: string, imageCount?: number): boolean {
  const clause = text.trim().replace(/^(?:(?:好的?|那就|就|请|我要|我想|把|将)\s*)+/u, "");
  const english = /^(?:use|include|keep) (all|both)(?: (?:of )?(?:the |these |my )?(?:panels|images|figures))?$/iu.exec(clause);
  if (english) return english[1]!.toLowerCase() === "all" || imageCount === undefined || imageCount === 2;
  if (/^(?:用|放|排|保留)(?:上|入|进来)?\s*(?:所有的?|全部的?)图(?:片)?$/u.test(clause)) return true;
  const use = /^(.*?)\s*(都|全部|全)?\s*(?:用(?:上|进去)?|放(?:上|进(?:去|来)?|在一起)?|保留|排(?:上|下(?:来)?|进(?:去|来)?|在一起)?)$/u.exec(clause);
  if (!use) return false;
  const subject = use[1]!;
  if (!subject) return Boolean(use[2]);
  if (/^(?:这些|所有的?|全部的?)图(?:片)?$|^这几张(?:图(?:片)?)?$/u.test(subject)) return true;
  const counted = /^(?:这|那)?([一二两三四五六七八九十]|\d+)张(?:图(?:片)?)?$/u.exec(subject);
  if (!counted || !use[2]) return false;
  const numeral = counted[1]!.replace("两", "二");
  const count = /^\d+$/u.test(numeral) ? Number(numeral) : "〇一二三四五六七八九十".indexOf(numeral);
  return imageCount === undefined || imageCount === count;
}
export const asksForSelection = (s: string) =>
  /选[哪哪几些图]|选图|挑[几哪图]|哪些.{0,6}(放|用|适合)|放哪|不确定.{0,8}(用|放)|pick|shortlist|which (figures|images|panels)|choose (the |some )?(images|panels|figures)/i.test(
    s,
  );
export function requestsCuration(text: string, count: number): boolean {
  if (count < 2 || !text.trim()) return false;
  if (text.split(/[,，。；;\n]/u).some(clause => allImagesClause(clause, count)) ||
      /(?:全部|所有(?:的)?图)\s*(?:都)?(?:用|放进去|排进去)|都要用|不用挑|先别排|不要直接排|只(?:挑图|选图)|先(?:讨论|聊聊)|\b(?:keep|use|include) (?:all|every)\b|\b(?:discuss first|shortlist only)\b/iu.test(text)) return false;
  if (/主图[\s\S]{0,100}补充|补充图[\s\S]{0,100}主图|\bmain (?:figure|panels?)\b[\s\S]{0,100}\bsupplement/iu.test(text)) return true;
  if (/\b[A-Z]{1,2}\s*(?:和|与|、|and|&)\s*[A-Z]{1,2}\b|(?:把|将)\s*[A-Z]{1,2}\b|side.by.side|并排|排在[左右下]/iu.test(text)) return false;
  const figureGoal = /\bfig(?:ure)?\.?\s*\d+|图\s*[一二三四五六七八九十\d]+/iu.test(text);
  const purpose = /想讲|想展示|想说明|想比较|突出|展示|说明|重点|对比|比较|\b(?:compare|show|highlight|tell|focus)\b/iu.test(text);
  return (purpose && (figureGoal || count > RESOURCE_LIMITS.maxPanelsPerProject)) ||
    (asksForSelection(text) && /初稿|一稿|一版|直接排|不(?:知道|确定|清楚).{0,12}(?:选|挑|放|用)|not sure which|\bdraft\b/iu.test(text));
}

export function narrativeFocus(text: string): boolean {
  const phrase = text.normalize("NFKC").trim();
  return /^(?:(?:这张图|这幅图|Fig(?:ure)?\.?\s*\d+)[，,：:\s]*)?(?:我)?(?:现在|其实|更)?(?:想|要|希望)?(?:把重点放在|(?:重点|主要)(?:想)?(?:讲|说明|展示|表达|放在)|更?强调|更想(?:讲|展示|说明)|(?:改为|改成|转向)重点(?:讲|展示))\s*[^\s。！？]+|^(?:(?:now )?(?:i (?:want|would like) to )?(?:focus (?:on|more on)|emphasize|highlight)|(?:shift|change) the focus to|the main story is)\s+\S/iu.test(phrase) &&
    !/(?:面板|panel|图)\s*[A-Z]{1,2}\b|(?:强调|展示|突出|highlight|emphasize|focus on)\s*[A-Z]{1,2}\s*[。.!！?？]?$|并排|间距|\d+\s*(?:mm|毫米|%)|移到|放大|缩小|换掉|删掉|(?:移|放)到补(?:充|图)|\b(?:remove|drop|replace|resize|move to (?:the )?supplement)\b/iu.test(phrase);
}

export function figureWidth(text: string) {
  return /(?:整张|整图|整幅|画布|图稿?|版心|单栏|双栏|canvas|figure|overall)\s*(?:宽(?:度)?|width)?\s*(?:为|设为|为约|of|at)?\s*(\d+(?:\.\d+)?)\s*(?:mm|毫米)/iu.exec(text)?.[1]
    ?? /(?:^|[,，;；\n])\s*(?:宽(?:度)?\s*(?:为|设为)?\s*)?(\d+(?:\.\d+)?)\s*(?:mm|毫米)(?=\s*[,，。.;；\n]|\s*$)/iu.exec(text)?.[1]
    ?? /(\d+(?:\.\d+)?)\s*mm\s+wide\b/iu.exec(text)?.[1];
}
export function selectionLayoutPart(part: string) {
  return (
    /并排|并列|上下对比|(?:放|排)在[左右下][边侧面方]?|宽\s*\d|\d+\s*(?:mm|毫米)|side.by.side|below|stacked/i.test(part) &&
    !/不要|去掉|排除|加上|加入|保留|exclude|remove|include|keep\b|add\b/i.test(part)
  );
}
export function isPendingLayout(text: string) {
  const parts = text
    .trim()
    .split(/[,，。；;\n]+/u)
    .filter((part) => part.trim());
  return parts.length > 0 && parts.every(selectionLayoutPart);
}
export const uncertainLayout = (s: string) =>
  /没.{0,3}思路|怎么排|不会排|不确定.{0,6}排|不知道.{0,7}排|no idea|not sure|how (should|to) (I )?(arrange|lay)/i.test(
    s,
  );
export const automatic = (s: string) =>
  /^(?:先|直接|帮我|请)?(?:排一版|排一下|自动排版|生成初稿|开始排版|先看一版|出一版)|^(?:draft|arrange)(?: it| first| these)?[.!]?$/i.test(
    s.trim(),
  );

export function localPairRequest(text: string, document: FigureDocumentV1): LayoutRequest | undefined {
  const phrase = text.normalize("NFKC").trim().replace(/[。.!！]+$/, "")
    .replace(/[,，;；]\s*(?:其[余他](?:的)?(?:图|面板)?(?:都)?(?:不动|保持不变)|keep (?:everything|the others) (?:else )?(?:still|unchanged))$/iu, "");
  const pair = /^(?:请\s*|先\s*|把\s*|将\s*|please\s+|put\s+|place\s+)*([^ ,，。]+)\s*(?:和|与|、|\band\b)\s*([^ ,，。]+?)\s*(?:并排|并列|side.by.side)(?:放|摆放)?(?:[,，;；]\s*(?:间距|gap|spacing)\s*(?:为|to|of)?\s*(\d+(?:\.\d+)?)\s*(?:mm|毫米))?$/iu.exec(phrase);
  if (!pair) return;
  const units = namedUnits(document);
  const findUnit = (label: string) => {
    const matches = units.filter(unit => unit.alias.toLowerCase() === label.toLowerCase());
    return matches.length === 1 ? matches[0]!.id : undefined;
  };
  const left = findUnit(pair[1]!), right = findUnit(pair[2]!);
  const gap = pair[3] === undefined ? undefined : Number(pair[3]);
  if (left && right && left !== right && (gap === undefined || gap <= 30))
    return { family: "selection-row", orderedUnitIds: [left, right], sizing: "preserve", ...(gap !== undefined ? { gapMm: gap } : {}) };
}
const stem = (s: string) => s.replace(/\.[^.]+$/, "").toLowerCase();
const escape = (s: string) => s.replace(/[.*+?^$(){}|[\]\\]/g, "\\$&");
export function assetMentions(
  text: string,
  assets: WishAsset[],
  notes: Record<string, string> = {},
): string[] {
  const s = text.normalize("NFKC").toLowerCase();
  const explicit = assets.filter((a, i) => {
    const name = stem(a.originalFilename);
    return (
      (name.length > 1 && s.includes(name)) ||
      new RegExp("(?:#|第\\s*|素材\\s*|图\\s*)" + (i + 1) + "(?!\\d)").test(s)
    );
  });
  if (explicit.length) return explicit.map((a) => a.id);
  const roles = subjects.filter(([word]) => word.test(s));
  if (roles.length) {
    const matches = assets.filter((a) => roles.every(([, pattern]) => pattern.test(clues(a, notes[a.id]))));
    if (matches.length) return matches.map((a) => a.id);
  }
  const terms = words(text);
  const scored = assets.map((a) => {
    const known = words(clues(a, notes[a.id]));
    return { id: a.id, score: [...terms].filter((w) => known.has(w)).length };
  });
  const highest = Math.max(0, ...scored.map((a) => a.score));
  return highest ? scored.filter((a) => a.score === highest).map((a) => a.id) : [];
}
const stop =
  /^(?:fig|figure|svg|png|jpeg|show|main|data|with|panel|result|want|希望|图中|重点|展示|这个|这张|结果|比较|想看|图稿|突出|研究|处理|对照)$/;
function words(s: string) {
  const acronyms = new Set((s.match(/\b[A-Z][A-Z0-9]\b/g) ?? []).map((w) => w.toLowerCase()));
  const parts = (s.toLowerCase().match(/[a-z][a-z0-9]+|[\u3400-\u9fff]+/gu) ?? []).filter(
    (term) => term.length !== 2 || !/^[a-z]/.test(term) || acronyms.has(term),
  );
  return new Set(
    parts
      .flatMap((p) =>
        /^[a-z]/.test(p) ? [p] : Array.from({ length: p.length - 1 }, (_, i) => p.slice(i, i + 2)),
      )
      .filter((w) => !stop.test(w)),
  );
}
/** Prefer the actual labels, image category and author annotations. Names are a secondary clue. */
export function shortlist(goal: string, assets: WishAsset[], notes: Record<string, string>) {
  const tokens = words(goal);
  const groups = [control, treatment].filter(([requested]) => requested.test(goal));
  const candidates = assets.map((a) => clues(a, notes[a.id]));
  const covered =
    microscopy[0].test(goal) &&
    groups.length > 0 &&
    groups.every(([, marker]) => candidates.some((s) => microscopy[1].test(s) && marker.test(s)));
  const scored = assets
    .filter((a, i) => {
      const evidence = candidates[i]!;
      if (!covered || !microscopy[1].test(evidence) || groups.some(([, marker]) => marker.test(evidence)))
        return true;
      // Once the requested conditions are represented, an unidentified micrograph stays in reserve
      // unless the author also asked for the overview or named this particular image.
      return (
        /概览|全景|合并图|overview|merged/i.test(goal) ||
        goal.toLowerCase().includes(stem(a.originalFilename))
      );
    })
    .map((a) => {
      const name = clues(a, notes[a.id]);
      const contentWords = words([a.evidence, notes[a.id]].filter(Boolean).join(" "));
      const terms = words(name);
      const hits = [...tokens].filter((t) => terms.has(t));
      const roles = subjects.filter(([word, filename]) => word.test(goal) && filename.test(name));
      return {
        id: a.id,
        score: hits.length + hits.filter((w) => contentWords.has(w)).length * 2 + roles.length,
        hits: [...hits, ...roles.flatMap(([, pattern]) => name.match(pattern)?.[0] ?? [])],
      };
    })
    .sort((a, b) => b.score - a.score);
  const relevant = scored.filter((a) => a.score > 0);
  const max = RESOURCE_LIMITS.maxPanelsPerProject;
  return relevant.length > max && relevant[max - 1]!.score === relevant[max]!.score
    ? relevant.filter((a) => a.score > relevant[max - 1]!.score)
    : relevant.slice(0, max);
}

export function publicationFrom(text: string, prior?: PublicationContext): PublicationContext {
  const result: PublicationContext = { journal: "", field: "", message: "", preference: "auto", ...prior };
  const story: string[] = [];
  let metadata = false;
  for (const clause of text
    .split(/[,，。；;\n]+/)
    .map((p) => p.trim())
    .filter(Boolean)) {
    const journal =
      /^(?:(?:目标|投稿)?期刊(?:是|为)?|(?:准备|打算|想)?投(?:稿到|稿至|稿|给|到|至|的是)?|(?:target )?journal\s*[:：]|submit(?:ting)? to)\s*[:：]?\s*(.+)$/i.exec(
        clause,
      );
    const field = /^(?:研究方向|方向|领域|定位|field|audience)\s*[:：为是]?\s*(.+)$/i.exec(clause);
    if (journal && !/^(?:单栏|双栏|一栏|\d)/.test(journal[1]!)) {
      result.journal = journal[1]!.trim().slice(0, 160);
      metadata = true;
    } else if (field) {
      result.field = field[1]!.trim().slice(0, 240);
      metadata = true;
    } else story.push(clause);
  }
  const message = metadata ? story.join("，") : text.trim();
  if (message) result.message = message.slice(0, 1000);
  if (/比较|对照|对比|compar/i.test(text)) result.preference = "comparison";
  else if (/突出|重点|强调|focus|emphas/i.test(text)) result.preference = "emphasis";
  else if (/紧凑|compact/i.test(text)) result.preference = "compact";
  return result;
}
export type WishInterpretation =
  | { kind: "layout"; request: LayoutRequest }
  | { kind: "move"; panelId: string; dx: number; dy: number }
  | { kind: "resize"; panelId: string; factor: number; width?: number }
  | { kind: "clarify"; fragment: string };

export function interpretWish(
  text: string,
  doc: FigureDocumentV1,
  brief?: PublicationContext,
  context: {
    notes?: Record<string, string>;
    selected?: string[];
    evidence?: Record<string, { evidence: string; ignoreName: boolean }>;
    explicitPanelsOnly?: boolean;
  } = {},
): WishInterpretation {
  const units = namedUnits(doc);
  const assets = doc.panelOrder.map((id) => ({
    id,
    originalFilename: doc.panels[id]!.name,
    ...context.evidence?.[doc.panels[id]!.assetId],
  }));
  const alias = (id: string) => units.find((u) => u.id === "panel:" + id)?.alias;
  let s = text.normalize("NFKC").trim();
  // Prefer a concrete name or panel letter to guessing what an ambiguous photo shows.
  const widthPattern =
    /(?:画布|整[张图]|单栏|双栏|版心|图稿?|canvas|figure|single.column|double.column)?\s*(?:宽度?|width|wide)?\s*(\d+(?:\.\d+)?)\s*(?:mm|毫米)(?:\s+(?:wide|width))?/gi;
  const explicitPanel = (part: string) =>
    units
      .filter((u) => new RegExp("(?<![a-z0-9])" + escape(u.alias) + "(?![a-z0-9])", "i").test(part))
      .map((u) => u.id);
  const idsFor = (part: string) => {
    const ids = explicitPanel(part);
    if (ids.length) return ids;
    if (/这[两几一]?张|选中|它|这组|these|selected|this (one|panel)/i.test(part) && context.selected?.length)
      return units
        .filter((u) => u.id.startsWith("panel:") && context.selected!.includes(u.id.slice(6)))
        .map((u) => u.id);
    if (context.explicitPanelsOnly) return [];
    const notes = Object.fromEntries(
      assets.map((a) => [a.id, context.notes?.[doc.panels[a.id]!.assetId] ?? ""]),
    );
    return assetMentions(part, assets, notes).flatMap((id) => (alias(id) ? ["panel:" + id] : []));
  };
  s = s.replace(
    /[,，;；。]\s*(?:其[余他](?:的)?(?:图|面板)?(?:都)?(?:不动|保持不变)|keep (?:everything|the others) (?:else )?(?:still|unchanged))\s*$/i,
    "",
  );
  if (/不要|别把|别让|别动|不需要|不(?:放大|缩小|用|要|并排)|do not|don.t|never|without/i.test(s))
    return { kind: "clarify", fragment: s };
  const subject = idsFor(s);
  const move =
    /(?:向|往)?(左|右|上|下|left|right|up|down)\s*(?:移[动]?|挪[动]?|by)?\s*(\d+(?:\.\d+)?)\s*(?:mm|毫米)/i.exec(
      s,
    );
  if (move && subject.length === 1 && subject[0]!.startsWith("panel:") && !/[,，；;]/.test(s)) {
    const n = Number(move[2]),
      dir = move[1]!.toLowerCase();
    return {
      kind: "move",
      panelId: subject[0]!.slice(6),
      dx: /左|left/.test(dir) ? -n : /右|right/.test(dir) ? n : 0,
      dy: /上|up/.test(dir) ? -n : /下|down/.test(dir) ? n : 0,
    };
  }
  const resize =
    /(?:放大|缩小|大一点|大一些|小一点|小一些|larger|smaller|bigger|enlarge|shrink|宽度?(?:设为|改为|调到)|set .+ width)/i;
  const panelWidth =
    /宽|width|wide/i.test(s) &&
    /(?:mm|毫米)/i.test(s) &&
    !/画布|整张|整图|版心|单栏|双栏|canvas|figure width|gap|间距|留白/i.test(s);
  if (
    (resize.test(s) || panelWidth) &&
    subject.length === 1 &&
    !/[,，;；。].+\S/.test(s) &&
    !/作为主图/.test(s)
  ) {
    const id = subject[0]!;
    if (!id.startsWith("panel:")) return { kind: "clarify", fragment: s };
    const width = [...s.matchAll(widthPattern)][0]?.[1];
    const percent = /(\d+(?:\.\d+)?)\s*%/.exec(s);
    const delta = percent ? Number(percent[1]) / 100 : 0.1;
    return {
      kind: "resize",
      panelId: id.slice(6),
      factor: 1 + (/缩小|小一点|小一些|smaller|shrink/i.test(s) ? -delta : delta),
      ...(width ? { width: Number(width) } : {}),
    };
  }
  let widthMm: number | undefined;
  let gap: number | undefined;
  let pair: { first: string; second: string; axis: "horizontal" | "vertical" } | undefined;
  let orderedPair: [string, string] | undefined;
  let bottom: string | undefined;
  let focus: string | undefined;
  let shape: "wide" | "tall" | "square" | undefined;
  const clauses = s.split(/[,，;；。!\n]+/).map(v => v.trim()).filter(Boolean);
  // A standalone figure number introduces the request. It does not identify a panel.
  const figureIntro = /^(?:(?:我(?:想要?|要|准备)?|请)?(?:做|画|排|制作)\s*|(?:i (?:want|need) to )?(?:make|prepare)\s+)?(?:fig(?:ure)?\.?\s*(?:\d+[a-z]?|one|two|three|four|five|six|seven|eight|nine|ten)|图\s*[\d一二三四五六七八九十]+|第[\d一二三四五六七八九十]+张图)$/i;
  for (const raw of clauses) {
    if (allImagesClause(raw, units.length) || (clauses.length > 1 && figureIntro.test(raw))) continue;
    let part = raw;
    if (
      /^(?:(?:目标|投稿)?期刊|(?:准备|打算)?投(?:稿(?:至|到)?)?\s*[A-Za-z]|(?:研究)?(?:方向|定位|领域)\s*[:：]|(?:target )?journal\s*[:：]|(?:research )?field\s*[:：])/i.test(
        part,
      )
    )
      continue;
    const spacing =
      /(?:间距|留白|spacing|gaps?)\s*(?:设为|改为|为|of|to)?\s*(\d+(?:\.\d+)?)\s*(?:mm|毫米)/i.exec(part);
    if (spacing) {
      gap = Number(spacing[1]);
      part = part.replace(spacing[0], "").trim();
    }
    const widths = [...part.matchAll(widthPattern)];
    if (widths.length) {
      if (
        widths.some((w) => widthMm !== undefined && widthMm !== Number(w[1])) ||
        new Set(widths.map((w) => w[1])).size > 1
      )
        return { kind: "clarify", fragment: raw };
      widthMm = Number(widths[0]![1]);
      part = part
        .replace(widthPattern, "")
        .replace(/^(?:at|to|width of|make (?:the )?figure)\s*$/i, "")
        .replace(
          /(?:我要|准备|排成|用|按|做成|投稿|投稿用|单栏|双栏|整张|总宽|宽度|画布|图宽|版心|^\s*宽\s*$)/g,
          "",
        )
        .trim();
    } else if (/^(?:我要|做成|按|用)?(?:投)?(?:单栏|single.column)$/i.test(part)) {
      widthMm ??= 85;
      part = "";
    }
    if (!part || automatic(part)) continue;
    const side = /^(?:把|将)?(.+?)(?:放在|放到|排在|摆在|放|在)(左|右)(?:边|面|侧)?$/u.exec(part)
      ?? /^(?:put |place )?(.+?)\s+(?:on|to) the (left|right)$/i.exec(part);
    if (side) {
      const hits = idsFor(side[1]!);
      const other = units.find(unit => unit.id !== hits[0]);
      if (hits.length !== 1 || units.length !== 2 || !other) return { kind: "clarify", fragment: raw };
      const left = /^(左|left)$/i.test(side[2]!) ? hits[0]! : other.id;
      if (orderedPair && orderedPair[0] !== left) return { kind: "clarify", fragment: raw };
      orderedPair = left === other.id ? [other.id, hits[0]!] : [hits[0]!, other.id];
      continue;
    }
    const genericPair =
      /^(?:(?:把|将)?(?:这)?(?:两|二|2)张(?:图)?|(?:the )?(?:two|both)(?: panels| figures| images)?)?\s*(?:左右)?(?:并排|并列|上下对比|side.by.side|stacked)(?:放置|摆放|排放|放)?$/iu.test(
        part,
      );
    const ids = genericPair && units.length === 2 ? units.map((u) => u.id) : idsFor(part);
    if (/(?:在下[面方排]|放下[面方排]|底部|below|bottom|underneath)/i.test(part) && ids.length === 1) {
      bottom = ids[0];
      continue;
    }
    if (/(?:并排|左右|并列|side.by.side|上下对比|stacked)/i.test(part) && ids.length === 2) {
      pair = {
        first: ids[0]!,
        second: ids[1]!,
        axis: /上下|stacked/i.test(part) ? "vertical" : "horizontal",
      };
      continue;
    }
    if (/主图|突出|重点展示|emphasiz|highlight/i.test(part) && ids.length === 1) {
      focus = ids[0];
      continue;
    }
    const parsed = parsePreferences(part, units);
    if (parsed.unresolved.length) return { kind: "clarify", fragment: part };
    const p = parsed.preferences;
    if (p.pair && p.pair.axis !== "any") pair = { ...p.pair, axis: p.pair.axis };
    if (p.pair?.axis === "any") pair = { ...p.pair, axis: "horizontal" };
    gap = p.gapMm ?? gap;
    focus = p.focus ?? focus;
    shape = p.shape ?? shape;
  }
  if ((gap !== undefined && gap > 30) || (widthMm !== undefined && widthMm <= 0))
    return { kind: "clarify", fragment: s };
  if (orderedPair) {
    if (bottom || focus || shape || pair?.axis === "vertical") return { kind: "clarify", fragment: s };
    return { kind: "layout", request: { family: "rows", rows: [orderedPair],
      ...(widthMm ? { canvasOverride: { widthMm } } : {}),
      ...(gap !== undefined ? { gutterOverrideMm: { horizontal: gap, vertical: gap } } : {}) } };
  }
  if (
    bottom &&
    (bottom === pair?.first || bottom === pair?.second || focus || shape || pair?.axis === "vertical")
  )
    return { kind: "clarify", fragment: s };
  if (bottom) {
    const others = units
      .map((u) => u.id)
      .filter((id) => id !== bottom && id !== pair?.first && id !== pair?.second);
    const rows: string[][] = pair ? [[pair.first, pair.second]] : [];
    for (let i = 0; i < others.length; i += 3) rows.push(others.slice(i, i + 3));
    rows.push([bottom]);
    return {
      kind: "layout",
      request: {
        family: "rows",
        rows,
        ...(widthMm ? { canvasOverride: { widthMm } } : {}),
        ...(gap !== undefined ? { gutterOverrideMm: { horizontal: gap, vertical: gap } } : {}),
      },
    };
  }
  if (pair || focus || shape)
    return {
      kind: "layout",
      request: {
        family: "guided",
        preferences: { pair, focus, shape, gapMm: gap },
        ...(widthMm ? { widthMm } : {}),
      },
    };
  const family =
    brief?.preference === "comparison" ? "rows" : brief?.preference === "emphasis" ? "hero-top" : "auto";
  gap ??= brief?.preference === "compact" ? 2 : undefined;
  return {
    kind: "layout",
    request: {
      family,
      ...(widthMm ? { canvasOverride: { widthMm } } : {}),
      ...(gap !== undefined ? { gutterOverrideMm: { horizontal: gap, vertical: gap } } : {}),
    },
  };
}
