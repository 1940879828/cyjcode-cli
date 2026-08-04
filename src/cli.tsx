import React from "react";
import { render } from "ink";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import pkg from "../package.json" with { type: "json" };
import { APP } from "./config/app.js";
import App from "./ui/App.js";
import LogViewer from "./ui/LogViewer.js";
import { setRecordPath, setMockPath } from "./devmock/index.js";

/**
 * 渲染 Ink 应用并处理退出。
 * waitUntilExit 会等待终端清理完成。
 */
async function renderWithCleanup(
  element: React.ReactElement,
  options: { exitOnCtrlC?: boolean } = {},
) {
  const { waitUntilExit } = render(element, {
    alternateScreen: false,
    exitOnCtrlC: options.exitOnCtrlC ?? true,
  });
  await waitUntilExit();
}

function startInk(element: React.ReactElement, options: { exitOnCtrlC?: boolean } = {}) {
  void renderWithCleanup(element, options).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}

yargs(hideBin(process.argv))
  .scriptName("tigacode")
  .usage("$0 [command]")
  .command(
    "$0",
    `启动 ${APP.name} 聊天界面`,
    (yargs) => {
      return yargs
        .option("record", {
          type: "string",
          describe: "录制会话数据到 mockdata/<name>.json",
        })
        .option("mock", {
          type: "string",
          describe: "mock 模式：从 mockdata/<name>.json 回放录制数据",
        });
    },
    (argv) => {
      const recordPath = argv.record as string | undefined;
      const mockPath = argv.mock as string | undefined;
      if (recordPath) setRecordPath(recordPath);
      if (mockPath) setMockPath(mockPath);
      startInk(React.createElement(App), { exitOnCtrlC: false });
    }
  )
  .command(
    "logs",
    "查看实时日志",
    () => {},
    () => {
      startInk(React.createElement(LogViewer));
    }
  )
  .version(pkg.version)
  .help()
  .parse();
