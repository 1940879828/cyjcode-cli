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

/**
 * 管理 Ctrl+C 退出流程：
 * - 同步防重复触发（exitingRef）
 * - 响应式"正在退出"状态（isExiting），供其他组件消费
 * - 等最后一帧刷新后再调用 exit()，避免终端样式残留
 */
export function useExit({ captureInput = true }: UseExitOptions = {}) {
  /** 是否正在退出，驱动 UI 禁用与退出副作用 */
  const [isExiting, setIsExiting] = useState(false);
  /** 同步标记退出，防止退出流程被重复触发 */
  const exitingRef = useRef(false);
  const { exit, waitUntilRenderFlush } = useApp();

  const requestExit = () => {
    requestExitOnce(exitingRef, setIsExiting);
  };

  useExitInput(captureInput && !isExiting, requestExit);
  useExitEffect(isExiting, waitUntilRenderFlush, exit);

  return { isExiting, requestExit };
}

function requestExitOnce(
  exitingRef: MutableRefObject<boolean>,
  setIsExiting: Dispatch<SetStateAction<boolean>>,
): void {
  if (exitingRef.current) return;
  exitingRef.current = true;
  setIsExiting(true);
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
