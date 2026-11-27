import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { TvApp } from './App';
import './tv.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <TvApp />
  </StrictMode>,
);
