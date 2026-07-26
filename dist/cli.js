#!/usr/bin/env node

// src/cli.tsx
import React5 from "react";
import { render } from "ink";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";

// src/ui/App.tsx
import { useState as useState4, useCallback as useCallback4, useEffect } from "react";
import { Box as Box4, Text as Text4 } from "ink";

// src/config/store.ts
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
var CONFIG_DIR = path.join(os.homedir(), ".cyjcode");
var CONFIG_FILE = path.join(CONFIG_DIR, "config.json");
var DEFAULT_CONFIG = {
  baseUrl: "https://api.openai.com/v1",
  apiKey: "",
  model: "gpt-4o"
};
function ensureDir() {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }
}
function hasConfig() {
  return fs.existsSync(CONFIG_FILE);
}
function getConfig() {
  if (!hasConfig()) {
    return { ...DEFAULT_CONFIG };
  }
  const raw = fs.readFileSync(CONFIG_FILE, "utf-8");
  const parsed = JSON.parse(raw);
  return { ...DEFAULT_CONFIG, ...parsed };
}
function setConfig(config) {
  ensureDir();
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), "utf-8");
}
function getConfigPath() {
  return CONFIG_FILE;
}
function getConfigDir() {
  return CONFIG_DIR;
}

// src/ui/useChat.ts
import { useState, useCallback, useRef } from "react";

// src/llm/client.ts
import OpenAI from "openai";
function buildClient() {
  const config = getConfig();
  return new OpenAI({
    baseURL: config.baseUrl,
    apiKey: config.apiKey,
    dangerouslyAllowBrowser: false
  });
}
function toOpenAIMessages(messages2) {
  return messages2.map((msg) => {
    const base = {
      role: msg.role,
      content: msg.content
    };
    if (msg.name) base.name = msg.name;
    if (msg.tool_call_id) base.tool_call_id = msg.tool_call_id;
    if (msg.tool_calls) {
      base.tool_calls = msg.tool_calls.map((tc) => ({
        id: tc.id,
        type: "function",
        function: {
          name: tc.function.name,
          arguments: tc.function.arguments
        }
      }));
    }
    return base;
  });
}
async function* streamChat(options) {
  const config = getConfig();
  const client = buildClient();
  const openaiMessages = toOpenAIMessages(options.messages);
  try {
    const stream = await client.chat.completions.create({
      model: config.model,
      messages: openaiMessages,
      stream: true,
      ...options.tools && options.tools.length > 0 ? {
        tools: options.tools
      } : {}
    });
    const toolCallAccumulator = /* @__PURE__ */ new Map();
    let hasContent = false;
    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta;
      if (!delta) continue;
      if (delta.content) {
        hasContent = true;
        yield { type: "text_delta", content: delta.content };
      }
      if (delta.tool_calls) {
        const deltas = [];
        for (const tc of delta.tool_calls) {
          let acc = toolCallAccumulator.get(tc.index);
          if (!acc) {
            acc = { id: "", name: "", arguments: "" };
            toolCallAccumulator.set(tc.index, acc);
          }
          if (tc.id) acc.id = tc.id;
          if (tc.function?.name) acc.name += tc.function.name;
          if (tc.function?.arguments) acc.arguments += tc.function.arguments;
        }
        yield {
          type: "tool_call_delta",
          deltas: delta.tool_calls.map((tc) => ({
            index: tc.index,
            id: tc.id ?? void 0,
            type: tc.type,
            function: tc.function ? {
              name: tc.function.name ?? void 0,
              arguments: tc.function.arguments ?? void 0
            } : void 0
          }))
        };
      }
    }
    const finalMessage = {
      role: "assistant",
      content: null
    };
    if (hasContent && toolCallAccumulator.size === 0) {
      finalMessage.content = "";
    }
    if (toolCallAccumulator.size > 0) {
      finalMessage.tool_calls = Array.from(toolCallAccumulator.entries()).sort(([a], [b]) => a - b).map(([_, acc]) => ({
        id: acc.id,
        type: "function",
        function: {
          name: acc.name,
          arguments: acc.arguments
        }
      }));
    }
    yield { type: "done", message: finalMessage };
  } catch (error) {
    yield {
      type: "error",
      error: error instanceof Error ? error : new Error(String(error))
    };
  }
}

