import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createServices } from '@tpr/core';
import { App } from './App.js';
import { createPlatform } from './platform/index.js';
import './styles.css';

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('index.html 缺少 #root 节点');

const platform = await createPlatform();
const services = createServices(platform);

createRoot(rootElement).render(
  <StrictMode>
    <App services={services} />
  </StrictMode>,
);
