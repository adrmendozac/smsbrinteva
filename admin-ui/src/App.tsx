import { useEffect, useState } from "react";
import { isAuthenticated, clearToken } from "./lib/auth";
import { api } from "./lib/api";
import type { Contact } from "./types";
import { Login } from "./components/Login";
import { Header, type Tab } from "./components/Header";
import { Composer } from "./components/Composer";
import { History } from "./components/History";
import { Spinner } from "./components/ui";

export default function App() {
  const [authed, setAuthed] = useState(isAuthenticated());
  const [tab, setTab] = useState<Tab>("compose");
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loadingContacts, setLoadingContacts] = useState(true);
  const [refreshSignal, setRefreshSignal] = useState(0);

  useEffect(() => {
    if (!authed) return;
    setLoadingContacts(true);
    api
      .getContacts()
      .then(setContacts)
      .catch(() => setContacts([]))
      .finally(() => setLoadingContacts(false));
  }, [authed]);

  if (!authed) return <Login onSuccess={() => setAuthed(true)} />;

  function logout() {
    clearToken();
    setAuthed(false);
  }

  function onCreated() {
    setRefreshSignal((s) => s + 1);
    setTab("history");
  }

  return (
    <div className="min-h-full">
      <Header tab={tab} onTab={setTab} onLogout={logout} />
      <main className="mx-auto max-w-3xl px-4 py-6">
        {tab === "compose" ? (
          loadingContacts ? (
            <div className="flex justify-center py-12 text-[var(--text-muted)]">
              <Spinner />
            </div>
          ) : (
            <Composer contacts={contacts} onCreated={onCreated} />
          )
        ) : (
          <History refreshSignal={refreshSignal} />
        )}
      </main>
    </div>
  );
}
