import React from 'react';
import { createRoot } from 'react-dom/client';
import { Manager } from '../../ui/Manager';
import '../../ui/styles.css';

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Manager />
  </React.StrictMode>,
);
