import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { isTauri } from './lib/api';
import './styles.css';

if (isTauri) document.documentElement.classList.add('tauri');

// Native-feeling app: no browser context menu except where we provide one.
window.addEventListener('contextmenu', (e) => {
  if (!(e.target as HTMLElement).closest('input, textarea, .selectable')) e.preventDefault();
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
