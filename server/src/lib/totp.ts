import crypto from 'crypto';

// Verificação em duas etapas (RFC 6238): código de 6 dígitos, HMAC-SHA1, passo de 30 s.
// Só usa o módulo `crypto` do Node.

const ALFABETO_BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const PASSO_MS = 30_000;
const DIGITOS = 6;

// Letras e números sem os que se confundem (0, 1, i, l, o).
const ALFABETO_RECUPERACAO = '23456789abcdefghjkmnpqrstuvwxyz';

function base32Codificar(bytes: Buffer): string {
  let bits = 0;
  let valor = 0;
  let saida = '';
  for (const byte of bytes) {
    valor = (valor << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      saida += ALFABETO_BASE32[(valor >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    saida += ALFABETO_BASE32[(valor << (5 - bits)) & 31];
  }
  return saida;
}

function base32Decodificar(texto: string): Buffer {
  const limpo = texto.toUpperCase().replace(/=+$/g, '').replace(/\s+/g, '');
  const saida: number[] = [];
  let bits = 0;
  let valor = 0;
  for (const caractere of limpo) {
    const indice = ALFABETO_BASE32.indexOf(caractere);
    if (indice < 0) continue;
    valor = (valor << 5) | indice;
    bits += 5;
    if (bits >= 8) {
      saida.push((valor >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(saida);
}

// Segredo novo: 20 bytes aleatórios em base32, sem `=`.
export function gerarSegredo(): string {
  return base32Codificar(crypto.randomBytes(20));
}

// Código de 6 dígitos para o instante (em milissegundos desde a época).
export function codigoEm(segredo: string, instante: number): string {
  const passo = Math.floor(instante / PASSO_MS);
  const contador = Buffer.alloc(8);
  // 64 bits big-endian; o valor cabe com folga em Number para datas reais.
  contador.writeUInt32BE(Math.floor(passo / 0x100000000), 0);
  contador.writeUInt32BE(passo >>> 0, 4);
  const hmac = crypto.createHmac('sha1', base32Decodificar(segredo)).update(contador).digest();
  const deslocamento = hmac[hmac.length - 1] & 0x0f;
  const binario =
    ((hmac[deslocamento] & 0x7f) << 24) |
    ((hmac[deslocamento + 1] & 0xff) << 16) |
    ((hmac[deslocamento + 2] & 0xff) << 8) |
    (hmac[deslocamento + 3] & 0xff);
  return (binario % 10 ** DIGITOS).toString().padStart(DIGITOS, '0');
}

// Aceita o passo atual e o anterior/seguinte (tolerância de relógio).
export function conferirCodigo(segredo: string, codigo: string): boolean {
  const informado = codigo.replace(/\s+/g, '');
  if (!/^\d{6}$/.test(informado)) return false;
  const agora = Date.now();
  let confere = false;
  for (const desvio of [-PASSO_MS, 0, PASSO_MS]) {
    const esperado = Buffer.from(codigoEm(segredo, agora + desvio));
    const recebido = Buffer.from(informado);
    if (crypto.timingSafeEqual(esperado, recebido)) {
      confere = true;
    }
  }
  return confere;
}

// Endereço otpauth:// para o QR code e para digitar o segredo no aplicativo.
export function enderecoOtpauth(segredo: string, email: string, emissor: string): string {
  return (
    `otpauth://totp/${encodeURIComponent(emissor)}:${encodeURIComponent(email)}` +
    `?secret=${encodeURIComponent(segredo)}` +
    `&issuer=${encodeURIComponent(emissor)}` +
    '&algorithm=SHA1&digits=6&period=30'
  );
}

// Hash guardado no banco para um código de recuperação (sem hífen e em minúsculas antes do sha256).
export function hashCodigoRecuperacao(codigo: string): string {
  const normalizado = codigo.toLowerCase().replace(/[^a-z0-9]/g, '');
  return crypto.createHash('sha256').update(normalizado, 'utf8').digest('hex');
}

// 8 códigos `xxxx-xxxx`: os textos para mostrar ao usuário e os hashes para guardar.
export function gerarCodigosDeRecuperacao(): { codigos: string[]; hashes: string[] } {
  const codigos: string[] = [];
  for (let i = 0; i < 8; i++) {
    let parte = '';
    for (let j = 0; j < 8; j++) {
      parte += ALFABETO_RECUPERACAO[crypto.randomInt(ALFABETO_RECUPERACAO.length)];
    }
    codigos.push(`${parte.slice(0, 4)}-${parte.slice(4)}`);
  }
  return { codigos, hashes: codigos.map(hashCodigoRecuperacao) };
}
