import type { TranscriptRow, TranscriptRowKind } from "./transcriptTypes.js";

export const MIN_WRAP_WIDTH = 8;
export const HEADER_WIDTH = 60;
export const BORDER_COLOR = "#E6EBF2";
export const TIGA_RED = "#E24B5A";
export const TIMER_BLUE = "#55A8E8";
export const ENERGY_GOLD = "#FFD75F";
export const VALUE_COLOR = "#F5F7FF";
export const USER_PREFIX = "❯ ";
export const ASSISTANT_PREFIX = "● ";
export const CONTINUATION_PREFIX = "  ";

export const ROLE_STYLES: Record<TranscriptRowKind, Omit<TranscriptRow, "id" | "kind" | "text">> = {
  header: { color: "#E6EBF2" },
  spacer: {},
  system: {},
  user: { color: "#f5f5f5", backgroundColor: "#373737", bold: true },
  assistant: { color: "#f2f2f2" },
  thinking: { color: "yellow", dimColor: true },
  tool: { color: "yellow" },
  error: { color: "red" },
};

export const createSpacerRow = (id: string): TranscriptRow => ({
  id,
  kind: "spacer",
  text: "",
});
