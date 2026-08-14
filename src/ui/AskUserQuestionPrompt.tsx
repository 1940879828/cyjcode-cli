import { useEffect, useState, type Dispatch, type SetStateAction } from "react";
import { Box, Text, useInput } from "ink";
import type { AskUserQuestionItem } from "../agent/types.js";

interface AskUserQuestionPromptProps {
  questions: AskUserQuestionItem[];
  onSubmit: (answers: Record<string, string>) => void;
  onCancel: () => void;
}

interface PromptOption {
  label: string;
  description?: string;
  value: string;
  other?: boolean;
}

interface PromptRuntime {
  question: AskUserQuestionItem | undefined;
  questionIndex: number;
  options: PromptOption[];
  cursorIndex: number;
  selectedValues: string[];
  submittedAnswer: string | undefined;
  otherText: string;
  status: string | null;
}

type RecordSetter<T> = Dispatch<SetStateAction<Record<number, T>>>;

const OTHER_VALUE = "__other__";

export default function AskUserQuestionPrompt({
  questions,
  onSubmit,
  onCancel,
}: AskUserQuestionPromptProps) {
  const prompt = useAskUserQuestionPrompt({ questions, onSubmit, onCancel });

  if (!prompt.question) return null;

  return (
    <Box flexDirection="column" borderStyle="single" borderColor="yellow" paddingX={1} marginTop={1}>
      <Text color="yellow" bold>需要你确认</Text>
      <Text dimColor>{prompt.questionIndex + 1}/{questions.length}</Text>
      <Box marginTop={1}><Text bold>{prompt.question.question}</Text></Box>
      <QuestionOptionList prompt={prompt} />
      <Box marginTop={1}>
        <Text dimColor>{prompt.status ?? "↑/↓ 移动 · Space 多选 · Enter 提交/下一题 · Esc 手动输入"}</Text>
      </Box>
    </Box>
  );
}

