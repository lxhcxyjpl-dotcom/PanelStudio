import { layoutUnitIds, type FigureDocumentV1, type GuidedPreferences } from "@panelstudio/contracts";
import { labelName } from "./changes";

export type NamedUnit = { id: string; name: string; alias: string };
export function namedUnits(doc: FigureDocumentV1): NamedUnit[] {
  return layoutUnitIds(doc).map((id) => {
    if (id.startsWith("group:")) {
      const g = doc.groups[id.slice(6)]!;
      return { id, name: g.name + " (" + g.panelIds.map((p) => labelName(doc, p)).join(", ") + ")", alias: g.name };
    }
    const name = labelName(doc, id.slice(6)) || doc.panels[id.slice(6)]!.name;
    return { id, name, alias: name.replace(/^[\s(（]+|[\s.)）]+$/gu, "") };
  });
}

const escape = (value: string) => value.replace(/[.*+?^$(){}|[\]\\]/g, "\\$&");
type Parsed = { preferences: GuidedPreferences; unresolved: string[] };
/** A deliberately small bilingual grammar. Every unhandled or contradictory clause
 * stays visible for review before any candidate can be requested. */
export function parsePreferences(text: string, units: NamedUnit[]): Parsed {
  const preferences: GuidedPreferences = {}, unresolved: string[] = [];
  const token = "(?:图|面板|panel\\s*)?\\s*@([0-9]+)@";
  const pairWords = "(?:和|与|跟|及|、|\\+|/|and|with)";
  const clauses = text.normalize("NFKC").split(/[，,；;。!！\n]+|\.(?!\d)|、(?=\s*(?:突出|强调|留白|间距|横版|竖版|[^\s、]{1,4}\s*(?:和|与)))|\s+and\s+(?=make|keep|use|place|group|put|emphasize|highlight)/iu)
    .map((s) => s.trim()).filter(Boolean);
  const aliases = units.flatMap((u, index) => u.alias ? [{ alias: u.alias.normalize("NFKC").toLowerCase(), index }] : [])
    .sort((a, b) => b.alias.length - a.alias.length);
  // Map names in a single pass so labels such as "1" cannot match parts of another token.
  const names = [...new Set(aliases.map((u) => u.alias))];
  const namePattern = names.length ? new RegExp("(?<![a-z0-9])(?:" + names.map(escape).join("|") + ")(?![a-z0-9])", "giu") : null;
  const source = new Map<keyof GuidedPreferences, string>();
  function set<K extends keyof GuidedPreferences>(k: K, value: NonNullable<GuidedPreferences[K]>, clause: string) {
    if (source.has(k) && JSON.stringify(preferences[k]) !== JSON.stringify(value)) {
      unresolved.push(source.get(k)!, clause);
      delete preferences[k];
    } else if (!source.has(k)) {
      preferences[k] = value;
      source.set(k, clause);
    }
  }
  for (const clause of clauses) {
    let s = clause.toLowerCase().replace(/^(?:我(?:希望|想要?|喜欢|偏好)|请|希望|最好|please)\s*/u, "").trim();
    const numeric = /^(?:图间距|面板间距|间距|间隔|留白|gaps?|spacing)\s*(?:为|设为|=|of)?\s*(\d+(?:[.点]\d+)?)\s*(?:mm|毫米)$/iu.exec(s);
    if (numeric && Number(numeric[1]!.replace("点", ".")) <= 30) {
      set("gapMm", Number(numeric[1]!.replace("点", ".")), clause); continue;
    }
    if (/^(?:紧凑(?:一些|一点|些|点)?|(?:间距|留白)(?:小|少)(?:一些|一点|些|点)?|compact|tight(?: spacing)?)$/u.test(s)) { set("gapMm", 2, clause); continue; }
    if (/^(?:疏朗|宽松|宽松一些|多(?:一点|一些|点|些)?留白|(?:留白|间距)(?:多|大|宽|充足)(?:一些|一点|些|点)?|airy|spacious|more (?:white\s?space|spacing))$/u.test(s)) { set("gapMm", 6, clause); continue; }
    const shapes: [RegExp, NonNullable<GuidedPreferences["shape"]>][] = [
      [/^(?:横版|横向(?:画布|构图|排版)?|宽幅|landscape|wide)$/u, "wide"],
      [/^(?:竖版|纵向(?:画布|构图|排版)?|竖向(?:构图|排版)?|portrait|tall)$/u, "tall"],
      [/^(?:近方形|方形(?:画布|构图)?|正方形|square)$/u, "square"],
    ];
    const shape = shapes.find(([pattern]) => pattern.test(s));
    if (shape) { set("shape", shape[1], clause); continue; }
    if (namePattern) s = s.replace(namePattern, (name) => {
      const hits = aliases.filter((u) => u.alias === name.toLowerCase());
      return hits.length === 1 ? "@" + hits[0]!.index + "@" : name;
    });
    const focus = new RegExp("^(?:突出|强调|放大|重点展示|emphasize|highlight|focus on)\\s*" + token + "$", "iu").exec(s)
      ?? new RegExp("^(?:把|让|以|make)?\\s*" + token + "\\s*(?:作为主图|为主图|做主图|为主|更突出|the (?:focus|focal point))$", "iu").exec(s);
    if (focus) { set("focus", units[Number(focus[1])]!.id, clause); continue; }
    const pair = new RegExp("^(?:把|让|将|place\\s+|put\\s+|group\\s+)?\\s*" + token + "\\s*" + pairWords + "\\s*" + token +
      "\\s*(放在一起|靠在一起|相邻|靠近|并排(?:放置|排列|放)?|左右(?:对比|排列|放)?|上下(?:对比|排列|排|放)?|并列|together|side by side|stacked|vertically|horizontally)$", "iu").exec(s);
    if (pair && pair[1] !== pair[2]) {
      const axis = /并排|左右|并列|side by side|horizontally/u.test(pair[3]!) ? "horizontal" : /上下|vertically|stacked/u.test(pair[3]!) ? "vertical" : "any";
      set("pair", { first: units[Number(pair[1])]!.id, second: units[Number(pair[2])]!.id, axis }, clause);
    } else unresolved.push(clause);
  }
  return { preferences, unresolved: [...new Set(unresolved)] };
}
