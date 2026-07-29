import React from "react";
import { render } from "ink";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import pkg from "../package.json" with { type: "json" };
import App from "./ui/App.js";
import LogViewer from "./ui/LogViewer.js";
import { setRecordPath, setMockPath } from "./devmock/index.js";

yargs(hideBin(process.argv))
  .scriptName("cyjcode")
  .usage("$0 [command]")
  .command(
    "$0",
    "启动 cyjcode 聊天界面",
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
      const { waitUntilExit } = render(React.createElement(App));
      waitUntilExit().then(() => {
        process.exit(0);
      });
    }
  )
  .command(
    "logs",
    "查看实时日志",
    () => {},
    () => {
      const { waitUntilExit } = render(React.createElement(LogViewer));
      waitUntilExit().then(() => {
        process.exit(0);
      });
    }
  )
  .version(pkg.version)
  .help()
  .parse();
