import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { AuthProvider } from './lib/auth';
import { PlataformaProvider } from './lib/plataforma';
import './ui/estilo.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <BrowserRouter>
    <PlataformaProvider>
      <AuthProvider>
        <App />
      </AuthProvider>
    </PlataformaProvider>
  </BrowserRouter>,
);

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    // O app funciona sem o service worker; ele só permite instalar na tela inicial.
    navigator.serviceWorker.register('/sw.js').catch(() => undefined);
  });
}
