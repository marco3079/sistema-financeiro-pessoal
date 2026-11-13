import { Request, Response, NextFunction, RequestHandler } from 'express';
import { z } from 'zod';

export class HttpError extends Error {
  constructor(public status: number, mensagem: string, public detalhes?: unknown) {
    super(mensagem);
    this.name = 'HttpError';
  }
}

export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>
): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

export function idParam(req: Request, nome?: string): number {
  const bruto = req.params[nome ?? 'id'];
  if (typeof bruto !== 'string' || !/^\d+$/.test(bruto)) {
    throw new HttpError(400, `Parâmetro ${nome ?? 'id'} inválido`);
  }
  const id = Number(bruto);
  if (!Number.isSafeInteger(id)) {
    throw new HttpError(400, `Parâmetro ${nome ?? 'id'} inválido`);
  }
  return id;
}

// Nome que a pessoa vê na tela para os campos mais comuns.
const NOME_DO_CAMPO: Record<string, string> = {
  descricao: 'Descrição',
  nome: 'Nome',
  valor: 'Valor',
  data: 'Data',
  observacao: 'Observação',
  categoriaId: 'Categoria',
  contaId: 'Conta',
  email: 'E-mail',
  senha: 'Senha',
  cor: 'Cor',
  taxa: 'Taxa',
  codigo: 'Código',
  instituicao: 'Instituição',
  vencimento: 'Vencimento',
  limite: 'Limite',
  saldo: 'Saldo',
};

// Diz qual campo está errado e por quê, em vez de só "Dados inválidos".
function descreverProblema(problema: z.core.$ZodIssue | undefined): string {
  if (!problema) return 'Dados inválidos';
  const chave = String(problema.path[problema.path.length - 1] ?? '');
  const campo = NOME_DO_CAMPO[chave] ?? chave;
  const prefixo = campo ? campo + ': ' : '';
  if (problema.code === 'too_big') {
    const limite = Number(problema.maximum);
    return problema.origin === 'string' ? `${prefixo}no máximo ${limite} caracteres.` : `${prefixo}o valor máximo é ${limite}.`;
  }
  if (problema.code === 'too_small') {
    const limite = Number(problema.minimum);
    if (problema.origin === 'string') return limite <= 1 ? `${prefixo}preencha este campo.` : `${prefixo}no mínimo ${limite} caracteres.`;
    return `${prefixo}o valor mínimo é ${limite}.`;
  }
  if (problema.code === 'invalid_type') return `${prefixo}preencha este campo com um valor válido.`;
  if (problema.code === 'custom' && problema.message) return prefixo + problema.message;
  return campo ? `${prefixo}valor inválido.` : 'Dados inválidos';
}

export function validar<T>(schema: z.ZodType<T>, dados: unknown): T {
  const resultado = schema.safeParse(dados);
  if (!resultado.success) {
    throw new HttpError(400, descreverProblema(resultado.error.issues[0]), resultado.error.issues);
  }
  return resultado.data;
}
