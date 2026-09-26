// App push registration (0150) — raw FCM / APNs, no Expo push service.
//
// After sign-in the app asks for notification permission (Android 13+; iOS
// always), makes the channel the worker targets on Android (channel_id
// 'drip-default' in push.js), and registers the DEVICE token with
// register_push_token. On Android that is an FCM token; on iOS it is the raw
// APNs token, registered as platform 'ios' so the worker sends it straight to
// Apple (server/src/apns.js). In an Android build without google-services.json
// (founder-provisioned) getDevicePushTokenAsync throws — caught, pushes simply
// stay off in that build.
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { registerPushToken } from '@drip/core/data/liveApi';
import { Ev, track } from '@drip/core/analytics';

// SHOW IT WHILE THE APP IS OPEN (v0.392.0). expo-notifications drops a push
// that arrives in the foreground unless a handler says otherwise — so with the
// app open (the board, on a Sunday) every alert was silently eaten, and only
// a backgrounded app ever showed one. Founder: "not coming through even
// though I have them on." Banner + shade entry + sound, no badge count.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

let currentToken: string | null = null;

/** The token this device registered this session — the Settings prefs target. */
export function registeredPushToken(): string | null { return currentToken; }

export async function registerForPush(): Promise<boolean> {
  if (Platform.OS !== 'android' && Platform.OS !== 'ios') return false;
  try {
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('drip-default', {
        name: 'Drip Fantasy',
        importance: Notifications.AndroidImportance.HIGH,
        vibrationPattern: [0, 200, 100, 200],
      });
    }
    // The installed expo-modules-core typings don't surface PermissionResponse
    // fields through the extends here — runtime shape is {granted, status}.
    const perm = await Notifications.requestPermissionsAsync() as unknown as { granted?: boolean; status?: string };
    if (!perm.granted && perm.status !== 'granted') { track(Ev.pushRegistered, { granted: false }); return false; }
    const tok = await Notifications.getDevicePushTokenAsync();
    const data = typeof tok?.data === 'string' ? tok.data : null;
    if (!data) return false;
    const r = await registerPushToken(data, Platform.OS);
    if (r.ok) { currentToken = data; track(Ev.pushRegistered, { granted: true }); return true; }
    return false;
  } catch {
    return false; // no Firebase config in this build, or the user said no
  }
}
