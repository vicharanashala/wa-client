import { HumanMessage, AIMessage, BaseMessage } from '@langchain/core/messages';
import { Message } from '../conversations/domain/conversation';

export function toBaseMessages(
  messages: ReadonlyArray<Message>,
): BaseMessage[] {
  const result: BaseMessage[] = [];
  const toolCallMap = new Map<string, { name: string; input: string }>();

  for (const m of messages) {
    switch (m.role) {
      case 'user':
        result.push(new HumanMessage(m.content));
        break;

      case 'chatbot':
        result.push(new AIMessage(m.content));
        break;

      case 'tool_call':
        // Store for later pairing with its result
        toolCallMap.set(m.toolCallId!, { name: m.toolName!, input: m.content });
        break;

      case 'tool_result': {
        const call = toolCallMap.get(m.toolCallId!);
        result.push(
          new AIMessage(
            `[Tool: ${call?.name ?? m.toolName} | ID: ${m.toolCallId}]\n` +
              `Input: ${call?.input ?? '—'}\n` +
              `Result: ${m.content}`,
          ),
        );
        toolCallMap.delete(m.toolCallId!);
        break;
      }
    }
  }

  return result;
}
