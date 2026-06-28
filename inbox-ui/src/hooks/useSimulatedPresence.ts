import { useEffect } from "react";
import { useInboxStore } from "../store/useInboxStore";

const LINES = [
  "Gracias, quedo atenta.",
  "Any update on my booking?",
  "¿Me pueden llamar?",
  "Perfect, that works for me.",
  "Sigo esperando la confirmación.",
  "Thanks for the quick reply!",
];

const TICK_MS = 8000;
const TYPING_MS = 2000;

/**
 * Simulates live activity over the mock data: periodically a contact "types"
 * and then an inbound message arrives. No backend / Socket.io this round.
 */
export function useSimulatedPresence() {
  useEffect(() => {
    let typingTimer: ReturnType<typeof setTimeout>;

    const interval = setInterval(() => {
      const { conversations, setTyping, receiveMessage } = useInboxStore.getState();
      if (conversations.length === 0) return;
      const conv = conversations[Math.floor(Math.random() * conversations.length)];
      const line = LINES[Math.floor(Math.random() * LINES.length)];

      setTyping(conv.id);
      typingTimer = setTimeout(() => {
        receiveMessage(conv.id, line);
        setTyping(null);
      }, TYPING_MS);
    }, TICK_MS);

    return () => {
      clearInterval(interval);
      clearTimeout(typingTimer);
      useInboxStore.getState().setTyping(null);
    };
  }, []);
}
