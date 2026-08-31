import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';

// Karanlik tema onden uygulanir ki acilista beyaz parlama olmasin;
// kullanicinin tercihi yuklendiginde App bunu duzeltir.
document.documentElement.classList.add('dark');

const container = document.getElementById('root');
if (!container) throw new Error('#root bulunamadi');

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
