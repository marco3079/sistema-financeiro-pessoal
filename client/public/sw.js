// Service worker mínimo: não faz cache, só repassa as requisições para a rede.
self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  event.respondWith(fetch(event.request));
});

// Notificação do servidor (Web Push). A carga vem de server/src/lib/notificacoes.ts.
self.addEventListener('push', (event) => {
  let dados = {};
  try {
    dados = event.data ? event.data.json() : {};
  } catch {
    dados = { corpo: event.data ? event.data.text() : '' };
  }
  const titulo = dados.titulo || 'Finanças Pessoais';
  event.waitUntil(
    self.registration.showNotification(titulo, {
      body: dados.corpo || '',
      icon: '/logo-simbolo-192.png',
      badge: '/logo-simbolo-192.png',
      tag: dados.tag,
      renotify: false,
      silent: Boolean(dados.silenciosa),
      data: { url: dados.url || '/app' },
    })
  );
});

// Toque na notificação: abre a tela do aviso (reaproveita a janela do app, se já estiver aberta).
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const destino = new URL((event.notification.data && event.notification.data.url) || '/app', self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((janelas) => {
      for (const janela of janelas) {
        if (new URL(janela.url).origin === self.location.origin && 'navigate' in janela) {
          return janela.focus().then(() => janela.navigate(destino));
        }
      }
      return self.clients.openWindow(destino);
    })
  );
});
