import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { AuthProvider } from './lib/auth';
import { PlataformaProvider } from './lib/plataforma';
import './ui/estilo.css';
import { CHAVE_PERFIL } from './lib/perfilFinanceiro';

// Link de notificação (?perfil=ID): abre já no perfil financeiro do aviso e tira o parâmetro do endereço.
(() => {
  const url = new URL(window.location.href);
  const perfil = url.searchParams.get('perfil');
  if (!perfil || !/^\d+$/.test(perfil)) return;
  try {
    localStorage.setItem(CHAVE_PERFIL, perfil);
  } catch {
    // Sem armazenamento local: segue no perfil de sempre.
  }
  url.searchParams.delete('perfil');
  window.history.replaceState(null, '', url.pathname + url.search + url.hash);
})();

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
