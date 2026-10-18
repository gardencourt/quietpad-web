// Placeholder credentials — see the repo's README "Google Cloud Console setup"
// section for exactly how to get real values for these. Nothing in this file
// is a secret (the Client ID and API key are both meant to be public/visible
// in client-side code — Drive access is authorized per-user via OAuth, not
// gated by keeping these values hidden), but sign-in will fail until they're
// filled in with real ones from the QuietPad Cloud Console project.

const QUIETPAD_CONFIG = {
  // OAuth 2.0 Web client ID — must be the SAME Cloud Console project/client
  // as the Android app (project quietpad-507413, client "QuietPad Web"),
  // never a separate project: drive.file visibility is per-project, not
  // global (see ANDROID-PARITY-HANDOFF.md's "Key finding", 2026-09-25 — a
  // different project's client saw 0 of the Android app's files in the same
  // Drive folder). This was previously set to a client in a DIFFERENT
  // project (512190405541-...), which is why findAppFolderId() would never
  // have found anything real. Matches app/src/main/res/values/strings.xml's
  // google_oauth_web_client_id on the Android side exactly.
  CLIENT_ID: "780542948149-a0rss7422ok4pq4pc4pofq2q4bls2qe3.apps.googleusercontent.com",

  // API key for the Google Picker API (separate from the OAuth client above —
  // Credentials → Create Credentials → API key, then restrict it to the
  // Picker API and to this site's domain). NOT independently re-verified
  // this session — Claude Code's own permission rules block revealing a
  // live API key's value, so this couldn't be checked byte-for-byte against
  // quietpad-507413's "API key 1" (which IS correctly set up: Google Drive
  // API + Google Picker API only, referrers restricted to
  // https://quietpad.co.uk/*, https://www.quietpad.co.uk/*,
  // http://localhost:5173/*). Worth a manual compare, given the CLIENT_ID
  // above turned out to be from the wrong project entirely.
  PICKER_API_KEY: "AIzaSyCxRC9lxN3I3nRbyyZjStd7hkIkKyOY86A",

  // drive.file only — this app only ever sees a file once the user has
  // explicitly picked it (via Picker) or it was handed off directly by Drive
  // (via the "Open with" integration). Never a broader scope: that's what
  // keeps OAuth verification at the ordinary tier, not the restricted one.
  SCOPE: "https://www.googleapis.com/auth/drive.file"
};
