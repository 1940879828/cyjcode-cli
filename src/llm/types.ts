// 单条历史上下文
export interface ChatMessage {
  // 区分当前是谁的消息 系统级指令、用户输入、模型回复、工具执行结果-配合 tool_call_id 关联
  role: "system" | "user" | "assistant" | "tool";
  // 聊天的内容
  content: string | null;
  // user时区分不同的用户 assistant时区分多个助手角色
  name?: string;
  /**
   * 工具结果与调用的关联键
   * 仅出现在 role: "assistant" 的消息中，表示模型不直接回复文本，而是决定调用某个函数。
   */ 
  tool_call_id?: string;
  /**
   * 助手发起的工具调用请求 
   * 告诉你需要要调用什么工具 
   * 
   * 调用完需要把结果返回到历史上下文再给ai发请求让他继续跑
   */ 
  tool_calls?: ToolCall[];
}

export interface ToolCall {
  // 回填历史上下文时的id
  id: string;
  type: "function";
  function: {
    // 工具名称
    name: string;
    // 工具参数
    arguments: string;
  };
}

export interface ToolCallDelta {
  index: number;
  id?: string;
  type?: "function";
  function?: {
    name?: string;
    arguments?: string;
  };
}

// 流失输出接口事件返回值 适配成当前项目的需要的结构
export type StreamEvent =
  | 
  { 
    // DeepSeek 思考过程增量（reasoning_content）
    type: "reasoning_delta"; 
    content: string 
  }
  | 
  { 
    // 文本增量 每条事件返回一个字两个字
    type: "text_delta"; 
    content: string 
  }
  | 
  { 
    // 工具调用增量
    type: "tool_call_delta"; 
    deltas: ToolCallDelta[]
  }
  | 
  { 
    // 本轮对话结束
    type: "done"; 
    message: ChatMessage
  }
  | 
  { 
    // 出了异常
    type: "error"; 
    error: Error
  };
