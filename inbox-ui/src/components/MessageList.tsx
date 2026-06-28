import { useEffect, useRef } from "react";
import type { Message } from "../types";
import { MessageBubble } from "./MessageBubble";
import { useMessageEnter } from "../hooks/useMessageEnter";

export function MessageList({ messages }: { messages: Message[] }) {
  const ref = useRef<HTMLDivElement>(null);
  useMessageEnter(ref, messages.length);

  // Keep the view pinned to the latest message.
  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  return (
    <div ref={ref} className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-5 py-4">
      {messages.map((m) => (
        <MessageBubble key={m.id} message={m} />
      ))}
    </div>
  );
}
