import React from 'react';
import {createRoot} from 'react-dom/client';
import {App} from './App.jsx';
import './styles.css';
// 文件被拖到面板外时，浏览器默认会导航到该文件（整页重载，看起来就像面板被关掉）：在入口统一拦掉。
const swallow=e=>e.preventDefault();
window.addEventListener('dragover',swallow);window.addEventListener('drop',swallow);
createRoot(document.getElementById('root')).render(<App/>);
