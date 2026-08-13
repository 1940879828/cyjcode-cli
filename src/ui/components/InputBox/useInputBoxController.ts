import { useRef, useState } from "react";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
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
  InputBoxLayout,
  InputBoxState,
  InputBoxView,
} from "./inputBoxModel.js";

type DeleteKey = "backspace" | "delete";

interface DeleteAccelerationState {
  key: DeleteKey | null;
  lastAt: number;
  repeats: number;
}

interface InputBoxRefs {
  inputStateRef: MutableRefObject<InputBoxState>;
  onSubmitRef: MutableRefObject<(text: string) => void>;
  inputHistoryRef: MutableRefObject<readonly string[]>;
  deleteAccelerationRef: MutableRefObject<DeleteAccelerationState>;
}

interface InputBoxRuntime {
  refs: InputBoxRefs;
  setInputState: Dispatch<SetStateAction<InputBoxState>>;
  layout: InputBoxLayout;
  isActive: boolean;
}

interface InputBoxDispatcher {
  dispatchInputCommand: (command: InputBoxCommand) => void;
  dispatchInputEvent: (event: InputBoxEvent) => void;
  dispatchAcceleratedDelete: (input: string, key: Key) => boolean;
  resetDeleteAcceleration: () => void;
}

interface AcceleratedDeleteInput {
  runtime: InputBoxRuntime;
  dispatchInputEvent: (event: InputBoxEvent) => void;
  input: string;
  key: Key;
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
  const refs = useInputBoxRefs(inputState, onSubmit, inputHistory);
  const isActive = !disabled && !isExiting;
  const layout = { inputColumns };
  const view = selectInputBoxView(inputState, layout, isActive);
  const dispatcher = createInputBoxDispatcher({ refs, setInputState, layout, isActive });

  return createInputHandlers(view, dispatcher);
};

function useInputBoxRefs(
  inputState: InputBoxState,
  onSubmit: (text: string) => void,
  inputHistory: readonly string[],
): InputBoxRefs {
  const refs = {
    inputStateRef: useRef(inputState),
    onSubmitRef: useRef(onSubmit),
    inputHistoryRef: useRef(inputHistory),
    deleteAccelerationRef: useRef(createDeleteAccelerationState()),
  };
  refs.onSubmitRef.current = onSubmit;
  refs.inputHistoryRef.current = inputHistory;
  return refs;
}

function createInputBoxDispatcher(runtime: InputBoxRuntime): InputBoxDispatcher {
  const dispatchInputEvent = (event: InputBoxEvent) => {
    dispatchInputBoxEvent(runtime, event);
  };
  return {
    dispatchInputEvent,
    dispatchInputCommand: (command) => dispatchInputBoxCommand(runtime, dispatchInputEvent, command),
    dispatchAcceleratedDelete: (input, key) =>
      dispatchAcceleratedDelete({ runtime, dispatchInputEvent, input, key }),
    resetDeleteAcceleration: () => {
      runtime.refs.deleteAccelerationRef.current = createDeleteAccelerationState();
    },
  };
}

function createInputHandlers(
  view: InputBoxView,
  dispatcher: InputBoxDispatcher,
): InputBoxController {
  const handleInput = (input: string, key: Key) => {
    if (key.eventType === "release") return dispatcher.resetDeleteAcceleration();
    if (dispatcher.dispatchAcceleratedDelete(input, key)) return;
    dispatcher.resetDeleteAcceleration();
    dispatcher.dispatchInputCommand(resolveInputBoxCommand(input, key));
  };
  return {
    view,
    handleInput,
    handlePaste: (text) => {
      dispatcher.resetDeleteAcceleration();
      dispatcher.dispatchInputEvent({ type: "insertText", text });
    },
  };
}

function dispatchInputBoxEvent(runtime: InputBoxRuntime, event: InputBoxEvent): void {
  if (!runtime.isActive) return;
  const nextState = reduceInputBoxState(runtime.refs.inputStateRef.current, event, {
    layout: runtime.layout,
    inputHistory: runtime.refs.inputHistoryRef.current,
  });
  commitInputState(runtime, nextState);
}

function dispatchInputBoxCommand(
  runtime: InputBoxRuntime,
  dispatchInputEvent: (event: InputBoxEvent) => void,
  command: InputBoxCommand,
): void {
  if (!runtime.isActive) return;
  if (command.type === "edit") return dispatchInputEvent(command.event);
  submitInputState(runtime);
}

function submitInputState(runtime: InputBoxRuntime): void {
  const text = getSubmittableText(runtime.refs.inputStateRef.current);
  if (text === null) return;
  commitInputState(runtime, createInputBoxState());
  runtime.refs.onSubmitRef.current(text);
}

function commitInputState(runtime: InputBoxRuntime, nextState: InputBoxState): void {
  if (nextState === runtime.refs.inputStateRef.current) return;
  runtime.refs.inputStateRef.current = nextState;
  runtime.setInputState(nextState);
}

function dispatchAcceleratedDelete(input: AcceleratedDeleteInput): boolean {
  const deleteKey = getAcceleratableDeleteKey(input.key);
  if (deleteKey === null) return false;

  const eventCount = getDeleteEventCount(
    input.runtime.refs.deleteAccelerationRef.current,
    deleteKey,
    Date.now(),
  );
  const command = resolveInputBoxCommand(input.input, input.key);
  if (command.type !== "edit") return false;

  repeatInputEvent(input.dispatchInputEvent, command.event, eventCount);
  return true;
}

function repeatInputEvent(
  dispatchInputEvent: (event: InputBoxEvent) => void,
  event: InputBoxEvent,
  eventCount: number,
): void {
  for (let eventIndex = 0; eventIndex < eventCount; eventIndex += 1) {
    dispatchInputEvent(event);
  }
}

const createDeleteAccelerationState = (): DeleteAccelerationState => ({
  key: null,
  lastAt: 0,
  repeats: 0,
});

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
