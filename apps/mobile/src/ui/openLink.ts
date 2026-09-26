// OPEN A LINK, AND NEVER FAIL QUIETLY (v0.556.7, founder, on What's new:
// "Now I can't click on anything in the footer"). Both footer buttons called
// `void Linking.openURL(url)` — a promise nobody watched, so a refusal looked
// exactly like a dead button. Now: the system handler first; if that refuses,
// the in-app browser (expo-web-browser, a Custom Tab); if that fails too, an
// alert that says what went wrong and shows the link, so it can be copied.
import { Alert, Linking } from 'react-native';
import * as WebBrowser from 'expo-web-browser';

export async function openLink(url: string): Promise<void> {
  try {
    await Linking.openURL(url);
    return;
  } catch (first) {
    try {
      await WebBrowser.openBrowserAsync(url);
      return;
    } catch (second) {
      const why = (e: unknown) => (e instanceof Error ? e.message : String(e));
      Alert.alert("Couldn't open the link", `${url}\n\n${why(first)}\n${why(second)}`);
    }
  }
}
