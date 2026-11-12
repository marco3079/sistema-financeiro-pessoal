import crypto from 'crypto';
import { segredoDoServidor } from './auth';

// Cifra simétrica (AES-256-GCM) para segredos guardados no banco, como a senha do SMTP.
// Chave = SHA-256 do segredo efetivo do servidor (o JWT_SECRET do .env; se ele estiver ausente
// ou for o de exemplo, o servidor usa um segredo aleatório por execução, e o que foi cifrado
// antes deixa de abrir: a senha precisa ser digitada de novo).
// Formato do texto cifrado: iv.tag.dados, cada parte em base64.

const ALGORITMO = 'aes-256-gcm';
const TAMANHO_IV = 12;
const TAMANHO_TAG = 16;

let chaveCache: Buffer | null = null;

function chave(): Buffer {
  if (chaveCache === null) {
    chaveCache = crypto.createHash('sha256').update('cifra-do-banco:' + segredoDoServidor(), 'utf8').digest();
  }
  return chaveCache;
}

export function cifrar(texto: string): string {
  const iv = crypto.randomBytes(TAMANHO_IV);
  const cifra = crypto.createCipheriv(ALGORITMO, chave(), iv);
  const dados = Buffer.concat([cifra.update(texto, 'utf8'), cifra.final()]);
  const tag = cifra.getAuthTag();
  return [iv, tag, dados].map((parte) => parte.toString('base64')).join('.');
}

// Devolve o texto original, ou null se o formato for inválido ou o segredo tiver mudado.
export function decifrar(cifrado: string): string | null {
  try {
    const partes = cifrado.split('.');
    if (partes.length !== 3) return null;
    const iv = Buffer.from(partes[0], 'base64');
    const tag = Buffer.from(partes[1], 'base64');
    const dados = Buffer.from(partes[2], 'base64');
    if (iv.length !== TAMANHO_IV || tag.length !== TAMANHO_TAG) return null;
    const decifra = crypto.createDecipheriv(ALGORITMO, chave(), iv);
    decifra.setAuthTag(tag);
    return Buffer.concat([decifra.update(dados), decifra.final()]).toString('utf8');
  } catch {
    return null;
  }
}
