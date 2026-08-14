import type React from "react";
import { render } from "ink";
import { flushLogs } from "../utils/logger.js";

export interface InkRenderOptions {
  exitOnCtrlC?: boolean;
  alternateScreen?: boolean;
}

async function renderWithCleanup(
  element: React.ReactElement,
  options: InkRenderOptions = {},
): Promise<void> {
  const { waitUntilExit } = render(element, {
    alternateScreen: options.alternateScreen ?? false,
    exitOnCtrlC: options.exitOnCtrlC ?? true,
  });
  try {
    await waitUntilExit();
  } finally {
    await flushLogs();
  }
}

export function startInk(
  element: React.ReactElement,
  options: InkRenderOptions = {},
): void {
  void renderWithCleanup(element, options).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
