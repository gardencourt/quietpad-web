// Placeholder credentials — see the repo's README "Google Cloud Console setup"
// section for exactly how to get real values for these. Nothing in this file
// is a secret (the Client ID and API key are both meant to be public/visible
// in client-side code — Drive access is authorized per-user via OAuth, not
// gated by keeping these values hidden), but sign-in will fail until they're
// filled in with real ones from the QuietPad Cloud Console project.

const QUIETPAD_CONFIG = {
  // OAuth 2.0 Web client ID (same Cloud Console project as the Android app —
  // reuses its existing Web client, see README) — looks like
  // "1234567890-abc...apps.googleusercontent.com".
  CLIENT_ID: "512190405541-lob5ukih13kkmrsb49ei1jv8o12i83la.apps.googleusercontent.com",

  // API key for the Google Picker API (separate from the OAuth client above —
  // Credentials → Create Credentials → API key, then restrict it to the
  // Picker API and to this site's domain).
  PICKER_API_KEY: "AIzaSyCxRC9lxN3I3nRbyyZjStd7hkIkKyOY86A",

  // drive.file only — this app only ever sees a file once the user has
  // explicitly picked it (via Picker) or it was handed off directly by Drive
  // (via the "Open with" integration). Never a broader scope: that's what
  // keeps OAuth verification at the ordinary tier, not the restricted one.
  SCOPE: "https://www.googleapis.com/auth/drive.file"
};
