import { describe, expect, it } from "vitest";
import { AI_ACTION_NAMES, DOMAIN_COMMAND_NAMES, RESOURCE_LIMITS } from "./constants.js";
import { AIActionSchema, AIIntentSchema } from "./ai.js";
import { DomainCommandSchema, TransactionRequestSchema } from "./commands.js";
import { ASSET_ID, expectInvalid, expectValid, PANEL_ID } from "./test-utils.js";

describe("domain commands", () => {
  it("uses the handbook command names once", () => {
    const names = commandNames(DomainCommandSchema);
    expect(names).toEqual([...DOMAIN_COMMAND_NAMES]);
    expect(new Set(names).size).toBe(names.length);
  });

  it("keeps AI actions separate from domain commands", () => {
    const actionNames = commandNames(AIActionSchema);
    expect(actionNames).toEqual([...AI_ACTION_NAMES]);
    expect(actionNames.some((name) => DOMAIN_COMMAND_NAMES.includes(name as never))).toBe(false);
  });

  it("accepts one transaction form and rejects a mix", () => {
    expectValid(TransactionRequestSchema, {
      baseRevision: 3,
      commands: [
        {
          type: "panel.add",
          panelId: PANEL_ID,
          assetId: ASSET_ID,
          frameMm: { x: 4, y: 4, width: 40, height: 30 },
        },
      ],
    });
    expectValid(TransactionRequestSchema, {
      baseRevision: 3,
      candidateId: PANEL_ID,
    });
    expectInvalid(TransactionRequestSchema, {
      baseRevision: 3,
      candidateId: PANEL_ID,
      commands: [],
    });
    expectInvalid(TransactionRequestSchema, { baseRevision: 3, commands: [] });
  });

  it("caps a transaction at 64 commands", () => {
    const command = {
      type: "panel.setLocked",
      panelIds: [PANEL_ID],
      locked: true,
    };
    expectInvalid(TransactionRequestSchema, {
      baseRevision: 1,
      commands: Array.from({ length: RESOURCE_LIMITS.maxCommandsPerTransaction + 1 }, () => command),
    });
  });
});

describe("AI intent", () => {
  it("accepts the handbook proposal example", () => {
    expectValid(AIIntentSchema, {
      version: 1,
      kind: "proposal",
      summary: "将 C 设为左侧主图，其他面板排列在右侧，间距调整为 3 mm。",
      actions: [
        { type: "set_gutter", horizontalMm: 3, verticalMm: 3 },
        { type: "set_label_style", patch: { fontWeight: 700 } },
        {
          type: "layout",
          request: {
            family: "hero-left",
            primaryPanelId: "11111111-1111-4111-8111-111111111111",
          },
        },
      ],
    });
  });

  it("rejects a free-form frame list and an unknown action", () => {
    expectInvalid(AIIntentSchema, {
      version: 1,
      kind: "proposal",
      summary: "no",
      actions: [{ type: "panel.setFrames", items: [] }],
    });
  });
});

function commandNames(schema: { anyOf: Array<{ properties: { type: { const: string } } }> }): string[] {
  return schema.anyOf.map((item) => item.properties.type.const);
}
