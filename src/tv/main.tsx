import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { TvApp } from './App';
import './tv.css';

// Engines before Chrome 84 (LG's 2021 TVs) ignore `gap` in flex layouts; the
// TV stylesheet uses margins instead when this class is set.
function flexGapWorks(): boolean {
  const box = document.createElement('div');
  box.style.cssText = 'display:flex;flex-direction:column;row-gap:1px;position:absolute;visibility:hidden';
  box.appendChild(document.createElement('div'));
  box.appendChild(document.createElement('div'));
  document.body.appendChild(box);
  const works = box.scrollHeight === 1;
  box.remove();
  return works;
}
if (!flexGapWorks()) document.documentElement.classList.add('no-flex-gap');

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <TvApp />
  </StrictMode>,
);
