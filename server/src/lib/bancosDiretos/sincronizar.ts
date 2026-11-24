import type { Prisma } from '@prisma/client';
import { comPerfil, prisma } from '../prisma';
import { cifrar, decifrar } from '../cripto';
import { aplicarAutomacoes } from '../automacoes';
import { arredondar, dataISO, efeitoNoSaldo, hoje, paraData, registrarPosicaoPatrimonio } from '../financas';
import { ehMovimentoProprio } from '../importacao/extrato';
import { montarCategorizador } from '../importacao/categorizar';
import { CONECTORES } from './conectores';
import { ErroDoBanco } from './http';
import { esquecerToken } from './tipos';
import { avisarNovidade } from '../sinais';
import type { Credenciais } from './tipos';

// Sincronização das conexões diretas: lê saldo e extrato na API do banco e grava na conta ligada, sem repetir
// (chaveImportacao "api:<banco>:<id>"). Na primeira vez traz 90 dias; depois, desde a última vez menos 7 dias
// (o banco às vezes lança com data passada).

const MS_DIA = 86_400_000;
const DIAS_PRIMEIRA_VEZ = 90;
const DIAS_DE_FOLGA = 7;

export function lerCredenciais(cifradas: string): Credenciais | null {
  const texto = decifrar(cifradas);
  if (!texto) return null;
  try {
    return JSON.parse(texto) as Credenciais;
  } catch {
    return null;
  }
}

export function cifrarCredenciais(c: Credenciais): string {
  return cifrar(JSON.stringify(c));
}

// Testa as credenciais (pede o token e o saldo). Lança ErroDoBanco com o motivo.
export async function testarCredenciais(banco: string, c: Credenciais): Promise<void> {
  const conector = CONECTORES[banco];
  if (!conector) throw new ErroDoBanco('Banco sem conector de API direta', null);
  const cache = `teste:${banco}:${Date.now()}`;
  try {
    await conector.saldo(c, cache);
    const ate = dataISO(hoje());
    await conector.extrato(c, dataISO(new Date(hoje().getTime() - 2 * MS_DIA)), ate, cache);
  } finally {
    esquecerToken(cache);
  }
}

