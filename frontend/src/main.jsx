import React from 'react';
import { createRoot } from 'react-dom/client';
import { Checkout } from './checkout.jsx';
import { Admin } from './admin.jsx';
import './styles.css';

const [, section, page] = location.pathname.split('/');
const content = section === 'admin' ? <Admin page={page} /> : <Checkout orderToken={section === 'pedido' ? page : ''} />;
createRoot(document.getElementById('root')).render(content);
