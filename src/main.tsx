import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { StoreProvider } from './app/store';
import { App } from './App';
import { initAnalytics } from './app/analytics';
import './styles.css';

initAnalytics();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <StoreProvider>
      <App />
    </StoreProvider>
  </StrictMode>,
);
