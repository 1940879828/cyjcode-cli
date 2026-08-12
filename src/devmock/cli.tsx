import React from "react";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import { getPackageVersion } from "../config/version.js";
import App from "../ui/App.js";
import { startInk } from "../ui/renderInk.js";
import { createDevmockAgentRunner } from "./runner.js";

yargs(hideBin(process.argv))
  .scriptName("tigacode-devmock")
  .usage("$0 [options]")
  .option("record", {
    type: "string",
    describe: "录制会话数据到 mockdata/<name>.json",
  })
  .option("mock", {
    type: "string",
    describe: "从 mockdata/<name>.json 回放录制数据",
  })
  .check((argv) => {
    if (argv.record && argv.mock) {
      throw new Error("--record 与 --mock 不能同时使用");
    }
    return true;
  })
  .version(getPackageVersion())
  .help()
  .parseAsync()
  .then((argv) => {
    const agentRunner = createDevmockAgentRunner({
      recordPath: argv.record,
      mockPath: argv.mock,
    });
    startInk(React.createElement(App, { agentRunner }), {
      exitOnCtrlC: false,
      alternateScreen: true,
    });
  })
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
