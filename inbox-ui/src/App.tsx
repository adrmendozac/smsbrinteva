import { Sidebar } from "./components/Sidebar";
import { ConversationList } from "./components/ConversationList";
import { Thread } from "./components/Thread";
import { ContactPanel } from "./components/ContactPanel";
import { useSimulatedPresence } from "./hooks/useSimulatedPresence";
import { useInboxStore } from "./store/useInboxStore";
import { cn } from "./lib/cn";

export default function App() {
  useSimulatedPresence();
  const selectedId = useInboxStore((s) => s.selectedId);

  return (
    <div className="grid h-screen w-screen grid-cols-[4rem_1fr] overflow-hidden lg:grid-cols-[4rem_20rem_1fr_18rem]">
      <Sidebar />
      {/* Mobile: list and thread swap based on selection. Desktop: both visible. */}
      <div
        className={cn(
          "min-w-0 border-r border-[var(--border)] lg:block",
          selectedId ? "max-lg:hidden" : "block",
        )}
      >
        <ConversationList />
      </div>
      <main className={cn("min-w-0 lg:block", selectedId ? "block" : "max-lg:hidden")}>
        <Thread />
      </main>
      <ContactPanel />
    </div>
  );
}
