import { useInboxStore } from "../store/useInboxStore";
import { ThreadHeader } from "./ThreadHeader";
import { MessageList } from "./MessageList";
import { ReplyBox } from "./ReplyBox";
import { TypingIndicator } from "./TypingIndicator";
import { EmptyThread } from "./EmptyThread";

export function Thread() {
  const { selectedId, conversations, contacts, messages, typingConversationId } =
    useInboxStore();

  if (!selectedId) return <EmptyThread />;

  const conversation = conversations.find((c) => c.id === selectedId);
  const contact = contacts.find((c) => c.id === conversation?.contactId);
  if (!conversation || !contact) return <EmptyThread />;

  const threadMessages = messages.filter((m) => m.conversationId === selectedId);

  return (
    <div className="flex h-full flex-col bg-[var(--surface)]">
      <ThreadHeader contact={contact} conversation={conversation} />
      <MessageList messages={threadMessages} />
      <TypingIndicator active={typingConversationId === selectedId} />
      <ReplyBox conversationId={selectedId} />
    </div>
  );
}
