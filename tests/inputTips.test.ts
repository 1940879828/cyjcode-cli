import assert from "node:assert/strict";
import test from "node:test";
import {
  INPUT_TIP_MESSAGES,
  SELECTION_TIP_MESSAGE,
  selectInputTips,
} from "../src/ui/inputTips.js";
import type { ChatEntry } from "../src/ui/chatTypes.js";

const assistantEntry: ChatEntry = {
  id: "assistant_1",
  role: "assistant",
  parts: [{ id: "assistant_1_text", kind: "text", content: "done" }],
  activeText: "",
  timestamp: 1,
};

test("selectInputTips shows the selection tip after assistant content when input is blank", () => {
  assert.deepEqual(
    selectInputTips({
      entries: [assistantEntry],
      isStreaming: false,
      inputIsBlank: true,
    }),
    [SELECTION_TIP_MESSAGE],
  );
});

test("selectInputTips shows input shortcuts while editing", () => {
  assert.deepEqual(
    selectInputTips({
      entries: [assistantEntry],
      isStreaming: false,
      inputIsBlank: false,
    }),
    INPUT_TIP_MESSAGES,
  );
});

test("selectInputTips hides tips while streaming", () => {
  assert.deepEqual(
    selectInputTips({
      entries: [assistantEntry],
      isStreaming: true,
      inputIsBlank: false,
    }),
    [],
  );
});

test("selectInputTips hides tips before assistant content exists", () => {
  assert.equal(
    selectInputTips({
      entries: [],
      isStreaming: false,
      inputIsBlank: true,
    }).length,
    0,
  );
});
