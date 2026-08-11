// Sign-in for the native app.
//
// SCOPE: this is the ~150-line unblock, not a port of `LiveOnboard` (1,541
// lines on web, which also carries invite codes, commissioner verification,
// solo passes, DFS joins and the whole enrollment funnel). All this screen has
// to do is turn a person into a session so the rest of the app is reachable.
// Enrollment still happens on the web; the account and the session are the
// same either way.
//
// WHY CODE-BY-EMAIL RATHER THAN A MAGIC LINK: a link would return to
// `dripfantasy://auth#access_token=…`, which means deep-link plumbing plus
// `setSession()` by hand, because the auth SDK is deliberately configured with
// `detectSessionInUrl: false` on native (see platform.native.ts). Supabase
// sends a 6-digit code in the same email, and `verifyEmailOtp` exchanges it
// directly — no deep link, nothing to intercept, and it works even if the mail
// app opens the link on a different device. Core already labelled that function
// "magic-link fallback for mobile".
import { useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import {
  signInPassword, signUpPassword, sendMagicLink, verifyEmailOtp, ensureAppUser, getSession, friendlyError,
  oauthAuthorizeUrl, completeOAuthCallback,
} from '@drip/core/data/liveApi';
import { useTheme, MONO } from '../theme.native';
import { Display, LinkButton, Mono, PrimaryButton } from '../ui/prims';

type Mode = 'password' | 'signup' | 'code-request' | 'code-entry';

export function SignIn({ onSignedIn }: { onSignedIn: () => void }) {
  const t = useTheme();
  const [mode, setMode] = useState<Mode>('password');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  /** Every path ends here: make sure the app_user row exists (it is the FK
   *  target for enrollment, and the web does the same on its first load) before
   *  handing control back. A failure to upsert must not strand a valid
   *  session — the app retries it on the next load. */
  const finish = async () => {
    try {
      const s = await getSession();
      if (s) await ensureAppUser(s);
    } catch { /* non-fatal */ }
    onSignedIn();
  };

  const run = async (fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(true); setErr(null); setNote(null);
    try { await fn(); } catch (e) { setErr(friendlyError(e)); }
    finally { setBusy(false); }
  };

  const submitPassword = () => run(async () => {
    await signInPassword(email, password);
    await finish();
  });

  const submitSignup = () => run(async () => {
    const { needsConfirm } = await signUpPassword(email, password);
    if (needsConfirm) {
      // The project requires email confirmation, so there is no session yet.
      // Send them down the code path rather than leaving them on a form that
      // looks like it failed.
      setMode('code-entry');
      setNote('Account created. Check your email for a 6-digit code and enter it below.');
      return;
    }
    await finish();
  });

  const requestCode = () => run(async () => {
    await sendMagicLink(email);
    setMode('code-entry');
    setNote(`Code sent to ${email.trim()}. It expires in about an hour.`);
  });

  const submitCode = () => run(async () => {
    await verifyEmailOtp(email, code);
    await finish();
  });

  /** Google, via an in-app browser session.
   *
   *  This is the one flow that genuinely needs the deep-link handling the code
   *  path avoids — there is no way to do OAuth without leaving the app and
   *  coming back. `openAuthSessionAsync` keeps it inside an ASWebAuthenticationSession
   *  / Custom Tab, so the return lands here as a value rather than as a cold
   *  app launch we would have to reconstruct state from.
   *
   *  Backing out is not an error: `cancel` (user hit done) and `dismiss` (swiped
   *  it away) both just return them to the form. */
  const google = () => run(async () => {
    const url = await oauthAuthorizeUrl('google');
    const res = await WebBrowser.openAuthSessionAsync(url, Linking.createURL('/auth'));
    if (res.type !== 'success') return;
    await completeOAuthCallback(res.url);
    await finish();
  });

  const input = {
    fontFamily: MONO, fontSize: 16, color: t.text, backgroundColor: t.bg,
    borderWidth: StyleSheet.hairlineWidth, borderColor: t.bd, borderRadius: 6,
    paddingHorizontal: 12, paddingVertical: 12,
  } as const;

  const emailField = (
    <TextInput
      value={email}
      onChangeText={setEmail}
      placeholder="you@example.com"
      placeholderTextColor={t.faint}
      autoCapitalize="none"
      autoCorrect={false}
      keyboardType="email-address"
      textContentType="emailAddress"
      autoComplete="email"
      editable={!busy}
      style={input}
    />
  );

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: t.bg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={{ padding: 24, gap: 14, flexGrow: 1, justifyContent: 'center' }} keyboardShouldPersistTaps="handled">
        <View style={{ gap: 4, marginBottom: 6 }}>
          <Display size={24}>Drip Fantasy</Display>
          <Mono size={10.5} tone="faint">
            {mode === 'signup' ? 'Create an account.'
              : mode === 'code-entry' ? 'Enter the code from your email.'
              : 'Sign in to your league.'}
          </Mono>
        </View>

        {mode === 'code-entry' ? (
          <>
            <TextInput
              value={code}
              onChangeText={setCode}
              placeholder="123456"
              placeholderTextColor={t.faint}
              keyboardType="number-pad"
              autoComplete="one-time-code"
              textContentType="oneTimeCode"
              maxLength={8}
              editable={!busy}
              style={{ ...input, fontSize: 22, letterSpacing: 6, textAlign: 'center' }}
            />
            <PrimaryButton label={busy ? 'CHECKING…' : 'SIGN IN'} disabled={busy || code.trim().length < 6} onPress={submitCode} />
            <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 20, marginTop: 4 }}>
              <LinkButton label="resend" onPress={requestCode} />
              <LinkButton label="← back" onPress={() => { setMode('password'); setCode(''); setNote(null); setErr(null); }} />
            </View>
          </>
        ) : (
          <>
            {emailField}
            <TextInput
              value={password}
              onChangeText={setPassword}
              placeholder="password"
              placeholderTextColor={t.faint}
              secureTextEntry
              autoCapitalize="none"
              autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
              textContentType={mode === 'signup' ? 'newPassword' : 'password'}
              editable={!busy}
              style={input}
            />
            <PrimaryButton
              label={busy ? 'WORKING…' : mode === 'signup' ? 'CREATE ACCOUNT' : 'SIGN IN'}
              disabled={busy || !email.trim() || password.length < 6}
              onPress={mode === 'signup' ? submitSignup : submitPassword}
            />

            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginVertical: 2 }}>
              <View style={{ flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: t.bd }} />
              <Mono size={9} tone="faint" track={0.1}>OR</Mono>
              <View style={{ flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: t.bd }} />
            </View>

            <Pressable
              onPress={google}
              disabled={busy}
              style={{ flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 8, borderWidth: StyleSheet.hairlineWidth, borderColor: t.bdh, backgroundColor: t.surface, borderRadius: 6, paddingVertical: 13, opacity: busy ? 0.6 : 1 }}
            >
              {/* A plain letter mark, not the Google "G" asset. Google's branding
                  guidelines require their supplied logo at a fixed size and
                  wordmark — worth doing with a real asset before this ships to a
                  store, but shipping a wrong-coloured approximation of a
                  trademark is worse than not using one. */}
              <Text style={{ fontSize: 15, fontWeight: '700', color: t.dimstrong }}>G</Text>
              <Text style={{ fontSize: 13, fontWeight: '700', color: t.text }}>Continue with Google</Text>
            </Pressable>

            <Pressable
              onPress={() => (email.trim() ? requestCode() : setErr('Enter your email first.'))}
              disabled={busy}
              style={{ borderWidth: StyleSheet.hairlineWidth, borderColor: t.you, borderRadius: 6, paddingVertical: 13, alignItems: 'center', opacity: busy ? 0.6 : 1 }}
            >
              <Text style={{ fontFamily: MONO, fontSize: 11, fontWeight: '700', letterSpacing: 0.66, color: t.you }}>EMAIL ME A CODE</Text>
            </Pressable>

            <View style={{ alignItems: 'center', marginTop: 6 }}>
              <LinkButton
                label={mode === 'signup' ? 'have an account? sign in' : 'no account? create one'}
                onPress={() => { setMode(mode === 'signup' ? 'password' : 'signup'); setErr(null); setNote(null); }}
              />
            </View>
          </>
        )}

        {busy && <ActivityIndicator color={t.you} />}
        {!!note && <Mono size={10} tone="you">{note}</Mono>}
        {!!err && <Mono size={10.5} tone="opp">{err}</Mono>}

        {/* Password reset deliberately points at the web: resetPasswordForEmail
            sends a LINK (not a code), and handling it here would need the deep-link
            plumbing this screen exists to avoid. */}
        <Mono size={9} tone="faint" style={{ textAlign: 'center', marginTop: 10 }}>
          Forgot your password, or joining with an invite code? Do that at
          dripfantasy.com — it's the same account.
        </Mono>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
