// Catches render-time exceptions and shows them.
//
// In a DEBUG build an unhandled render error gets a red box with a stack. In a
// RELEASE build it gets nothing — the process closes, with no message, no
// report, and nothing for the person holding the phone to tell you. That is
// precisely how the Intl crash presented: "I log in and it crashes."
//
// So release builds keep a boundary. It is not there to recover — the state
// underneath is unknown and pretending otherwise is worse — it is there so a
// failure is legible instead of silent.
import { Component, type ReactNode } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { THEMES, loadTheme, MONO } from '../theme.native';

interface Props { children: ReactNode }
interface State { error: Error | null; info: string | null }

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, info: null };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack?: string | null }) {
    // Also goes to logcat / Console.app, so `adb logcat -s ReactNativeJS` picks
    // it up when someone does have a cable.
    console.error('[drip] render crash', error, info?.componentStack);
    this.setState({ info: info?.componentStack ?? null });
  }

  render() {
    const { error, info } = this.state;
    if (!error) return this.props.children;

    const t = THEMES[loadTheme()];
    return (
      <View style={{ flex: 1, backgroundColor: t.bg, padding: 20 }}>
        <ScrollView contentContainerStyle={{ gap: 12, paddingBottom: 40 }}>
          <Text style={{ fontSize: 18, fontWeight: '700', color: t.opp }}>Something broke</Text>
          <Text style={{ fontFamily: MONO, fontSize: 11, color: t.text, lineHeight: 17 }}>
            {error.name}: {error.message}
          </Text>
          {!!error.stack && (
            <Text style={{ fontFamily: MONO, fontSize: 9, color: t.dim, lineHeight: 14 }}>
              {error.stack.split('\n').slice(0, 12).join('\n')}
            </Text>
          )}
          {!!info && (
            <Text style={{ fontFamily: MONO, fontSize: 9, color: t.faint, lineHeight: 14 }}>
              {info.split('\n').slice(0, 12).join('\n')}
            </Text>
          )}
          <Pressable
            onPress={() => this.setState({ error: null, info: null })}
            style={{ borderWidth: 1, borderColor: t.you, borderRadius: 6, paddingVertical: 12, alignItems: 'center', marginTop: 8 }}
          >
            <Text style={{ fontFamily: MONO, fontSize: 11, fontWeight: '700', color: t.you }}>TRY AGAIN</Text>
          </Pressable>
          <Text style={{ fontFamily: MONO, fontSize: 9, color: t.faint, lineHeight: 14 }}>
            Screenshot this and send it over — the first two lines are the ones that matter.
          </Text>
        </ScrollView>
      </View>
    );
  }
}
