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

export function validar<T>(schema: z.ZodType<T>, dados: unknown): T {
  const resultado = schema.safeParse(dados);
  if (!resultado.success) {
    throw new HttpError(400, 'Dados inválidos', resultado.error.issues);
  }
  return resultado.data;
}
