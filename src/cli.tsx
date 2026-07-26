import React from "react";
import { render } from "ink";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import App from "./ui/App.js";
import LogViewer from "./ui/LogViewer.js";

yargs(hideBin(process.argv))
  .scriptName("cyjcode")
  .usage("$0 [command]")
  .command(
    "$0",
    "启动 cyjcode 聊天界面",
    () => {},
    () => {
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
  .version("0.1.0")
  .help()
  .parse();
