import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import App from './App.jsx';
import { AuthProvider } from './lib/auth.jsx';
import { StudentProvider } from './lib/student.jsx';
import './index.css';

// HashRouter, а не BrowserRouter: приложението се хоства на GitHub Pages,
// където няма сървър, който да пренасочва дълбоките адреси към index.html.
createRoot(document.getElementById('root')).render(
    <StrictMode>
        <HashRouter>
            <AuthProvider>
                <StudentProvider>
                    <App />
                </StudentProvider>
            </AuthProvider>
        </HashRouter>
    </StrictMode>
);
