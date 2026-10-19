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

// 开发期调试钩子：E2E 脚本经 WebView2 远程调试端口直接调用平台/库服务。
if (import.meta.env.DEV) {
  (globalThis as { __tpr?: unknown }).__tpr = services;
}

createRoot(rootElement).render(
  <StrictMode>
    <App services={services} />
  </StrictMode>,
);
