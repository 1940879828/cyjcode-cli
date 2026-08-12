import React from "react";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import { APP } from "./config/app.js";
import { getPackageVersion } from "./config/version.js";
import App from "./ui/App.js";
import LogViewer from "./ui/LogViewer.js";
import { startInk } from "./ui/renderInk.js";

yargs(hideBin(process.argv))
  .scriptName("tigacode")
  .usage("$0 [command]")
  .command(
    "$0",
    `启动 ${APP.name} 聊天界面`,
    () => {},
    () => {
      startInk(React.createElement(App), { exitOnCtrlC: false, alternateScreen: true });
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
  .version(getPackageVersion())
  .help()
  .parse();
