import { api } from './api';

// Notificações no celular (Web Push), do lado do navegador.

export interface TipoNotificacaoDTO {
  id: string;
  rotulo: string;
  descricao: string;
}

export interface PreferenciasPushDTO {
  desligados: string[];
  perfisLigados: number[]; // perfis financeiros de que a pessoa quer receber avisos
  silencioAtivo: boolean;
  silencioInicio: number;
  silencioFim: number;
}

export interface ConfigPushDTO {
  chavePublica: string;
  tipos: TipoNotificacaoDTO[];
  preferencias: PreferenciasPushDTO;
  aparelhos: number;
  perfis: { id: number; nome: string; cor: string; ligado: boolean }[];
}

export type SituacaoPush =
  | 'sem-suporte' // navegador sem push (ou iPhone fora do app instalado)
  | 'sem-https' // aberto por http: o navegador não deixa
  | 'bloqueado' // a pessoa negou a permissão
  | 'desligado' // pode ligar
  | 'ligado';

export function abertoComoApp(): boolean {
  if (window.matchMedia('(display-mode: standalone)').matches) return true;
  return (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
}

export function ehIphone(): boolean {
  return /iPhone|iPad|iPod/.test(navigator.userAgent);
}

export async function situacaoPush(): Promise<SituacaoPush> {
  if (!window.isSecureContext) return 'sem-https';
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return 'sem-suporte';
  if (Notification.permission === 'denied') return 'bloqueado';
  const registro = await navigator.serviceWorker.getRegistration();
  const inscricao = registro ? await registro.pushManager.getSubscription() : null;
  return inscricao && Notification.permission === 'granted' ? 'ligado' : 'desligado';
}

function chaveParaBytes(base64: string): Uint8Array {
  const limpo = (base64 + '='.repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  const texto = atob(limpo);
  const bytes = new Uint8Array(texto.length);
  for (let i = 0; i < texto.length; i++) bytes[i] = texto.charCodeAt(i);
  return bytes;
}

function descreverAparelho(): string {
  const ua = navigator.userAgent;
  const so = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows' : /Mac OS X/.test(ua) ? 'Mac' : 'outro sistema';
  const nav = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'navegador';
  return `${nav} no ${so}`;
}

async function registroDoApp(): Promise<ServiceWorkerRegistration> {
  const registro = (await navigator.serviceWorker.getRegistration()) ?? (await navigator.serviceWorker.register('/sw.js'));
  await navigator.serviceWorker.ready;
  return registro;
}

// Pede a permissão (precisa vir de um toque da pessoa), inscreve o aparelho e manda a inscrição ao servidor.
export async function ligarPush(chavePublica: string): Promise<SituacaoPush> {
  const permissao = await Notification.requestPermission();
  if (permissao !== 'granted') return permissao === 'denied' ? 'bloqueado' : 'desligado';
  const registro = await registroDoApp();
  const chave = chaveParaBytes(chavePublica);
  let inscricao = await registro.pushManager.getSubscription();
  // Inscrição antiga feita com outra chave do servidor: troca.
  const antiga = inscricao?.options.applicationServerKey;
  if (inscricao && antiga) {
    const a = new Uint8Array(antiga);
    if (a.length !== chave.length || a.some((b, i) => b !== chave[i])) {
      await inscricao.unsubscribe();
      inscricao = null;
    }
  }
  inscricao ??= await registro.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: chave as unknown as BufferSource,
  });
  const json = inscricao.toJSON();
  await api.post('/notificacoes/push/inscricao', { endpoint: json.endpoint, keys: json.keys, aparelho: descreverAparelho() });
  return 'ligado';
}

export async function desligarPush(): Promise<void> {
  const registro = await navigator.serviceWorker.getRegistration();
  const inscricao = registro ? await registro.pushManager.getSubscription() : null;
  if (!inscricao) return;
  await api.post('/notificacoes/push/remover', { endpoint: inscricao.endpoint }).catch(() => undefined);
  await inscricao.unsubscribe();
}

// Reenvia a inscrição atual ao servidor (o navegador pode trocar o endereço sozinho, e outra pessoa pode ter
// entrado neste aparelho). Silencioso.
export async function renovarPush(): Promise<void> {
  try {
    if ((await situacaoPush()) !== 'ligado') return;
    const registro = await navigator.serviceWorker.getRegistration();
    const json = (await registro?.pushManager.getSubscription())?.toJSON();
    if (json?.endpoint) {
      await api.post('/notificacoes/push/inscricao', { endpoint: json.endpoint, keys: json.keys, aparelho: descreverAparelho() });
    }
  } catch {
    // Sem rede ou sem login: tenta de novo na próxima abertura.
  }
}
