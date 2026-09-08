import React from 'react';
import { createRoot } from 'react-dom/client';

import 'cesium/Build/Cesium/Widgets/widgets.css';
import './styles/variables.css';
import './styles/base.css';
import './styles/components.css';

import App from './App.jsx';

createRoot(document.getElementById('root')).render(<App />);
