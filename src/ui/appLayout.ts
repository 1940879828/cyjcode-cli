import { useLayoutEffect, useRef, useState } from "react";
import type { MutableRefObject } from "react";
import { measureElement, useWindowSize } from "ink";
import type { DOMElement } from "ink";
import {
  getInputColumns,
  getMaxVisibleInputLines,
} from "./components/InputBox/index.js";

const FALLBACK_FOOTER_HEIGHT = 4;

export interface AppLayout {
  footerRef: MutableRefObject<DOMElement | null>;
  screenWidth: number;
  screenHeight: number;
  inputColumns: number;
  maxVisibleInputLines: number;
  transcriptHeight: number;
}

export function useAppLayout(): AppLayout {
  const { columns, rows } = useWindowSize();
  const footerRef = useRef<DOMElement | null>(null);
  const [footerHeight, setFooterHeight] = useState(FALLBACK_FOOTER_HEIGHT);

  useLayoutEffect(() => {
    if (footerRef.current) {
      setFooterHeight(measureElement(footerRef.current).height);
    }
  });

  const screenWidth = columns || process.stdout.columns || 80;
  const screenHeight = rows || process.stdout.rows || 24;
  return {
    footerRef,
    screenWidth,
    screenHeight,
    inputColumns: getInputColumns(screenWidth),
    maxVisibleInputLines: getMaxVisibleInputLines(screenHeight),
    transcriptHeight: Math.max(1, screenHeight - footerHeight),
  };
}
