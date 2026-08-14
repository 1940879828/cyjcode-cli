export type AssistantTurnPartKind = "text" | "tool" | "error";

export interface AssistantTurnPart {
  id: string;
  kind: AssistantTurnPartKind;
  content: string;
}

export interface AssistantTurn {
  id: string;
  role: "assistant";
  parts: AssistantTurnPart[];
  activeText: string;
  timestamp: number;
}

export function createAssistantTurn(id: string, timestamp: number): AssistantTurn {
  return {
    id,
    role: "assistant",
    parts: [],
    activeText: "",
    timestamp,
  };
}

export function appendAssistantTextDelta(
  turn: AssistantTurn,
  content: string,
): AssistantTurn {
  return {
    ...turn,
    activeText: turn.activeText + content,
  };
}

export function appendAssistantPart(
  turn: AssistantTurn,
  textPartId: string,
  part: AssistantTurnPart,
): AssistantTurn {
  const flushedTurn = flushAssistantText(turn, textPartId);
  return {
    ...flushedTurn,
    parts: [...flushedTurn.parts, part],
  };
}

export function replaceAssistantPart(
  turn: AssistantTurn,
  partId: string,
  part: AssistantTurnPart,
): AssistantTurn {
  if (!turn.parts.some((current) => current.id === partId)) return turn;
  return {
    ...turn,
    parts: turn.parts.map((current) => current.id === partId ? part : current),
  };
}

export function finalizeAssistantTurn(
  turn: AssistantTurn,
  textPartId: string,
  fallbackText: string,
): AssistantTurn {
  const turnWithFallback = hasAssistantTurnContent(turn)
    ? turn
    : appendAssistantTextDelta(turn, fallbackText);
  return flushAssistantText(turnWithFallback, textPartId);
}

export function hasAssistantTurnContent(turn: AssistantTurn): boolean {
  return turn.parts.length > 0 || turn.activeText.length > 0;
}

function flushAssistantText(turn: AssistantTurn, textPartId: string): AssistantTurn {
  if (!turn.activeText) {
    return turn;
  }

  return {
    ...turn,
    activeText: "",
    parts: [
      ...turn.parts,
      {
        id: textPartId,
        kind: "text",
        content: turn.activeText,
      },
    ],
  };
}
