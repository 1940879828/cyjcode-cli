import {
  useState,
  useEffect,
  useRef,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import { useApp, useInput } from "ink";

interface UseExitOptions {
  captureInput?: boolean;
}

type ExitState = "idle" | "confirming" | "exiting";

const EXIT_CONFIRM_MESSAGE = "再按 Ctrl+C 退出";

/**
 * 管理 Ctrl+C 退出流程：
 * - 第一次 Ctrl+C 进入确认状态，第二次 Ctrl+C 真正退出
 * - 响应式"正在退出"状态（isExiting），供其他组件消费
 * - 等最后一帧刷新后再调用 exit()，避免终端样式残留
 */
export function useExit({ captureInput = true }: UseExitOptions = {}) {
  /** 是否正在退出，驱动 UI 禁用与退出副作用 */
  const [exitState, setExitState] = useState<ExitState>("idle");
  /** 同步标记退出阶段，避免连续按键读到过期 React 状态 */
  const exitStateRef = useRef<ExitState>("idle");
  const { exit, waitUntilRenderFlush } = useApp();
  const isExiting = exitState === "exiting";

  const requestExit = () => {
    requestExitConfirmation(exitStateRef, setExitState);
  };
  const cancelExitConfirmation = () => {
    cancelExit(exitStateRef, setExitState);
  };

  useExitInput(captureInput && !isExiting, requestExit);
  useExitEffect(isExiting, waitUntilRenderFlush, exit);

  return {
    isExiting,
    exitStatusMessage: exitState === "confirming" ? EXIT_CONFIRM_MESSAGE : null,
    cancelExitConfirmation,
    requestExit,
  };
}

function requestExitConfirmation(
  exitStateRef: MutableRefObject<ExitState>,
  setExitState: Dispatch<SetStateAction<ExitState>>,
): void {
  if (exitStateRef.current === "exiting") return;
  const nextState = exitStateRef.current === "confirming" ? "exiting" : "confirming";
  exitStateRef.current = nextState;
  setExitState(nextState);
}

function cancelExit(
  exitStateRef: MutableRefObject<ExitState>,
  setExitState: Dispatch<SetStateAction<ExitState>>,
): void {
  if (exitStateRef.current !== "confirming") return;
  exitStateRef.current = "idle";
  setExitState("idle");
}

function useExitInput(isActive: boolean, requestExit: () => void): void {
  useInput((input, key) => {
    if ((key.ctrl && input.toLowerCase() === "c") || input === "\u0003") requestExit();
  }, { isActive });
}

function useExitEffect(
  isExiting: boolean,
  waitUntilRenderFlush: () => Promise<void>,
  exit: () => void,
): void {
  useEffect(() => {
    if (!isExiting) return;

    let cancelled = false;
    void (async () => {
      await waitUntilRenderFlush();
      if (!cancelled) exit();
    })();

    return () => {
      cancelled = true;
    };
  }, [exit, isExiting, waitUntilRenderFlush]);
}