async function executar(id: number): Promise<void> {
  const conexao = await prisma.conexaoDireta.findUnique({ where: { id } });
  if (!conexao) return;
  const conector = CONECTORES[conexao.banco];
  const credenciais = lerCredenciais(conexao.credenciaisCifradas);
  if (!conector || !credenciais) {
    await prisma.conexaoDireta.update({
      where: { id },
      data: { status: 'ERRO_LOGIN', erro: 'As credenciais guardadas não abrem mais (o segredo do servidor mudou). Remova e conecte de novo.' },
    });
    return;
  }
  await prisma.conexaoDireta.update({ where: { id }, data: { status: 'ATUALIZANDO', erro: null } });
  const cache = `conexao:${id}`;
  try {
    let conta = conexao.contaId ? await prisma.conta.findUnique({ where: { id: conexao.contaId } }) : null;
    if (!conta) {
      conta = await prisma.conta.create({ data: { nome: conexao.apelido, tipo: 'CORRENTE', instituicao: conector.nome, cor: conector.cor } });
      await prisma.conexaoDireta.update({ where: { id }, data: { contaId: conta.id } });
    }

    const ate = dataISO(hoje());
    const de = dataISO(
      conexao.ultimaSincronizacao
        ? new Date(conexao.ultimaSincronizacao.getTime() - DIAS_DE_FOLGA * MS_DIA)
        : new Date(hoje().getTime() - DIAS_PRIMEIRA_VEZ * MS_DIA),
    );
    const lancamentos = await conector.extrato(credenciais, de, ate, cache);
    const saldo = await conector.saldo(credenciais, cache);

    const chaves = lancamentos.map((l) => `api:${conexao.banco}:${l.idExterno}`.slice(0, 190));
    const existentes = new Set<string>();
    for (let i = 0; i < chaves.length; i += 1000) {
      const achados = await prisma.transacao.findMany({
        where: { contaId: conta.id, chaveImportacao: { in: chaves.slice(i, i + 1000) } },
        select: { chaveImportacao: true },
      });
      for (const a of achados) if (a.chaveImportacao) existentes.add(a.chaveImportacao);
    }
    const categorizar = await montarCategorizador(lancamentos.map((l) => l.descricao));
    const novos: Prisma.TransacaoCreateManyInput[] = [];
    let efeito = 0;
    lancamentos.forEach((l, i) => {
      if (existentes.has(chaves[i])) return;
      existentes.add(chaves[i]); // o mesmo id duas vezes na resposta entra uma vez só
      const transferencia = ehMovimentoProprio(l.descricao);
      const item = { data: l.data, descricao: l.descricao, valor: l.valor, tipo: l.tipo, transferencia, parcela: null, totalParcelas: null };
      novos.push({
        contaId: conta.id,
        data: paraData(l.data),
        descricao: l.descricao,
        valor: l.valor,
        tipo: l.tipo,
        transferencia,
        categoriaId: categorizar(item),
        chaveImportacao: chaves[i],
      });
      efeito += efeitoNoSaldo(conta.tipo, l.tipo, l.valor);
    });
    if (novos.length > 0) await prisma.transacao.createMany({ data: novos });
    if (saldo !== null) {
      await prisma.conta.update({ where: { id: conta.id }, data: { saldo: arredondar(saldo) } });
    } else if (efeito !== 0) {
      await prisma.conta.update({ where: { id: conta.id }, data: { saldo: { increment: arredondar(efeito) } } });
    }
    await prisma.conexaoDireta.update({ where: { id }, data: { status: 'ATUALIZADA', erro: null, ultimaSincronizacao: new Date() } });
    await registrarPosicaoPatrimonio();
    if (novos.length > 0) {
      await aplicarAutomacoes({ desde: paraData(de) }).catch(() => undefined);
      avisarNovidade(); // notificação das movimentações novas sai agora
    }
  } catch (erro) {
    esquecerToken(cache);
    const deLogin = erro instanceof ErroDoBanco && erro.deLogin;
    const mensagem = erro instanceof Error ? erro.message : 'Falha desconhecida';
    await prisma.conexaoDireta.update({
      where: { id },
      data: {
        status: deLogin ? 'ERRO_LOGIN' : 'ERRO',
        erro: (deLogin ? `${mensagem}. Confira as credenciais, o certificado e as permissões da integração no banco.` : mensagem).slice(0, 500),
      },
    });
  }
}

const emAndamento = new Map<number, Promise<void>>();

// Nunca lança: o resultado fica em status e erro. Roda no perfil financeiro dono da conexão.
export function sincronizarDireta(id: number): Promise<void> {
  const atual = emAndamento.get(id);
  if (atual) return atual;
  const execucao = prisma.conexaoDireta
    .findFirst({ where: { id }, select: { perfilId: true } })
    .then((c) => (c ? comPerfil(c.perfilId, () => executar(id)) : undefined))
    .catch((erro: unknown) => console.error('Falha na conexão direta:', erro instanceof Error ? erro.message : erro))
    .finally(() => emAndamento.delete(id));
  emAndamento.set(id, execucao);
  return execucao;
}

export async function sincronizarTodasDiretas(): Promise<void> {
  const todas = await prisma.conexaoDireta.findMany({ select: { id: true }, orderBy: { id: 'asc' } });
  for (const c of todas) await sincronizarDireta(c.id);
}

let automaticaIniciada = false;

// Um minuto e meio depois de subir e, depois, a cada 30 minutos (como o Open Finance).
export function iniciarDiretasAutomaticas(): void {
  if (automaticaIniciada) return;
  automaticaIniciada = true;
  const rodar = () => void sincronizarTodasDiretas().catch(() => undefined);
  setTimeout(rodar, 90_000).unref();
  setInterval(rodar, 30 * 60 * 1000).unref();
}
