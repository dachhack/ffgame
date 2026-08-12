// Google sign-in WITHOUT the browser.
//
// The OAuth flow the app shipped with opens a Custom Tab, bounces through
// Google, and deep-links back. It works, and it flashes a web page on the way
// past — which is what a browser-based flow looks like, not a bug in ours.
//
// Play Services can do the same handshake natively: the account picker is a
// system sheet, and what comes back is a signed ID TOKEN, which Supabase trades
// for a session (`signInWithGoogleIdToken`). No browser, no deep link, no cold
// return into an app that has to rebuild its state.
//
// CONFIGURED, NOT ASSUMED. This needs a Google Cloud client that only the
// project owner can create, so `nativeGoogleReady()` reports whether this build
// actually has one and SignIn keeps the browser flow for when it doesn't. A
// half-configured build falls back rather than dead-ending on a button that
// cannot work.
//
// What has to exist for it to switch on — all three, or the token is refused:
//   1. Google Cloud → Credentials → an ANDROID OAuth client for
//      com.dripfantasy.app with the signing cert's SHA-1. For playtest builds
//      that is the committed keystore: AC:D4:CF:A3:31:1F:D4:3B:1A:61:42:AC:2D:
//      48:E6:A3:F8:3A:BF:3E. A Play-signed release has a DIFFERENT SHA-1 and
//      needs its own client.
//   2. Google Cloud → Credentials → a WEB OAuth client. Its id lives in
//      liveConfig.googleWebClientId (committed — an OAuth client id is public,
//      see the note there), overridable with VITE_GOOGLE_WEB_CLIENT_ID. The
//      Android client authorises the app, but the ID TOKEN is minted for the
//      web client, and that is the `aud` Supabase checks.
//   3. Supabase → Authentication → Providers → Google → Authorized Client IDs:
//      both ids. Supabase rejects an ID token whose audience it doesn't know,
//      which is what stops anyone bringing their own token.
import { googleWebClientId } from '@drip/core/data/liveConfig';
import { signInWithGoogleIdToken } from '@drip/core/data/liveApi';

/** Whether this build can do the native flow at all: a client id AND the native
 *  module actually linked in. The module is a `require` rather than a top-level
 *  import so a build without it — Expo Go, or a prebuild that dropped it —
 *  falls back to the browser instead of failing to load this screen. */
export function nativeGoogleReady(): boolean {
  if (!googleWebClientId()) return false;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return !!require('@react-native-google-signin/google-signin')?.GoogleSignin;
  } catch {
    return false;
  }
}

/** Run the native flow. Resolves false when the user backed out — which is not
 *  an error and must not be reported as one — and throws only on a real
 *  failure, so the caller can show it. */
export async function signInWithGoogleNative(): Promise<boolean> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require('@react-native-google-signin/google-signin');
  const { GoogleSignin, statusCodes } = mod;

  GoogleSignin.configure({ webClientId: googleWebClientId() });
  await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });

  let res: unknown;
  try {
    res = await GoogleSignin.signIn();
  } catch (e) {
    const code = (e as { code?: string })?.code;
    // Cancelled / already running are the user's business, not a failure.
    if (code === statusCodes?.SIGN_IN_CANCELLED || code === statusCodes?.IN_PROGRESS) return false;
    throw e;
  }

  // v13+ returns { type, data }; older builds return the user object flat.
  // Read both rather than pinning a shape — a silent null here would look
  // exactly like a cancel and send the player back to the form with no reason.
  const r = res as { type?: string; data?: { idToken?: string | null }; idToken?: string | null };
  if (r?.type === 'cancelled') return false;
  const idToken = r?.data?.idToken ?? r?.idToken ?? null;
  if (!idToken) throw new Error('Google didn’t return an ID token. Check the Web client id in this build.');

  await signInWithGoogleIdToken(idToken);
  return true;
}
