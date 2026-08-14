import { useEffect } from "react";
import {
  clearTerminalTitle,
  isTerminalTitleDisabled,
  setTerminalTitle,
} from "../terminalTitle.js";

export function useTerminalTitle(title: string | null): void {
  const disabled = isTerminalTitleDisabled();

  useEffect(() => {
    if (title === null || disabled) return;
    setTerminalTitle(title);
  }, [disabled, title]);

  useEffect(() => {
    if (disabled) return;
    return clearTerminalTitle;
  }, [disabled]);
}
