import { useEffect, useRef, type RefObject } from "react";
import { useInput, usePaste } from "ink";
import type { Key } from "ink";
import type { TranscriptScrollAction } from "../components/TranscriptViewport/transcriptScroll.js";

const ENABLE_SGR_MOUSE = "\u001b[?1000h\u001b[?1006h";
const DISABLE_SGR_MOUSE = "\u001b[?1000l\u001b[?1006l";
const SGR_MOUSE_PATTERN = /(?:\u001b\[|\[)?<(\d+)(?:;\d+){2,}[mM]/g;
const LEGACY_MOUSE_PATTERN = /\u001b\[M.{3}/gs;

export interface ChatInputKey {
  pageUp?: boolean;
  pageDown?: boolean;
  home?: boolean;
  end?: boolean;
  ctrl?: boolean;
}

export type ChatInputRoute =
  | { type: "exit" }
  | { type: "scroll"; actions: TranscriptScrollAction[] }
  | { type: "input"; input: string; key: ChatInputKey }
  | { type: "mouse" }
  | { type: "ignore" };

export interface ChatInputRouteContext {
  isStreaming: boolean;
  isTranscriptPinnedToBottom: boolean;
  wheelRows: number;
}

export interface ChatInputRouterOptions {
  enabled: boolean;
  mouseTrackingEnabled: boolean;
  isStreaming: boolean;
  isTranscriptPinnedToBottom: boolean;
  wheelRows: number;
  requestExit: () => void;
  scroll: (action: TranscriptScrollAction) => void;
  handleInput: (input: string, key: Key) => void;
  handlePaste: (text: string) => void;
}

export const stripMouseInput = (input: string): string =>
  input
    .replace(SGR_MOUSE_PATTERN, "")
    .replace(LEGACY_MOUSE_PATTERN, "");

export const routeChatInput = (
  input: string,
  key: ChatInputKey,
  context: ChatInputRouteContext,
): ChatInputRoute => {
  if (isExitInput(input, key)) return { type: "exit" };

  const mouseRoute = routeMouseInput(input, context.wheelRows);
  if (mouseRoute) return mouseRoute;

  const keyboardScrollAction = getKeyboardScrollAction(input, key, context);
  if (keyboardScrollAction) return { type: "scroll", actions: [keyboardScrollAction] };

  if (context.isStreaming) return { type: "ignore" };

  return { type: "input", input, key };
};

function routeMouseInput(input: string, wheelRows: number): ChatInputRoute | null {
  const mouseActions = getMouseScrollActions(input, wheelRows);
  if (mouseActions.length > 0) return { type: "scroll", actions: mouseActions };
  return hasMouseInput(input) ? { type: "mouse" } : null;
}

export const getMouseScrollActions = (
  input: string,
  wheelRows: number,
): TranscriptScrollAction[] => {
  const actions: TranscriptScrollAction[] = [];
  for (const match of input.matchAll(SGR_MOUSE_PATTERN)) {
    if (match[1] === "64") {
      actions.push({ type: "lineUp", amount: wheelRows });
    }
    if (match[1] === "65") {
      actions.push({ type: "lineDown", amount: wheelRows });
    }
  }
  return actions;
};

export function useChatInputRouter(options: ChatInputRouterOptions) {
  const optionsRef = useRef(options);
  optionsRef.current = options;

  useRouteInput(optionsRef, options.enabled);
  useRoutePaste(optionsRef, options.enabled);
  useMouseTracking(options.enabled, options.mouseTrackingEnabled);
}

function useRouteInput(optionsRef: RefObject<ChatInputRouterOptions>, enabled: boolean): void {
  useInput((input, key) => {
    const current = optionsRef.current;
    const route = routeChatInput(input, key, toRouteContext(current));
    dispatchRoute(route, {
      requestExit: current.requestExit,
      scroll: current.scroll,
      handleInput: current.handleInput,
    });
  }, { isActive: enabled });
}

function useRoutePaste(optionsRef: RefObject<ChatInputRouterOptions>, enabled: boolean): void {
  usePaste((text) => {
    const current = optionsRef.current;
    if (!current.isStreaming) current.handlePaste(text);
  }, { isActive: enabled });
}

function useMouseTracking(enabled: boolean, mouseTrackingEnabled: boolean): void {
  useEffect(() => {
    if (!canTrackMouse(enabled, mouseTrackingEnabled)) return;
    process.stdout.write(ENABLE_SGR_MOUSE);
    return () => {
      process.stdout.write(DISABLE_SGR_MOUSE);
    };
  }, [enabled, mouseTrackingEnabled]);
}

function toRouteContext(options: ChatInputRouterOptions): ChatInputRouteContext {
  return {
    isStreaming: options.isStreaming,
    isTranscriptPinnedToBottom: options.isTranscriptPinnedToBottom,
    wheelRows: options.wheelRows,
  };
}

function canTrackMouse(enabled: boolean, mouseTrackingEnabled: boolean): boolean {
  return enabled && mouseTrackingEnabled && process.stdin.isTTY && process.stdout.isTTY;
}

const dispatchRoute = (
  route: ChatInputRoute,
  handlers: Pick<ChatInputRouterOptions, "requestExit" | "scroll" | "handleInput">,
) => {
  switch (route.type) {
    case "exit":
      handlers.requestExit();
      return;
    case "scroll":
      route.actions.forEach(handlers.scroll);
      return;
    case "input":
      handlers.handleInput(route.input, route.key as Key);
      return;
    case "mouse":
    case "ignore":
      return;
  }
};

const hasMouseInput = (input: string): boolean =>
  input.search(SGR_MOUSE_PATTERN) !== -1 || input.search(LEGACY_MOUSE_PATTERN) !== -1;

const isExitInput = (input: string, key: ChatInputKey): boolean =>
  (key.ctrl && input.toLowerCase() === "c") || input === "\u0003";

const getKeyboardScrollAction = (
  input: string,
  key: ChatInputKey,
  context: ChatInputRouteContext,
): TranscriptScrollAction | null => {
  return getGlobalScrollAction(key, context) ?? getStreamingScrollAction(input, key, context);
};

function getGlobalScrollAction(
  key: ChatInputKey,
  context: ChatInputRouteContext,
): TranscriptScrollAction | null {
  if (key.pageUp) return { type: "pageUp" };
  if (key.pageDown) return { type: "pageDown" };
  if (key.end && !context.isTranscriptPinnedToBottom) return { type: "bottom" };
  return null;
}

function getStreamingScrollAction(
  input: string,
  key: ChatInputKey,
  context: ChatInputRouteContext,
): TranscriptScrollAction | null {
  if (!context.isStreaming) return null;
  if (key.home) return { type: "top" };
  if (key.end) return { type: "bottom" };
  if (key.ctrl && input === "u") return { type: "lineUp", amount: getCtrlScrollAmount(context) };
  if (key.ctrl && input === "d") return { type: "lineDown", amount: getCtrlScrollAmount(context) };
  return null;
}

function getCtrlScrollAmount(context: ChatInputRouteContext): number {
  return Math.max(1, Math.floor(context.wheelRows * 1.5));
}
