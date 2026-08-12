import { useRef, useState } from "react";
import type { Key } from "ink";
import {
  createInputBoxState,
  getSubmittableText,
  reduceInputBoxState,
  resolveInputBoxCommand,
  selectInputBoxView,
} from "./inputBoxModel.js";
import type {
  InputBoxCommand,
  InputBoxEvent,
  InputBoxState,
  InputBoxView,
} from "./inputBoxModel.js";

export interface InputBoxController {
  view: InputBoxView;
  handleInput: (input: string, key: Key) => void;
  handlePaste: (text: string) => void;
}

export interface UseInputBoxControllerOptions {
  onSubmit: (text: string) => void;
  inputHistory: readonly string[];
  inputColumns: number;
  disabled: boolean;
  isExiting: boolean;
}

export const useInputBoxController = ({
  onSubmit,
  inputHistory,
  inputColumns,
  disabled,
  isExiting,
}: UseInputBoxControllerOptions): InputBoxController => {
  const [inputState, setInputState] = useState<InputBoxState>(createInputBoxState);
  const inputStateRef = useRef(inputState);
  const onSubmitRef = useRef(onSubmit);
  const inputHistoryRef = useRef(inputHistory);
  const isActive = !disabled && !isExiting;
  const layout = { inputColumns };
  const view = selectInputBoxView(inputState, layout, isActive);

  onSubmitRef.current = onSubmit;
  inputHistoryRef.current = inputHistory;

  const commitInputState = (nextState: InputBoxState) => {
    if (nextState === inputStateRef.current) return;
    inputStateRef.current = nextState;
    setInputState(nextState);
  };

  const dispatchInputEvent = (event: InputBoxEvent) => {
    if (!isActive) return;
    const nextState = reduceInputBoxState(inputStateRef.current, event, {
      layout,
      inputHistory: inputHistoryRef.current,
    });
    commitInputState(nextState);
  };

  const dispatchInputCommand = (command: InputBoxCommand) => {
    if (!isActive) return;
    if (command.type === "edit") {
      dispatchInputEvent(command.event);
      return;
    }

    const text = getSubmittableText(inputStateRef.current);
    if (text === null) return;

    commitInputState(createInputBoxState());
    onSubmitRef.current(text);
  };

  return {
    view,
    handleInput: (input, key) => {
      dispatchInputCommand(resolveInputBoxCommand(input, key));
    },
    handlePaste: (text) => {
      dispatchInputEvent({ type: "insertText", text });
    },
  };
};
