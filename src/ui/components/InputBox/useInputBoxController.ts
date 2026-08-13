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

type DeleteKey = "backspace" | "delete";

interface DeleteAccelerationState {
  key: DeleteKey | null;
  lastAt: number;
  repeats: number;
}

const DELETE_REPEAT_WINDOW_MS = 90;
const DELETE_ACCELERATION_STEP = 8;
const MAX_DELETE_BATCH = 5;

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
  const deleteAccelerationRef = useRef<DeleteAccelerationState>({
    key: null,
    lastAt: 0,
    repeats: 0,
  });
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

  const resetDeleteAcceleration = () => {
    deleteAccelerationRef.current = { key: null, lastAt: 0, repeats: 0 };
  };

  const dispatchAcceleratedDelete = (input: string, key: Key): boolean => {
    const deleteKey = getAcceleratableDeleteKey(key);
    if (deleteKey === null) return false;

    const eventCount = getDeleteEventCount(
      deleteAccelerationRef.current,
      deleteKey,
      Date.now(),
    );
    const command = resolveInputBoxCommand(input, key);
    if (command.type !== "edit") return false;

    for (let eventIndex = 0; eventIndex < eventCount; eventIndex += 1) {
      dispatchInputEvent(command.event);
    }
    return true;
  };

  return {
    view,
    handleInput: (input, key) => {
      if (key.eventType === "release") {
        resetDeleteAcceleration();
        return;
      }
      if (dispatchAcceleratedDelete(input, key)) return;
      resetDeleteAcceleration();
      dispatchInputCommand(resolveInputBoxCommand(input, key));
    },
    handlePaste: (text) => {
      resetDeleteAcceleration();
      dispatchInputEvent({ type: "insertText", text });
    },
  };
};

const getAcceleratableDeleteKey = (key: Key): DeleteKey | null => {
  if (key.ctrl || key.meta) return null;
  if (key.backspace) return "backspace";
  if (key.delete) return "delete";
  return null;
};

const getDeleteEventCount = (
  state: DeleteAccelerationState,
  deleteKey: DeleteKey,
  now: number,
): number => {
  const repeats = getNextDeleteRepeatCount(state, deleteKey, now);
  state.key = deleteKey;
  state.lastAt = now;
  state.repeats = repeats;
  return Math.min(
    MAX_DELETE_BATCH,
    1 + Math.floor(repeats / DELETE_ACCELERATION_STEP),
  );
};

const getNextDeleteRepeatCount = (
  state: DeleteAccelerationState,
  deleteKey: DeleteKey,
  now: number,
): number => {
  const isSameHold =
    state.key === deleteKey && now - state.lastAt <= DELETE_REPEAT_WINDOW_MS;
  return isSameHold ? state.repeats + 1 : 0;
};
