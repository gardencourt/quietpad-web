import { useEffect } from "preact/hooks";
import { backend, mobileView } from "./store.js";
import { booting, boot } from "./session.js";
import { Start, Sidebar, TabBar, Editor, Toast } from "./components.jsx";

export function App() {
  useEffect(() => { boot(); }, []);

  if (booting.value) return <div class="splash"><p class="muted">Loading…</p></div>;
  if (!backend.value) return <Start />;
  return (
    <div class="app" data-view={mobileView.value}>
      <Sidebar />
      <main class="main">
        <TabBar />
        <Editor />
      </main>
      <Toast />
    </div>
  );
}
