import type { QueryClient } from "@tanstack/react-query";
import type { i18n } from "i18next";
import type { StateCreator } from "zustand";
import type {} from "@radix-ui/react-dialog";
import type {} from "@radix-ui/react-dropdown-menu";
import type {} from "@radix-ui/react-popover";
import type {} from "@radix-ui/react-tooltip";
import type {} from "react-i18next";

/** Compile-time anchor for the locked editor stack. Phase 0 does not mount it. */
export type Phase0StackAnchor = {
  queryClient: QueryClient;
  createState: StateCreator<Record<string, never>>;
  i18n: i18n;
};