// src/tools/listDir.ts
import fs2 from "node:fs";
import path2 from "node:path";
var listDir = {
  name: "listDir",
  description: "\u5217\u51FA\u6307\u5B9A\u76EE\u5F55\u4E0B\u7684\u6587\u4EF6\u548C\u5B50\u76EE\u5F55\u3002\u8FD4\u56DE\u6587\u4EF6\u540D\u5217\u8868\u3002",
  parameters: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "\u8981\u5217\u51FA\u7684\u76EE\u5F55\u8DEF\u5F84\uFF0C\u76F8\u5BF9\u4E8E\u5F53\u524D\u5DE5\u4F5C\u76EE\u5F55\u3002\u9ED8\u8BA4\u4E3A\u5F53\u524D\u76EE\u5F55 '.'",
        default: "."
      },
      recursive: {
        type: "boolean",
        description: "\u662F\u5426\u9012\u5F52\u5217\u51FA\u6240\u6709\u5B50\u76EE\u5F55\u3002\u9ED8\u8BA4\u4E3A false",
        default: false
      }
    },
    required: []
  },
  execute(args) {
    const targetPath = args.path || ".";
    const recursive = args.recursive || false;
    const resolved = path2.resolve(targetPath);
    const cwd = process.cwd();
    if (!resolved.startsWith(cwd)) {
      return {
        success: false,
        error: `\u8DEF\u5F84\u7A7F\u8D8A\u62D2\u7EDD: ${targetPath}`
      };
    }
    try {
      if (!fs2.existsSync(resolved)) {
        return {
          success: false,
          error: `\u8DEF\u5F84\u4E0D\u5B58\u5728: ${targetPath}`
        };
      }
      const stat = fs2.statSync(resolved);
      if (!stat.isDirectory()) {
        return {
          success: false,
          error: `\u4E0D\u662F\u76EE\u5F55: ${targetPath}`
        };
      }
      const listDirRecursive = (dir, prefix) => {
        const entries = fs2.readdirSync(dir, { withFileTypes: true });
        const result = [];
        for (const entry of entries) {
          const fullPath = path2.join(prefix, entry.name);
          if (entry.isDirectory()) {
            result.push(`${fullPath}/`);
            if (recursive) {
              result.push(
                ...listDirRecursive(
                  path2.join(dir, entry.name),
                  fullPath
                )
              );
            }
          } else {
            result.push(fullPath);
          }
        }
        return result;
      };
      const files = listDirRecursive(resolved, targetPath === "." ? "" : targetPath);
      return {
        success: true,
        data: files.length > 0 ? files.join("\n") : "(\u7A7A\u76EE\u5F55)"
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }
};
var listDir_default = listDir;

// src/tools/search.ts
import { execSync } from "node:child_process";
import path3 from "node:path";
import fs3 from "node:fs";
var search = {
  name: "search",
  description: "\u5728\u6587\u4EF6\u4E2D\u641C\u7D22\u6307\u5B9A\u7684\u6587\u672C\u6A21\u5F0F\uFF08\u652F\u6301\u6B63\u5219\u8868\u8FBE\u5F0F\uFF09\u3002\u8FD4\u56DE\u5339\u914D\u7684\u884C\u53CA\u6240\u5728\u6587\u4EF6\u3002",
  parameters: {
    type: "object",
    properties: {
      pattern: {
        type: "string",
        description: "\u8981\u641C\u7D22\u7684\u6587\u672C\u6216\u6B63\u5219\u8868\u8FBE\u5F0F\u6A21\u5F0F"
      },
      path: {
        type: "string",
        description: "\u641C\u7D22\u8DEF\u5F84\uFF0C\u76F8\u5BF9\u4E8E\u5F53\u524D\u5DE5\u4F5C\u76EE\u5F55\u3002\u9ED8\u8BA4\u4E3A\u5F53\u524D\u76EE\u5F55 '.'",
        default: "."
      },
      fileTypes: {
        type: "string",
        description: "\u9650\u5B9A\u6587\u4EF6\u7C7B\u578B\uFF0C\u5982 '.ts,.js,.json'\u3002\u4E0D\u6307\u5B9A\u5219\u641C\u7D22\u6240\u6709\u6587\u4EF6"
      }
    },
    required: ["pattern"]
  },
  execute(args) {
    const pattern = args.pattern;
    const searchPath = args.path || ".";
    const fileTypes = args.fileTypes;
    if (!pattern) {
      return {
        success: false,
        error: "pattern \u53C2\u6570\u4E0D\u80FD\u4E3A\u7A7A"
      };
    }
    const resolved = path3.resolve(searchPath);
    const cwd = process.cwd();
    if (!resolved.startsWith(cwd)) {
      return {
        success: false,
        error: `\u8DEF\u5F84\u7A7F\u8D8A\u62D2\u7EDD: ${searchPath}`
      };
    }
    try {
      if (!fs3.existsSync(resolved)) {
        return {
          success: false,
          error: `\u8DEF\u5F84\u4E0D\u5B58\u5728: ${searchPath}`
        };
      }
      try {
        const globFlag = fileTypes ? fileTypes.split(",").map((t) => `-g '*${t.trim()}'`).join(" ") : "";
        const cmd = `rg --line-number --no-heading "${pattern}" "${resolved}" ${globFlag}`;
        const result = execSync(cmd, {
          encoding: "utf-8",
          maxBuffer: 10 * 1024 * 1024,
          timeout: 1e4
        });
        return {
          success: true,
          data: result.trim() || "\u6CA1\u6709\u627E\u5230\u5339\u914D\u9879"
        };
      } catch (rgError) {
      }
      const results = [];
      const searchRecursive = (dir) => {
        let entries;
        try {
          entries = fs3.readdirSync(dir, { withFileTypes: true });
        } catch {
          return;
        }
        for (const entry of entries) {
          const fullPath = path3.join(dir, entry.name);
          if (entry.isDirectory()) {
            if (entry.name === "node_modules" || entry.name === ".git") continue;
            searchRecursive(fullPath);
          } else if (entry.isFile()) {
            if (fileTypes) {
              const ext = path3.extname(entry.name);
              const allowed = fileTypes.split(",").map((t) => t.trim());
              if (!allowed.includes(ext)) continue;
            }
            try {
              const content = fs3.readFileSync(fullPath, "utf-8");
              const lines = content.split("\n");
              const regex = new RegExp(pattern, "gi");
              for (let i = 0; i < lines.length; i++) {
                if (regex.test(lines[i])) {
                  results.push(
                    `${path3.relative(cwd, fullPath)}:${i + 1}: ${lines[i].trim().substring(0, 200)}`
                  );
                  regex.lastIndex = 0;
                }
              }
            } catch {
            }
          }
        }
      };
      searchRecursive(resolved);
      return {
        success: true,
        data: results.length > 0 ? results.slice(0, 100).join("\n") : "\u6CA1\u6709\u627E\u5230\u5339\u914D\u9879"
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }
};
var search_default = search;

// src/tools/read.ts
import fs4 from "node:fs";
import path4 from "node:path";
var read = {
  name: "read",
  description: "\u8BFB\u53D6\u6307\u5B9A\u6587\u4EF6\u7684\u5185\u5BB9\u3002\u652F\u6301\u6307\u5B9A\u504F\u79FB\u91CF\u548C\u884C\u6570\u9650\u5236\u6765\u8BFB\u53D6\u6587\u4EF6\u7684\u90E8\u5206\u5185\u5BB9\u3002",
  parameters: {
    type: "object",
    properties: {
      filePath: {
        type: "string",
        description: "\u8981\u8BFB\u53D6\u7684\u6587\u4EF6\u8DEF\u5F84\uFF0C\u76F8\u5BF9\u4E8E\u5F53\u524D\u5DE5\u4F5C\u76EE\u5F55"
      },
      offset: {
        type: "number",
        description: "\u4ECE\u7B2C\u51E0\u884C\u5F00\u59CB\u8BFB\u53D6\uFF08\u4ECE 1 \u5F00\u59CB\uFF09\u3002\u4E0D\u6307\u5B9A\u5219\u4ECE\u5F00\u5934\u8BFB\u53D6"
      },
      limit: {
        type: "number",
        description: "\u6700\u591A\u8BFB\u53D6\u591A\u5C11\u884C\u3002\u4E0D\u6307\u5B9A\u5219\u8BFB\u53D6\u5168\u90E8"
      }
    },
    required: ["filePath"]
  },
  execute(args) {
    const filePath = args.filePath;
    const offset = args.offset;
    const limit = args.limit;
    if (!filePath) {
      return {
        success: false,
        error: "filePath \u53C2\u6570\u4E0D\u80FD\u4E3A\u7A7A"
      };
    }
    const resolved = path4.resolve(filePath);
    const cwd = process.cwd();
    if (!resolved.startsWith(cwd)) {
      return {
        success: false,
        error: `\u8DEF\u5F84\u7A7F\u8D8A\u62D2\u7EDD: ${filePath}`
      };
    }
    try {
      if (!fs4.existsSync(resolved)) {
        return {
          success: false,
          error: `\u6587\u4EF6\u4E0D\u5B58\u5728: ${filePath}`
        };
      }
      const stat = fs4.statSync(resolved);
      if (stat.isDirectory()) {
        return {
          success: false,
          error: `\u662F\u76EE\u5F55\u800C\u975E\u6587\u4EF6: ${filePath}`
        };
      }
      if (stat.size > 1024 * 1024) {
        return {
          success: false,
          error: `\u6587\u4EF6\u8FC7\u5927 (${(stat.size / 1024).toFixed(1)}KB)\uFF0C\u8D85\u8FC7 1MB \u9650\u5236`
        };
      }
      const content = fs4.readFileSync(resolved, "utf-8");
      const lines = content.split("\n");
      const startLine = (offset ?? 1) - 1;
      const endLine = limit ? Math.min(startLine + limit, lines.length) : lines.length;
      if (startLine < 0 || startLine >= lines.length) {
        return {
          success: false,
          error: `offset ${offset} \u8D85\u51FA\u6587\u4EF6\u884C\u6570\u8303\u56F4 (\u5171 ${lines.length} \u884C)`
        };
      }
      const sliced = lines.slice(startLine, endLine);
      const numbered = sliced.map((line, i) => `${startLine + i + 1}: ${line}`).join("\n");
      return {
        success: true,
        data: numbered || "(\u7A7A\u6587\u4EF6)"
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }
};
var read_default = read;

// src/tools/write.ts
import fs5 from "node:fs";
import path5 from "node:path";
var write = {
  name: "write",
  description: "\u5C06\u5185\u5BB9\u5199\u5165\uFF08\u521B\u5EFA\u6216\u8986\u76D6\uFF09\u6307\u5B9A\u6587\u4EF6\u3002\u4EC5\u5728\u5F53\u524D\u5DE5\u4F5C\u76EE\u5F55\u4E0B\u5141\u8BB8\u5199\u5165\u3002",
  parameters: {
    type: "object",
    properties: {
      filePath: {
        type: "string",
        description: "\u8981\u5199\u5165\u7684\u6587\u4EF6\u8DEF\u5F84\uFF0C\u76F8\u5BF9\u4E8E\u5F53\u524D\u5DE5\u4F5C\u76EE\u5F55"
      },
      content: {
        type: "string",
        description: "\u8981\u5199\u5165\u7684\u6587\u4EF6\u5185\u5BB9"
      }
    },
    required: ["filePath", "content"]
  },
  execute(args) {
    const filePath = args.filePath;
    const content = args.content;
    if (!filePath) {
      return {
        success: false,
        error: "filePath \u53C2\u6570\u4E0D\u80FD\u4E3A\u7A7A"
      };
    }
    if (content === void 0 || content === null) {
      return {
        success: false,
        error: "content \u53C2\u6570\u4E0D\u80FD\u4E3A\u7A7A"
      };
    }
    const resolved = path5.resolve(filePath);
    const cwd = process.cwd();
    if (!resolved.startsWith(cwd)) {
      return {
        success: false,
        error: `\u8DEF\u5F84\u7A7F\u8D8A\u62D2\u7EDD: ${filePath}`
      };
    }
    try {
      const dir = path5.dirname(resolved);
      if (!fs5.existsSync(dir)) {
        fs5.mkdirSync(dir, { recursive: true });
      }
      fs5.writeFileSync(resolved, content, "utf-8");
      const size = Buffer.byteLength(content, "utf-8");
      return {
        success: true,
        data: `\u6210\u529F\u5199\u5165 ${filePath} (${size} \u5B57\u8282)`
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }
};
var write_default = write;

// src/tools/rename.ts
import fs6 from "node:fs";
import path6 from "node:path";
var rename = {
  name: "rename",
  description: "\u91CD\u547D\u540D\u6216\u79FB\u52A8\u6587\u4EF6/\u76EE\u5F55\u3002\u4EC5\u5141\u8BB8\u5728\u5F53\u524D\u5DE5\u4F5C\u76EE\u5F55\u4E0B\u64CD\u4F5C\u3002",
  parameters: {
    type: "object",
    properties: {
      oldPath: {
        type: "string",
        description: "\u539F\u6587\u4EF6\u8DEF\u5F84\uFF0C\u76F8\u5BF9\u4E8E\u5F53\u524D\u5DE5\u4F5C\u76EE\u5F55"
      },
      newPath: {
        type: "string",
        description: "\u65B0\u6587\u4EF6\u8DEF\u5F84\uFF0C\u76F8\u5BF9\u4E8E\u5F53\u524D\u5DE5\u4F5C\u76EE\u5F55"
      }
    },
    required: ["oldPath", "newPath"]
  },
  execute(args) {
    const oldPath = args.oldPath;
    const newPath = args.newPath;
    if (!oldPath) {
      return {
        success: false,
        error: "oldPath \u53C2\u6570\u4E0D\u80FD\u4E3A\u7A7A"
      };
    }
    if (!newPath) {
      return {
        success: false,
        error: "newPath \u53C2\u6570\u4E0D\u80FD\u4E3A\u7A7A"
      };
    }
    const resolvedOld = path6.resolve(oldPath);
    const resolvedNew = path6.resolve(newPath);
    const cwd = process.cwd();
    if (!resolvedOld.startsWith(cwd)) {
      return {
        success: false,
        error: `\u8DEF\u5F84\u7A7F\u8D8A\u62D2\u7EDD: ${oldPath}`
      };
    }
    if (!resolvedNew.startsWith(cwd)) {
      return {
        success: false,
        error: `\u8DEF\u5F84\u7A7F\u8D8A\u62D2\u7EDD: ${newPath}`
      };
    }
    try {
      if (!fs6.existsSync(resolvedOld)) {
        return {
          success: false,
          error: `\u539F\u8DEF\u5F84\u4E0D\u5B58\u5728: ${oldPath}`
        };
      }
      const newDir = path6.dirname(resolvedNew);
      if (!fs6.existsSync(newDir)) {
        fs6.mkdirSync(newDir, { recursive: true });
      }
      fs6.renameSync(resolvedOld, resolvedNew);
      return {
        success: true,
        data: `\u6210\u529F\u91CD\u547D\u540D: ${oldPath} \u2192 ${newPath}`
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }
};
var rename_default = rename;

// src/tools/index.ts
var allTools = [listDir_default, search_default, read_default, write_default, rename_default];
var toolMap = /* @__PURE__ */ new Map();
for (const tool of allTools) {
  toolMap.set(tool.name, tool);
}
function getTool(name) {
  return toolMap.get(name);
}
function toolsToOpenAI() {
  return allTools.map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters
    }
  }));
}

// src/agent/prompt.ts
function buildSystemPrompt() {
  const toolDescriptions = allTools.map((t) => `- ${t.name}: ${t.description}`).join("\n");
  return `\u4F60\u662F\u4E00\u4E2A\u7EC8\u7AEF\u7F16\u7A0B\u52A9\u624B (cyjcode-cli)\uFF0C\u8FD0\u884C\u5728\u7528\u6237\u7684\u672C\u5730\u73AF\u5883\u4E2D\u3002

\u5F53\u524D\u5DE5\u4F5C\u76EE\u5F55: ${process.cwd()}

\u4F60\u53EF\u4EE5\u4F7F\u7528\u4EE5\u4E0B\u5DE5\u5177\u6765\u5E2E\u52A9\u7528\u6237\u5B8C\u6210\u6587\u4EF6\u64CD\u4F5C\u548C\u4EE3\u7801\u641C\u7D22:
${toolDescriptions}

\u884C\u4E3A\u51C6\u5219:
- \u4F7F\u7528\u7528\u6237\u7684\u8BED\u8A00\u56DE\u590D\uFF08\u4E2D\u6587\u7528\u6237\u7528\u4E2D\u6587\u56DE\u590D\uFF09
- \u5728\u5BF9\u6587\u4EF6\u8FDB\u884C\u64CD\u4F5C\u4E4B\u524D\uFF0C\u5148\u8BFB\u53D6\u6587\u4EF6\u5185\u5BB9\u4E86\u89E3\u4E0A\u4E0B\u6587
- \u5199\u5165\u6587\u4EF6\u540E\u544A\u77E5\u7528\u6237\u5199\u5165\u7ED3\u679C
- \u5F53\u7528\u6237\u8981\u6C42\u6267\u884C\u8BA1\u5212\u65F6\uFF0C\u6309\u6B65\u9AA4\u9010\u6B65\u5B8C\u6210\uFF0C\u6BCF\u5B8C\u6210\u4E00\u6B65\u6C47\u62A5\u8FDB\u5EA6
- \u5DE5\u5177\u8C03\u7528\u53C2\u6570\u4F7F\u7528\u5408\u6CD5\u7684 JSON \u683C\u5F0F
- \u4E0D\u8981\u8BBF\u95EE\u5DE5\u4F5C\u76EE\u5F55\u4E4B\u5916\u7684\u6587\u4EF6`;
}

// src/agent/history.ts
var messages = [];
function addMessage(msg) {
  messages.push(msg);
}
function getMessages() {
  return [...messages];
}
function appendToolResult(toolCallId, toolName, result) {
  messages.push({
    role: "tool",
    content: result,
    tool_call_id: toolCallId,
    name: toolName
  });
}
function clearHistory() {
  messages.length = 0;
}

// src/utils/logger.ts
import fs7 from "node:fs";
import path7 from "node:path";
var LOGS_DIR = path7.join(getConfigDir(), "logs");
function getLogFilePath() {
  const now = /* @__PURE__ */ new Date();
  const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  return path7.join(LOGS_DIR, `${dateStr}.jsonl`);
}
function ensureLogDir() {
  if (!fs7.existsSync(LOGS_DIR)) {
    fs7.mkdirSync(LOGS_DIR, { recursive: true });
  }
}
function log(type, data = {}) {
  ensureLogDir();
  const entry = {
    timestamp: (/* @__PURE__ */ new Date()).toISOString(),
    type,
    data
  };
  const line = JSON.stringify(entry) + "\n";
  fs7.appendFileSync(getLogFilePath(), line, "utf-8");
}
function getTodayLogPath() {
  ensureLogDir();
  return getLogFilePath();
}
function readLogLines(fileName, offset = 0) {
  const filePath = path7.join(LOGS_DIR, fileName);
  if (!fs7.existsSync(filePath)) return [];
  const content = fs7.readFileSync(filePath, "utf-8");
  const lines = content.trim().split("\n");
  return lines.slice(offset);
}

// src/agent/loop.ts
var MAX_ROUNDS = 10;
async function* runAgentLoop(userMessage) {
  const sessionId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  log("session.start", { sessionId, userMessage });
  yield { type: "user_message", content: userMessage };
  addMessage({ role: "user", content: userMessage });
  const systemPrompt = buildSystemPrompt();
  const tools = toolsToOpenAI();
  let totalTokens = 0;
  for (let turn = 1; turn <= MAX_ROUNDS; turn++) {
    yield { type: "turn_start", turn };
    const messages2 = [
      { role: "system", content: systemPrompt },
      ...getMessages()
    ];
    log("llm.request", {
      sessionId,
      turn,
      model: systemPrompt,
      // 实际 model 在 client 中读取
      messageCount: messages2.length
    });
    let fullText = "";
    let hasToolCalls = false;
    let doneToolCalls = [];
    try {
      const stream = streamChat({ messages: messages2, tools });
      for await (const event of stream) {
        switch (event.type) {
          case "text_delta":
            fullText += event.content;
            yield { type: "text_delta", content: event.content };
            break;
          case "tool_call_delta":
            break;
          case "done": {
            const msg = event.message;
            if (msg.tool_calls && msg.tool_calls.length > 0) {
              hasToolCalls = true;
              doneToolCalls = msg.tool_calls;
            }
            log("llm.response", {
              sessionId,
              turn,
              hasToolCalls,
              toolCallCount: doneToolCalls?.length || 0,
              responseLength: fullText.length,
              totalTokens
            });
            break;
          }
          case "error":
            log("error", { sessionId, turn, message: event.error.message });
            yield { type: "error", error: event.error.message };
            yield { type: "turn_end", turn };
            log("session.end", { sessionId, status: "error", totalTurns: turn });
            return;
        }
      }
      if (fullText && !hasToolCalls) {
        addMessage({ role: "assistant", content: fullText });
        yield { type: "turn_end", turn };
        yield { type: "done", fullText };
        log("session.end", { sessionId, status: "success", totalTurns: turn, totalTokens });
        return;
      }
      if (!hasToolCalls) {
        yield { type: "turn_end", turn };
        yield { type: "done", fullText: fullText || "\uFF08\u65E0\u56DE\u590D\u5185\u5BB9\uFF09" };
        log("session.end", { sessionId, status: "success", totalTurns: turn, totalTokens });
        return;
      }
      const assistantMsg = {
        role: "assistant",
        content: fullText || null,
        tool_calls: doneToolCalls
      };
      addMessage(assistantMsg);
      for (const tc of doneToolCalls) {
        let parsedArgs;
        try {
          parsedArgs = JSON.parse(tc.function.arguments);
        } catch {
          log("tool.start", { sessionId, turn, tool: tc.function.name, args: tc.function.arguments });
          log("tool.end", { sessionId, turn, tool: tc.function.name, success: false, error: "JSON \u89E3\u6790\u5931\u8D25" });
          yield {
            type: "tool_call",
            callId: tc.id,
            name: tc.function.name,
            arguments: {}
          };
          yield {
            type: "tool_result",
            callId: tc.id,
            name: tc.function.name,
            result: {
              success: false,
              error: `\u5DE5\u5177\u53C2\u6570 JSON \u89E3\u6790\u5931\u8D25: ${tc.function.arguments}`
            }
          };
          appendToolResult(
            tc.id,
            tc.function.name,
            `\u9519\u8BEF: \u5DE5\u5177\u53C2\u6570 JSON \u89E3\u6790\u5931\u8D25: ${tc.function.arguments}`
          );
          continue;
        }
        yield {
          type: "tool_call",
          callId: tc.id,
          name: tc.function.name,
          arguments: parsedArgs
        };
        const tool = getTool(tc.function.name);
        if (!tool) {
          log("tool.start", { sessionId, turn, tool: tc.function.name, args: parsedArgs });
          log("tool.end", { sessionId, turn, tool: tc.function.name, success: false, error: "\u672A\u6CE8\u518C\u7684\u5DE5\u5177" });
          const errorResult = {
            success: false,
            error: `\u672A\u6CE8\u518C\u7684\u5DE5\u5177: ${tc.function.name}`
          };
          yield {
            type: "tool_result",
            callId: tc.id,
            name: tc.function.name,
            result: errorResult
          };
          appendToolResult(
            tc.id,
            tc.function.name,
            `\u9519\u8BEF: \u672A\u6CE8\u518C\u7684\u5DE5\u5177: ${tc.function.name}`
          );
          continue;
        }
        log("tool.start", { sessionId, turn, tool: tc.function.name, args: parsedArgs });
        let result;
        try {
          result = await tool.execute(parsedArgs);
        } catch (err) {
          result = {
            success: false,
            error: err instanceof Error ? err.message : String(err)
          };
        }
        log("tool.end", {
          sessionId,
          turn,
          tool: tc.function.name,
          success: result.success,
          error: result.success ? void 0 : result.error
        });
        yield {
          type: "tool_result",
          callId: tc.id,
          name: tc.function.name,
          result
        };
        const resultStr = result.success ? result.data ?? "\u6210\u529F" : `\u9519\u8BEF: ${result.error}`;
        appendToolResult(tc.id, tc.function.name, resultStr);
      }
      yield { type: "turn_end", turn };
    } catch (error) {
      log("error", {
        sessionId,
        turn,
        message: error instanceof Error ? error.message : String(error)
      });
      yield {
        type: "error",
        error: error instanceof Error ? error.message : String(error)
      };
      yield { type: "turn_end", turn };
      log("session.end", { sessionId, status: "error", totalTurns: turn });
      return;
    }
  }
  log("error", { sessionId, message: `\u8FBE\u5230\u6700\u5927\u8F6E\u6570\u9650\u5236 (${MAX_ROUNDS})` });
  log("session.end", { sessionId, status: "max_rounds", totalTurns: MAX_ROUNDS });
  yield {
    type: "error",
    error: `\u5DF2\u8FBE\u5230\u6700\u5927\u5DE5\u5177\u8C03\u7528\u8F6E\u6570 (${MAX_ROUNDS})\uFF0C\u7EC8\u6B62\u5FAA\u73AF`
  };
}

// src/ui/useChat.ts
var entryId = 0;
function nextId() {
  return `msg_${++entryId}`;
}
function useChat() {
  const [entries, setEntries] = useState([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingText, setStreamingText] = useState("");
  const abortRef = useRef(null);
  const sendMessage = useCallback(async (text) => {
    if (isStreaming) return;
    if (!text.trim()) return;
    const userEntry = {
      id: nextId(),
      role: "user",
      content: text,
      timestamp: Date.now()
    };
    setEntries((prev) => [...prev, userEntry]);
    setIsStreaming(true);
    setStreamingText("");
    let currentStreamingText = "";
    try {
      const loop = runAgentLoop(text);
      for await (const event of loop) {
        switch (event.type) {
          case "text_delta":
            currentStreamingText += event.content;
            setStreamingText(currentStreamingText);
            break;
          case "tool_call": {
            const tcEntry = {
              id: nextId(),
              role: "tool_call",
              content: `\u8C03\u7528\u5DE5\u5177: ${event.name}`,
              toolCall: {
                callId: event.callId,
                name: event.name,
                arguments: event.arguments
              },
              timestamp: Date.now()
            };
            setEntries((prev) => [...prev, tcEntry]);
            break;
          }
          case "tool_result": {
            const trEntry = {
              id: nextId(),
              role: "tool_result",
              content: event.result.success ? event.result.data || "\u6210\u529F" : `\u9519\u8BEF: ${event.result.error}`,
              toolResult: {
                callId: event.callId,
                name: event.name,
                result: event.result
              },
              timestamp: Date.now()
            };
            setEntries((prev) => [...prev, trEntry]);
            break;
          }
          case "done": {
            const assistantEntry = {
              id: nextId(),
              role: "assistant",
              content: event.fullText || currentStreamingText,
              timestamp: Date.now()
            };
            setStreamingText("");
            setEntries((prev) => [...prev, assistantEntry]);
            break;
          }
          case "error": {
            const errorEntry = {
              id: nextId(),
              role: "error",
              content: `\u9519\u8BEF: ${event.error}`,
              timestamp: Date.now()
            };
            setEntries((prev) => [...prev, errorEntry]);
            break;
          }
        }
      }
    } catch (err) {
      const errorEntry = {
        id: nextId(),
        role: "error",
        content: `\u9519\u8BEF: ${err instanceof Error ? err.message : String(err)}`,
        timestamp: Date.now()
      };
      setEntries((prev) => [...prev, errorEntry]);
    } finally {
      setIsStreaming(false);
      setStreamingText("");
    }
  }, [isStreaming]);
  const clearChat = useCallback(() => {
    setEntries([]);
    clearHistory();
  }, []);
  return {
    entries,
    isStreaming,
    streamingText,
    sendMessage,
    clearChat
  };
}

// src/ui/MessageList.tsx
import { Box, Text } from "ink";
import { jsx, jsxs } from "react/jsx-runtime";
var roleColors = {
  user: "green",
  assistant: "cyan",
  tool_call: "yellow",
  tool_result: "gray",
  error: "red"
};
var roleLabels = {
  user: "You",
  assistant: "cyjcode",
  tool_call: "Tool",
  tool_result: "Result",
  error: "Error"
};
var MessageList = ({ entries, streamingText, isStreaming }) => {
  const displayEntries = entries.length > 20 ? entries.slice(-20) : entries;
  return /* @__PURE__ */ jsxs(Box, { flexDirection: "column", marginBottom: 1, children: [
    displayEntries.length === 0 && !isStreaming && /* @__PURE__ */ jsx(Box, { children: /* @__PURE__ */ jsx(Text, { color: "gray", children: "\u8F93\u5165\u6D88\u606F\u5F00\u59CB\u5BF9\u8BDD\uFF0C\u8F93\u5165 /help \u67E5\u770B\u5E2E\u52A9" }) }),
    displayEntries.map((entry) => /* @__PURE__ */ jsxs(Box, { flexDirection: "column", marginBottom: 1, children: [
      /* @__PURE__ */ jsxs(Text, { color: roleColors[entry.role] || "white", bold: true, children: [
        roleLabels[entry.role] || entry.role,
        ":"
      ] }),
      /* @__PURE__ */ jsx(Box, { paddingLeft: 2, children: entry.role === "tool_call" && entry.toolCall ? /* @__PURE__ */ jsxs(Box, { flexDirection: "column", children: [
        /* @__PURE__ */ jsx(Text, { color: "yellow", children: entry.toolCall.name }),
        /* @__PURE__ */ jsx(Text, { color: "gray", dimColor: true, children: JSON.stringify(entry.toolCall.arguments, null, 2) })
      ] }) : entry.role === "tool_result" && entry.toolResult ? /* @__PURE__ */ jsx(Box, { flexDirection: "column", children: entry.toolResult.result.success ? /* @__PURE__ */ jsx(Text, { color: "green", children: entry.content }) : /* @__PURE__ */ jsx(Text, { color: "red", children: entry.content }) }) : /* @__PURE__ */ jsx(Text, { color: roleColors[entry.role] || "white", children: entry.content }) })
    ] }, entry.id)),
    isStreaming && streamingText && /* @__PURE__ */ jsxs(Box, { flexDirection: "column", marginBottom: 1, children: [
      /* @__PURE__ */ jsx(Text, { color: "cyan", bold: true, children: "cyjcode:" }),
      /* @__PURE__ */ jsx(Box, { paddingLeft: 2, children: /* @__PURE__ */ jsx(Text, { color: "cyan", children: streamingText }) })
    ] })
  ] });
};
var MessageList_default = MessageList;

// src/ui/InputBox.tsx
import { useState as useState2, useCallback as useCallback2 } from "react";
import { Box as Box2, Text as Text2 } from "ink";
import { useInput } from "ink";
import { jsx as jsx2, jsxs as jsxs2 } from "react/jsx-runtime";
var InputBox = ({ onSubmit, disabled }) => {
  const [input, setInput] = useState2("");
  useInput(
    useCallback2(
      (inputChar, key) => {
        if (disabled) return;
        if (key.return) {
          const trimmed = input.trim();
          if (trimmed) {
            onSubmit(trimmed);
            setInput("");
          }
        } else if (key.backspace || key.delete) {
          setInput((prev) => prev.slice(0, -1));
        } else {
          if (inputChar && inputChar.length === 1 && inputChar.charCodeAt(0) >= 32) {
            setInput((prev) => prev + inputChar);
          }
        }
      },
      [input, disabled, onSubmit]
    )
  );
  return /* @__PURE__ */ jsxs2(Box2, { flexDirection: "column", borderStyle: "single", paddingX: 1, children: [
    /* @__PURE__ */ jsxs2(Box2, { children: [
      /* @__PURE__ */ jsxs2(Text2, { color: "green", bold: true, children: [
        "\u25B8",
        " "
      ] }),
      /* @__PURE__ */ jsx2(Text2, { color: disabled ? "gray" : "white", children: input }),
      !disabled && /* @__PURE__ */ jsx2(Text2, { color: "gray", children: "|" })
    ] }),
    disabled && /* @__PURE__ */ jsx2(Box2, { children: /* @__PURE__ */ jsx2(Text2, { color: "gray", dimColor: true, children: "\u7B49\u5F85\u56DE\u590D\u4E2D\u2026\u2026" }) })
  ] });
};
var InputBox_default = InputBox;

// src/ui/commands.ts
var commands = [
  {
    name: "/help",
    description: "\u663E\u793A\u6240\u6709\u53EF\u7528\u547D\u4EE4",
    handler: () => {
      const lines = ["\u53EF\u7528\u547D\u4EE4:", ""];
      for (const cmd of commands) {
        lines.push(`  ${cmd.name.padEnd(15)} ${cmd.description}`);
      }
      return lines.join("\n");
    }
  },
  {
    name: "/config",
    description: "\u663E\u793A\u5F53\u524D\u914D\u7F6E",
    handler: () => {
      const config = getConfig();
      const lines = [
        "\u5F53\u524D\u914D\u7F6E:",
        "",
        `  \u914D\u7F6E\u6587\u4EF6: ${getConfigPath()}`,
        `  API Base URL: ${config.baseUrl}`,
        `  API Key: ${config.apiKey ? config.apiKey.slice(0, 8) + "..." + (config.apiKey.length > 8 ? config.apiKey.slice(-4) : "") : "(\u672A\u8BBE\u7F6E)"}`,
        `  Model: ${config.model}`
      ];
      return lines.join("\n");
    }
  },
  {
    name: "/clear",
    description: "\u6E05\u7A7A\u5BF9\u8BDD\u5386\u53F2",
    handler: () => ""
  }
];
function matchCommand(input) {
  const trimmed = input.trim();
  if (!trimmed.startsWith("/")) return null;
  return commands.find((c) => c.name === trimmed) || null;
}

// src/ui/SetupWizard.tsx
import React2, { useState as useState3, useCallback as useCallback3 } from "react";
import { Box as Box3, Text as Text3 } from "ink";
import { useInput as useInput2 } from "ink";
import { jsx as jsx3, jsxs as jsxs3 } from "react/jsx-runtime";
var stepOrder = ["baseUrl", "apiKey", "model", "confirm"];
var SetupWizard = ({ onComplete }) => {
  const [currentStep, setCurrentStep] = useState3("baseUrl");
  const [baseUrl, setBaseUrl] = useState3("https://api.openai.com/v1");
  const [apiKey, setApiKey] = useState3("");
  const [model, setModel] = useState3("gpt-4o");
  const [inputValue, setInputValue] = useState3("");
  const [showMasked, setShowMasked] = useState3(false);
  const stepIndex = stepOrder.indexOf(currentStep);
  const saveAndNext = useCallback3(() => {
    switch (currentStep) {
      case "baseUrl":
        setBaseUrl(inputValue || "https://api.openai.com/v1");
        setCurrentStep("apiKey");
        break;
      case "apiKey":
        setApiKey(inputValue);
        setCurrentStep("model");
        break;
      case "model":
        setModel(inputValue || "gpt-4o");
        setCurrentStep("confirm");
        break;
      case "confirm":
        const config = {
          baseUrl: baseUrl || "https://api.openai.com/v1",
          apiKey,
          model: model || "gpt-4o"
        };
        setConfig(config);
        onComplete();
        return;
    }
    setInputValue("");
    setShowMasked(false);
  }, [currentStep, inputValue, baseUrl, apiKey, model, onComplete]);
  useInput2(
    useCallback3(
      (inputChar, key) => {
        if (currentStep === "confirm") {
          if (key.return) {
            saveAndNext();
          } else if (inputChar.toLowerCase() === "y") {
            saveAndNext();
          }
          return;
        }
        if (key.return) {
          saveAndNext();
        } else if (key.backspace || key.delete) {
          setInputValue((prev) => prev.slice(0, -1));
        } else if (key.tab) {
          if (currentStep === "apiKey") {
            setShowMasked((prev) => !prev);
          }
        } else {
          if (inputChar && inputChar.length === 1 && inputChar.charCodeAt(0) >= 32) {
            setInputValue((prev) => prev + inputChar);
          }
        }
      },
      [currentStep, saveAndNext]
    )
  );
  return /* @__PURE__ */ jsxs3(Box3, { flexDirection: "column", padding: 1, children: [
    /* @__PURE__ */ jsx3(Box3, { marginBottom: 1, children: /* @__PURE__ */ jsx3(Text3, { color: "cyan", bold: true, children: "\u26A1 cyjcode-cli \u2014 \u9996\u6B21\u914D\u7F6E\u5F15\u5BFC" }) }),
    /* @__PURE__ */ jsx3(Box3, { marginBottom: 1, children: stepOrder.map((step, i) => /* @__PURE__ */ jsxs3(React2.Fragment, { children: [
      /* @__PURE__ */ jsxs3(Text3, { color: i <= stepIndex ? "green" : "gray", children: [
        i <= stepIndex ? "\u25CF" : "\u25CB",
        " ",
        getLabel(step)
      ] }),
      i < stepOrder.length - 1 && /* @__PURE__ */ jsx3(Text3, { color: "gray", children: " \u2014 " })
    ] }, step)) }),
    /* @__PURE__ */ jsx3(Box3, { marginY: 1, children: /* @__PURE__ */ jsx3(Text3, { color: "gray", dimColor: true, children: "\u2014".repeat(40) }) }),
    currentStep === "baseUrl" && /* @__PURE__ */ jsxs3(Box3, { flexDirection: "column", children: [
      /* @__PURE__ */ jsx3(Text3, { children: "\u2460 API Base URL" }),
      /* @__PURE__ */ jsx3(Text3, { color: "gray", dimColor: true, children: "\u8F93\u5165 OpenAI \u517C\u5BB9\u7684 API \u7AEF\u70B9\u5730\u5740" }),
      /* @__PURE__ */ jsx3(Text3, { color: "gray", children: "\u9ED8\u8BA4: https://api.openai.com/v1" }),
      /* @__PURE__ */ jsxs3(Box3, { marginTop: 1, children: [
        /* @__PURE__ */ jsxs3(Text3, { color: "green", bold: true, children: [
          "\u25B8",
          " "
        ] }),
        /* @__PURE__ */ jsx3(Text3, { children: inputValue || "(\u4F7F\u7528\u9ED8\u8BA4\u503C)" }),
        /* @__PURE__ */ jsx3(Text3, { color: "gray", children: "|" })
      ] })
    ] }),
    currentStep === "apiKey" && /* @__PURE__ */ jsxs3(Box3, { flexDirection: "column", children: [
      /* @__PURE__ */ jsx3(Text3, { children: "\u2461 API Key" }),
      /* @__PURE__ */ jsx3(Text3, { color: "gray", dimColor: true, children: "\u8F93\u5165\u60A8\u7684 API \u5BC6\u94A5\uFF08\u8F93\u5165\u65F6\u4E0D\u4F1A\u663E\u793A\u660E\u6587\uFF09" }),
      showMasked && /* @__PURE__ */ jsx3(Text3, { color: "gray", children: "\u5BC6\u94A5\u5C06\u53EF\u89C1" }),
      /* @__PURE__ */ jsxs3(Box3, { marginTop: 1, children: [
        /* @__PURE__ */ jsxs3(Text3, { color: "green", bold: true, children: [
          "\u25B8",
          " "
        ] }),
        /* @__PURE__ */ jsx3(Text3, { children: showMasked ? inputValue : inputValue ? "*".repeat(inputValue.length) : "" }),
        /* @__PURE__ */ jsx3(Text3, { color: "gray", children: "|" })
      ] }),
      inputValue.length > 0 && /* @__PURE__ */ jsx3(Text3, { color: "gray", dimColor: true, children: "Tab \u5207\u6362\u663E\u793A/\u9690\u85CF" })
    ] }),
    currentStep === "model" && /* @__PURE__ */ jsxs3(Box3, { flexDirection: "column", children: [
      /* @__PURE__ */ jsx3(Text3, { children: "\u2462 \u6A21\u578B\u540D\u79F0" }),
      /* @__PURE__ */ jsx3(Text3, { color: "gray", dimColor: true, children: "\u8F93\u5165\u8981\u4F7F\u7528\u7684 LLM \u6A21\u578B\u540D\u79F0" }),
      /* @__PURE__ */ jsx3(Text3, { color: "gray", children: "\u9ED8\u8BA4: gpt-4o" }),
      /* @__PURE__ */ jsxs3(Box3, { marginTop: 1, children: [
        /* @__PURE__ */ jsxs3(Text3, { color: "green", bold: true, children: [
          "\u25B8",
          " "
        ] }),
        /* @__PURE__ */ jsx3(Text3, { children: inputValue || "(\u4F7F\u7528\u9ED8\u8BA4\u503C)" }),
        /* @__PURE__ */ jsx3(Text3, { color: "gray", children: "|" })
      ] })
    ] }),
    currentStep === "confirm" && /* @__PURE__ */ jsxs3(Box3, { flexDirection: "column", children: [
      /* @__PURE__ */ jsx3(Text3, { bold: true, children: "\u2463 \u786E\u8BA4\u914D\u7F6E" }),
      /* @__PURE__ */ jsxs3(Box3, { marginY: 1, flexDirection: "column", children: [
        /* @__PURE__ */ jsxs3(Text3, { children: [
          "API Base URL:",
          " ",
          /* @__PURE__ */ jsx3(Text3, { color: "cyan", children: baseUrl })
        ] }),
        /* @__PURE__ */ jsxs3(Text3, { children: [
          "API Key:",
          " ",
          /* @__PURE__ */ jsx3(Text3, { color: "cyan", children: apiKey ? apiKey.slice(0, 8) + "..." + apiKey.slice(-4) : "(\u672A\u8BBE\u7F6E)" })
        ] }),
        /* @__PURE__ */ jsxs3(Text3, { children: [
          "Model: ",
          /* @__PURE__ */ jsx3(Text3, { color: "cyan", children: model })
        ] })
      ] }),
      /* @__PURE__ */ jsx3(Box3, { marginTop: 1, children: /* @__PURE__ */ jsx3(Text3, { color: "green", bold: true, children: "\u6309 Enter \u6216\u8F93\u5165 Y \u786E\u8BA4\u4FDD\u5B58" }) })
    ] }),
    /* @__PURE__ */ jsx3(Box3, { marginY: 1, children: /* @__PURE__ */ jsx3(Text3, { color: "gray", children: "\u6309 Enter \u7EE7\u7EED" }) })
  ] });
};
function getLabel(step) {
  switch (step) {
    case "baseUrl":
      return "URL";
    case "apiKey":
      return "Key";
    case "model":
      return "Model";
    case "confirm":
      return "\u786E\u8BA4";
  }
}
var SetupWizard_default = SetupWizard;

// src/ui/App.tsx
import { jsx as jsx4, jsxs as jsxs4 } from "react/jsx-runtime";
var App = () => {
  const [configured, setConfigured] = useState4(null);
  useEffect(() => {
    setConfigured(hasConfig());
  }, []);
  const { entries, isStreaming, streamingText, sendMessage, clearChat } = useChat();
  const [commandOutput, setCommandOutput] = useState4(null);
  const handleSubmit = useCallback4(
    (text) => {
      const cmd = matchCommand(text);
      if (cmd) {
        if (cmd.name === "/clear") {
          clearChat();
          setCommandOutput("\u5BF9\u8BDD\u5386\u53F2\u5DF2\u6E05\u7A7A");
        } else {
          const output = cmd.handler();
          setCommandOutput(output);
        }
        setTimeout(() => setCommandOutput(null), 3e3);
        return;
      }
      setCommandOutput(null);
      sendMessage(text);
    },
    [sendMessage, clearChat]
  );
  if (configured === null) {
    return /* @__PURE__ */ jsx4(Box4, { padding: 1, children: /* @__PURE__ */ jsx4(Text4, { color: "gray", children: "\u6B63\u5728\u68C0\u67E5\u914D\u7F6E\u2026\u2026" }) });
  }
  if (!configured) {
    return /* @__PURE__ */ jsx4(
      SetupWizard_default,
      {
        onComplete: () => {
          setConfigured(true);
        }
      }
    );
  }
  return /* @__PURE__ */ jsxs4(Box4, { flexDirection: "column", padding: 1, children: [
    /* @__PURE__ */ jsxs4(Box4, { marginBottom: 1, children: [
      /* @__PURE__ */ jsx4(Text4, { color: "cyan", bold: true, children: "\u26A1 cyjcode-cli v0.1" }),
      /* @__PURE__ */ jsxs4(Text4, { color: "gray", dimColor: true, children: [
        " ",
        "\u2014 \u7EC8\u7AEF AI \u7F16\u7A0B\u52A9\u624B"
      ] })
    ] }),
    commandOutput && /* @__PURE__ */ jsx4(Box4, { marginY: 1, padding: 1, borderStyle: "single", children: /* @__PURE__ */ jsx4(Text4, { color: "gray", children: commandOutput }) }),
    /* @__PURE__ */ jsx4(
      MessageList_default,
      {
        entries,
        streamingText,
        isStreaming
      }
    ),
    /* @__PURE__ */ jsx4(Box4, { marginY: 1, children: /* @__PURE__ */ jsx4(Text4, { color: "gray", dimColor: true, children: "\u2500".repeat(
      Math.max(10, (process.stdout.columns || 80) - 2)
    ) }) }),
    /* @__PURE__ */ jsx4(InputBox_default, { onSubmit: handleSubmit, disabled: isStreaming }),
    /* @__PURE__ */ jsx4(Box4, { marginTop: 1, children: /* @__PURE__ */ jsx4(Text4, { color: "gray", dimColor: true, children: "/help \u5E2E\u52A9 | /config \u914D\u7F6E | /clear \u6E05\u7A7A | Ctrl+C \u9000\u51FA" }) })
  ] });
};
var App_default = App;

// src/ui/LogViewer.tsx
import { useState as useState5, useEffect as useEffect2 } from "react";
import { Box as Box5, Text as Text5 } from "ink";
import { jsx as jsx5, jsxs as jsxs5 } from "react/jsx-runtime";
var eventColors = {
  "session.start": "magenta",
  "session.end": "magenta",
  "llm.request": "blue",
  "llm.response": "cyan",
  "tool.start": "yellow",
  "tool.end": "green",
  error: "red"
};
var LogViewer = () => {
  const [entries, setEntries] = useState5([]);
  useEffect2(() => {
    let lastOffset = 0;
    let interval = null;
    const logPath = getTodayLogPath();
    const poll = () => {
      try {
        const newLines = readLogLines(logPath.split(/[/\\]/).pop(), lastOffset);
        if (newLines.length > 0) {
          const newEntries = [];
          for (const line of newLines) {
            try {
              newEntries.push(JSON.parse(line));
            } catch {
            }
          }
          if (newEntries.length > 0) {
            lastOffset += newLines.length;
            setEntries((prev) => [...prev, ...newEntries]);
          }
        }
      } catch {
      }
    };
    poll();
    interval = setInterval(poll, 500);
    return () => {
      if (interval) clearInterval(interval);
    };
  }, []);
  return /* @__PURE__ */ jsxs5(Box5, { flexDirection: "column", padding: 1, children: [
    /* @__PURE__ */ jsxs5(Box5, { marginBottom: 1, children: [
      /* @__PURE__ */ jsx5(Text5, { color: "cyan", bold: true, children: "\u{1F4CB} cyjcode-cli \u65E5\u5FD7\u67E5\u770B\u5668" }),
      /* @__PURE__ */ jsxs5(Text5, { color: "gray", dimColor: true, children: [
        " ",
        "\u2014 \u5B9E\u65F6\u76D1\u63A7\u65E5\u5FD7\u6D41"
      ] })
    ] }),
    /* @__PURE__ */ jsx5(Box5, { marginBottom: 1, children: /* @__PURE__ */ jsxs5(Text5, { color: "gray", children: [
      entries.length,
      " \u6761\u65E5\u5FD7 | \u6309 Ctrl+C \u9000\u51FA"
    ] }) }),
    /* @__PURE__ */ jsx5(Box5, { marginY: 1, children: /* @__PURE__ */ jsx5(Text5, { color: "gray", dimColor: true, children: "\u2014".repeat(
      Math.max(10, (process.stdout.columns || 80) - 2)
    ) }) }),
    /* @__PURE__ */ jsxs5(Box5, { flexDirection: "column", children: [
      entries.length === 0 && /* @__PURE__ */ jsx5(Box5, { children: /* @__PURE__ */ jsx5(Text5, { color: "gray", dimColor: true, children: "\u7B49\u5F85\u65E5\u5FD7\u2026\u2026" }) }),
      entries.slice(-30).map((entry, i) => /* @__PURE__ */ jsxs5(Box5, { flexDirection: "column", marginBottom: 1, children: [
        /* @__PURE__ */ jsxs5(Box5, { children: [
          /* @__PURE__ */ jsxs5(Text5, { color: "gray", dimColor: true, children: [
            formatTime(entry.timestamp),
            " "
          ] }),
          /* @__PURE__ */ jsx5(
            Text5,
            {
              color: eventColors[entry.type] || "white",
              bold: true,
              children: entry.type
            }
          )
        ] }),
        /* @__PURE__ */ jsx5(Box5, { paddingLeft: 4, children: /* @__PURE__ */ jsx5(Text5, { color: eventColors[entry.type] || "white", children: formatData(entry) }) })
      ] }, i))
    ] })
  ] });
};
function formatTime(timestamp) {
  try {
    const d = new Date(timestamp);
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}`;
  } catch {
    return timestamp;
  }
}
function formatData(entry) {
  const { data } = entry;
  if (!data || Object.keys(data).length === 0) return "";
  switch (entry.type) {
    case "llm.request":
      return `model=${data.model || "?"} messages=${data.messageCount || 0}`;
    case "llm.response":
      return `tokens=${data.totalTokens || "?"}`;
    case "tool.start":
      return `${data.tool || "?"} args=${data.args ? JSON.stringify(data.args).substring(0, 80) : ""}`;
    case "tool.end":
      if (data.success) return "\u2713 \u6210\u529F";
      return `\u2717 ${data.error || "\u5931\u8D25"}`;
    case "error":
      return `${data.message || "\u672A\u77E5\u9519\u8BEF"}`;
    default:
      return JSON.stringify(data).substring(0, 120);
  }
}
var LogViewer_default = LogViewer;

// src/cli.tsx
yargs(hideBin(process.argv)).scriptName("cyjcode").usage("$0 [command]").command(
  "$0",
  "\u542F\u52A8 cyjcode \u804A\u5929\u754C\u9762",
  () => {
  },
  () => {
    const { waitUntilExit } = render(React5.createElement(App_default));
    waitUntilExit().then(() => {
      process.exit(0);
    });
  }
).command(
  "logs",
  "\u67E5\u770B\u5B9E\u65F6\u65E5\u5FD7",
  () => {
  },
  () => {
    const { waitUntilExit } = render(React5.createElement(LogViewer_default));
    waitUntilExit().then(() => {
      process.exit(0);
    });
  }
).version("0.1.0").help().parse();
