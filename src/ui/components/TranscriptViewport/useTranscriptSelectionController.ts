import { useRef, useState } from "react";
import { copyTextToClipboard } from "../../clipboard.js";
import {
  buildSelectionRowRanges,
  reduceTranscriptSelectionEvent,
  type RowSelectionRange,
  type TranscriptSelectEvent,
  type TranscriptSelection,
} from "./transcriptSelection.js";
import type { TranscriptRow, TranscriptSourceUnit } from "./transcriptRows.js";

interface TranscriptSelectionController {
  selectionRanges: ReadonlyMap<string, RowSelectionRange>;
  handleSelectEvent: (event: TranscriptSelectEvent) => void;
  clearSelection: () => void;
}

/**
 * 选中生命周期：只在内容重建（/clear、新会话）时由 clearSelection 清空；
 * 滚动与流式追加因绑定源文本偏移保持稳定，无需重映射或清除。
 */
export function useTranscriptSelectionController({
  visibleRows,
  sources,
}: {
  visibleRows: readonly TranscriptRow[];
  sources: readonly TranscriptSourceUnit[];
}): TranscriptSelectionController {
  const [selection, setSelection] = useState<TranscriptSelection | null>(null);
  // 同一批输入里可能连续携带 press/motion/release，用 ref 保证归约按序生效
  const selectionRef = useRef(selection);

  const handleSelectEvent = (event: TranscriptSelectEvent) => {
    const result = reduceTranscriptSelectionEvent({
      event,
      selection: selectionRef.current,
      visibleRows,
      sources,
    });
    selectionRef.current = result.selection;
    if (result.copyText) copyTextToClipboard(result.copyText);
    setSelection(result.selection);
  };

  const clearSelection = () => {
    selectionRef.current = null;
    setSelection(null);
  };

  return {
    selectionRanges: buildSelectionRowRanges(selection, sources, visibleRows),
    handleSelectEvent,
    clearSelection,
  };
}
