// FIRST import, and it must stay first: installing the platform adapter is an
// import side effect, and everything below reaches into @drip/core, which reads
// storage, env and the launch URL through it. Same constraint as the web app's
// main.tsx — see the note in src/platform.native.ts.
import './src/platform.native';

import { registerRootComponent } from 'expo';
import { App } from './App';

registerRootComponent(App);
