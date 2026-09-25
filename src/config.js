// Same Google Cloud project as the Android app (780542948149) on purpose: `drive.file`
// only exposes files created under the *same project*, so this Web client is what lets the
// web app see the notes and attachments the Android app wrote. The Client ID is public.
export const CONFIG = {
  CLIENT_ID: "780542948149-a0rss7422ok4pq4pc4pofq2q4bls2qe3.apps.googleusercontent.com",
  SCOPE: "https://www.googleapis.com/auth/drive.file",
  APP_FOLDER_NAME: "QuietPad",
  ATTACHMENTS_FOLDER_NAME: "Attachments",
  FOLDER_MIME: "application/vnd.google-apps.folder",
  // What the Android app tags every note with, so "Open with QuietPad" finds only its own.
  NOTE_MIME: "application/vnd.quietpad.note+markdown"
};
