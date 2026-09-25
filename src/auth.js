import { signal } from "@preact/signals";
import { CONFIG } from "./config.js";

// status: "signedOut" | "signingIn" | "signedIn"
export const auth = signal({ status: "signedOut", email: null, error: null });
// True once a silent token refresh has failed mid-session: the UI shows a Reconnect button,
// because a refresh outside a user click can be blocked by the browser's popup rules.
export const needsReconnect = signal(false);

const HINT_KEY = "quietpad-google-hint";
const EXPIRY_MARGIN_MS = 60_000;

let client = null;
let token = null;
let tokenExpiresAt = 0;
let pending = null;

function gisReady() {
  return new Promise((resolve) => {
    const check = () => (window.google?.accounts?.oauth2 ? resolve() : setTimeout(check, 100));
    check();
  });
}

async function ensureClient() {
  if (client) return client;
  await gisReady();
  client = window.google.accounts.oauth2.initTokenClient({
    client_id: CONFIG.CLIENT_ID,
    scope: CONFIG.SCOPE,
    hint: localStorage.getItem(HINT_KEY) || undefined,
    callback: (resp) => {
      const p = pending;
      pending = null;
      if (!p) return;
      if (resp.error) return p.reject(new Error(resp.error_description || resp.error));
      token = resp.access_token;
      tokenExpiresAt = Date.now() + (Number(resp.expires_in) || 3600) * 1000;
      p.resolve(token);
    },
    error_callback: (e) => {
      const p = pending;
      pending = null;
      p?.reject(new Error(e?.type || "popup_failed"));
    }
  });
  return client;
}

async function request(prompt) {
  const c = await ensureClient();
  return new Promise((resolve, reject) => {
    pending = { resolve, reject };
    c.requestAccessToken({ prompt });
  });
}

async function loadIdentity() {
  const res = await fetch("https://www.googleapis.com/drive/v3/about?fields=user(emailAddress,displayName)", {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!res.ok) return null;
  return (await res.json()).user ?? null;
}

async function completeSignIn() {
  const user = await loadIdentity();
  if (user?.emailAddress) localStorage.setItem(HINT_KEY, user.emailAddress);
  needsReconnect.value = false;
  auth.value = { status: "signedIn", email: user?.emailAddress ?? null, error: null };
}

/** Must be called from a click. */
export async function signIn({ chooseAccount = false } = {}) {
  auth.value = { ...auth.value, status: "signingIn", error: null };
  try {
    await request(chooseAccount || !localStorage.getItem(HINT_KEY) ? "select_account" : "");
    await completeSignIn();
  } catch (e) {
    auth.value = { status: "signedOut", email: null, error: friendlyAuthError(e) };
  }
}

/** On page load: reuse an existing Google session without a click if that's allowed. */
export async function trySilentSignIn() {
  if (!localStorage.getItem(HINT_KEY)) return false;
  auth.value = { ...auth.value, status: "signingIn" };
  try {
    await request("");
    await completeSignIn();
    return true;
  } catch {
    auth.value = { status: "signedOut", email: null, error: null };
    return false;
  }
}

export async function reconnect() {
  try {
    await request("");
    needsReconnect.value = false;
  } catch (e) {
    auth.value = { ...auth.value, error: friendlyAuthError(e) };
  }
}

export function signOut() {
  if (token && window.google?.accounts?.oauth2) window.google.accounts.oauth2.revoke(token, () => {});
  token = null;
  tokenExpiresAt = 0;
  localStorage.removeItem(HINT_KEY);
  client = null;
  auth.value = { status: "signedOut", email: null, error: null };
}

export function invalidateToken() {
  tokenExpiresAt = 0;
}

/** A valid access token, refreshing it quietly if it has (nearly) expired. */
export async function getToken() {
  if (token && Date.now() < tokenExpiresAt - EXPIRY_MARGIN_MS) return token;
  try {
    return await request("");
  } catch (e) {
    needsReconnect.value = true;
    throw new Error("Your Google session expired. Reconnect to keep saving.");
  }
}

function friendlyAuthError(e) {
  const m = e?.message || String(e);
  if (m.includes("popup_failed_to_open")) return "Your browser blocked the sign-in window. Allow pop-ups for this site and try again.";
  if (m.includes("popup_closed")) return "Sign-in was cancelled.";
  if (m.includes("access_denied")) return "Access was denied. QuietPad needs permission to its own files to show your notes.";
  return `Sign-in failed: ${m}`;
}
