// Intl BEFORE everything: core derives NFL game windows in Eastern Time via
// Intl.DateTimeFormat, and Hermes's own Intl can't do IANA time zones. This
// has to be installed before any module that might format a date runs. See
// src/intl-polyfill.ts.
import './src/intl-polyfill';

// Then the platform adapter, also as an import side effect, because everything
// below reaches into @drip/core, which reads storage, env and the launch URL
// through it. Same constraint as the web app's main.tsx — see the note in
// src/platform.native.ts.
import './src/platform.native';

import { registerRootComponent } from 'expo';
import { App } from './App';

registerRootComponent(App);
