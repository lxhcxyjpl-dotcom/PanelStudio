import type { FigureDiscussionReply, FigureDocumentV1, UnitId } from "@panelstudio/contracts";

export function curatedPanelRows(document: FigureDocumentV1): string[][] {
  const sizes = document.curation?.rowSizes;
  if (!sizes || sizes.reduce((sum, count) => sum + count, 0) !== document.panelOrder.length) return [];
  let offset = 0;
  return sizes.map(size => {
    const row = document.panelOrder.slice(offset, offset + size);
    offset += size;
    return row;
  });
}

/** Previously paired panels stay together. Keep the author's panel labels in reading order. */
export function narrativeRows(document: FigureDocumentV1, proposal: FigureDiscussionReply, primary: string,
  existing = curatedPanelRows(document)) {
  const { panelOrder, panels } = document;
  const byAsset = new Map(panelOrder.map(id => [panels[id]!.assetId, id]));
  if (byAsset.size !== panelOrder.length || proposal.rows.flat().length !== byAsset.size ||
      new Set(proposal.rows.flat()).size !== byAsset.size || proposal.rows.some(row => row.some(id => !byAsset.has(id)))) return null;
  const planned = new Map(proposal.rows.flatMap((row, index) => row.map(id => [byAsset.get(id)!, index] as const)));
  const rows: string[][] = [];
  let mergePrevious = false;
  for (const row of existing.length ? existing : panelOrder.map(id => [id])) {
    if (row.length > 1) {
      // Opening a row of three gives the focus space while leaving its neighbors contiguous.
      // A two-panel comparison remains a unit even when one panel becomes the focus.
      if (row.length === 3 && row.includes(primary) && new Set(row.map(id => planned.get(id))).size > 1) {
        const at = row.indexOf(primary);
        rows.push(...[row.slice(0, at), [primary], row.slice(at + 1)].filter(group => group.length));
      } else rows.push(row);
      mergePrevious = false;
    } else {
      const id = row[0]!;
      const previous = rows.at(-1);
      if (mergePrevious && id !== primary && previous && previous.length < 3 && planned.get(previous[0]!) === planned.get(id)) previous.push(id);
      else rows.push(row.slice());
      mergePrevious = id !== primary;
    }
  }
  for (let index = 0; index + 1 < rows.length; index++) {
    const left = rows[index]!, right = rows[index + 1]!;
    if (left.length === 1 && right.length === 1 && comparableWide(document, [...left, ...right]))
      rows.splice(index, 2, [...left, ...right]);
  }
  return rows;
}

function comparableWide(document: FigureDocumentV1, row: string[]) {
  const ratios = row.map(id => {
    const { width, height } = document.panels[id]!.frameMm;
    return width / height;
  });
  return Math.min(...ratios) >= 2 && Math.max(...ratios) / Math.min(...ratios) <= 1.25;
}

/** Long, comparable plots get adjacent, equal-width rows. */
export function layoutNarrativeRows(document: FigureDocumentV1, panelRows: string[][], stackFocus?: string) {
  const unit = (id: string): UnitId => "panel:" + id;
  const alignedRows: UnitId[][] = [];
  const rows = panelRows.flatMap(row => {
    const shouldStack = row.length > 1 && (comparableWide(document, row) || Boolean(stackFocus && row.includes(stackFocus)));
    const units = row.map(unit);
    if (!shouldStack) return [units];
    alignedRows.push(units);
    return units.map(id => [id]);
  });
  return { rows, alignedRows };
}
