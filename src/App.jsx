import { useEffect } from "preact/hooks";
import { auth, trySilentSignIn } from "./auth.js";
import { backend, activateBackend, restoreTabs, openNote, newNote, mobileView } from "./store.js";
import { createDriveBackend } from "./backends/drive.js";
import { SignIn, Sidebar, TabBar, Editor, Toast } from "./components.jsx";

/** Drive's "Open with QuietPad" / "New" hand-off arrives as ?state={"action":"open","ids":[…]}. */
function driveHandoff() {
  try {
    const raw = new URLSearchParams(location.search).get("state");
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

async function enterDrive() {
  await activateBackend(createDriveBackend());
  const handoff = driveHandoff();
  if (handoff?.action === "open" && handoff.ids?.[0]) await openNote(handoff.ids[0]);
  else if (handoff?.action === "create") newNote();
  else await restoreTabs();
}

async function boot() {
  if (import.meta.env.DEV && new URLSearchParams(location.search).has("demo")) {
    const { createDemoBackend } = await import("./backends/demo.js");
    auth.value = { status: "signedIn", email: "demo@example.com", error: null };
    await activateBackend(createDemoBackend());
    await restoreTabs();
    return;
  }
  if (await trySilentSignIn()) await enterDrive();
}

export function App() {
  useEffect(() => { boot(); }, []);

  const status = auth.value.status;
  if (!backend.value) {
    if (status === "signingIn" && !auth.value.error) return <div class="splash"><p class="muted">Signing in…</p></div>;
    return status === "signedIn" ? <div class="splash"><p class="muted">Loading your notes…</p></div> : <SignIn onSignedIn={enterDrive} />;
  }
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