function useAskUserQuestionPrompt({
  questions,
  onSubmit,
  onCancel,
}: AskUserQuestionPromptProps): PromptRuntime {
  const [questionIndex, setQuestionIndex] = useState(0);
  const [cursorIndex, setCursorIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<Record<number, string[]>>({});
  const [otherTexts, setOtherTexts] = useState<Record<number, string>>({});
  const [status, setStatus] = useState<string | null>(null);
  const question = questions[questionIndex];
  const options = buildOptions(question);
  const currentOption = options[cursorIndex];
  const selectedValues = selected[questionIndex] ?? [];
  const otherText = otherTexts[questionIndex] ?? "";

  useEffect(() => setStatus(null), [questionIndex, cursorIndex]);
  useQuestionPromptInput({
    question,
    options,
    cursorIndex,
    setCursorIndex,
    selected: selectedValues,
    otherText,
    setSelected,
    setOtherTexts,
    questionIndex,
    commit: () => commitQuestion(),
    cancel: onCancel,
  });

  function commitQuestion(): void {
    if (!question) return;
    const answer = buildAnswer({ question, focused: currentOption, selected: selectedValues, otherText });
    if (!answer) {
      setStatus(question.multiSelect ? "请至少选择一项，或填写 Other。" : "请选择一项，或填写 Other。");
      return;
    }
    const nextAnswers = { ...answers, [question.question]: answer };
    setAnswers(nextAnswers);
    if (questionIndex >= questions.length - 1) return onSubmit(nextAnswers);
    setQuestionIndex((value) => value + 1);
    setCursorIndex(0);
  }

  return {
    question,
    questionIndex,
    options,
    cursorIndex,
    selectedValues,
    submittedAnswer: question ? answers[question.question] : undefined,
    otherText,
    status,
  };
}

function useQuestionPromptInput(input: {
  question: AskUserQuestionItem | undefined;
  options: PromptOption[];
  cursorIndex: number;
  setCursorIndex: (value: number | ((current: number) => number)) => void;
  selected: string[];
  otherText: string;
  setSelected: RecordSetter<string[]>;
  setOtherTexts: RecordSetter<string>;
  questionIndex: number;
  commit: () => void;
  cancel: () => void;
}): void {
  useInput((rawInput, key) => {
    if (!input.question) return;
    if (key.escape || (key.ctrl && rawInput.toLowerCase() === "c")) return input.cancel();
    if (key.upArrow) return input.setCursorIndex((value) => Math.max(0, value - 1));
    if (key.downArrow) return input.setCursorIndex((value) => Math.min(input.options.length - 1, value + 1));
    if (key.return) return input.commit();
    if (input.question.multiSelect && rawInput === " ") return toggleSelected(input);
    if (isFocusedOther(input)) return editOtherText(input, rawInput, key.backspace === true);
  });
}

function QuestionOptionList({ prompt }: { prompt: PromptRuntime }) {
  return (
    <Box flexDirection="column" marginTop={1}>
      {prompt.options.map((option, index) => (
        <QuestionOptionRow
          key={option.value}
          option={option}
          focused={index === prompt.cursorIndex}
          checked={isOptionChecked({ option, prompt })}
          otherText={prompt.otherText}
        />
      ))}
    </Box>
  );
}

function QuestionOptionRow({
  option,
  focused,
  checked,
  otherText,
}: {
  option: PromptOption;
  focused: boolean;
  checked: boolean;
  otherText: string;
}) {
  return (
    <Box flexDirection="column">
      <Text color={focused ? "cyanBright" : undefined}>
        {focused ? "> " : "  "}{checked ? "[x]" : "[ ]"} <Text bold={focused}>{option.label}</Text>
      </Text>
      {option.description ? <Box marginLeft={4}><Text dimColor>{option.description}</Text></Box> : null}
      {option.other ? <Box marginLeft={4}><Text dimColor>{otherText || "选中后直接输入自定义答案"}</Text></Box> : null}
    </Box>
  );
}

function buildOptions(question: AskUserQuestionItem | undefined): PromptOption[] {
  if (!question) return [];
  return [
    ...question.options.map((option) => ({ ...option, value: option.label })),
    { label: "Other", value: OTHER_VALUE, other: true },
  ];
}

function buildAnswer(input: {
  question: AskUserQuestionItem;
  focused: PromptOption | undefined;
  selected: string[];
  otherText: string;
}): string | null {
  const trimmedOther = input.otherText.trim();
  if (!input.question.multiSelect) return input.focused?.other ? trimmedOther || null : input.focused?.label ?? null;
  const labels = input.selected.filter((value) => value !== OTHER_VALUE);
  if (trimmedOther) labels.push(trimmedOther);
  return labels.length > 0 ? labels.join(", ") : null;
}

function isOptionChecked(input: { option: PromptOption; prompt: PromptRuntime }): boolean {
  if (input.option.other) {
    return Boolean(input.prompt.otherText.trim()) || input.prompt.selectedValues.includes(OTHER_VALUE);
  }
  if (input.prompt.question?.multiSelect) return input.prompt.selectedValues.includes(input.option.value);
  return input.prompt.submittedAnswer === input.option.label;
}

function isFocusedOther(input: { options: PromptOption[]; cursorIndex: number }): boolean {
  return input.options[input.cursorIndex]?.other === true;
}

function toggleSelected(input: {
  options: PromptOption[];
  cursorIndex: number;
  selected: string[];
  questionIndex: number;
  setSelected: RecordSetter<string[]>;
}): void {
  const value = input.options[input.cursorIndex]?.value;
  if (!value) return;
  input.setSelected((current) => ({
    ...current,
    [input.questionIndex]: input.selected.includes(value)
      ? input.selected.filter((item) => item !== value)
      : [...input.selected, value],
  }));
}

function editOtherText(
  input: {
    questionIndex: number;
    setOtherTexts: RecordSetter<string>;
  },
  rawInput: string,
  backspace: boolean,
): void {
  input.setOtherTexts((current) => ({
    ...current,
    [input.questionIndex]: backspace
      ? (current[input.questionIndex] ?? "").slice(0, -1)
      : `${current[input.questionIndex] ?? ""}${rawInput}`,
  }));
}
