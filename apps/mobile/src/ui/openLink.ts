// OPEN A LINK, AND NEVER FAIL QUIETLY.
//
// v0.556.7 (founder, on What's new: "Now I can't click on anything in the
// footer"): both footer buttons called `void Linking.openURL(url)`, a promise
// nobody watched. That version added a fallback and an alert.
//
// v0.556.10 (founder: "they fade but nothing opens"): the tap arrives, no
// alert shows, and nothing opens — so Linking.openURL reported success (or
// never answered) without a browser ever appearing. The in-app browser
// (expo-web-browser, a Chrome Custom Tab) is what sign-in already uses on
// this phone, and it works there, so it goes FIRST for web links now. Each
// attempt gets a deadline, so one that never answers can't swallow the tap;
// if every route fails, an alert says so and shows the link.
import { Alert, Linking } from 'react-native';
import * as WebBrowser from 'expo-web-browser';

const within = <T,>(p: Promise<T>, ms: number): Promise<T> =>
  Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error(`no answer in ${ms / 1000}s`)), ms))]);

export async function openLink(url: string): Promise<void> {
  const errors: string[] = [];
  const why = (e: unknown) => (e instanceof Error ? e.message : String(e));
  if (/^https?:/i.test(url)) {
    try {
      // Resolves when the tab is dismissed, so only its START is timed: a
      // rejection inside the first moments means it never opened.
      const opened = WebBrowser.openBrowserAsync(url);
      await within(opened.then(() => undefined), 2500).catch((e) => {
        if (!/no answer/.test(why(e))) throw e;   // still open after 2.5s: it's showing
      });
      return;
    } catch (e) { errors.push(`in-app browser: ${why(e)}`); }
  }
  try {
    await within(Linking.openURL(url), 2500);
    return;
  } catch (e) { errors.push(`system: ${why(e)}`); }
  Alert.alert("Couldn't open the link", `${url}\n\n${errors.join('\n')}`);
}
