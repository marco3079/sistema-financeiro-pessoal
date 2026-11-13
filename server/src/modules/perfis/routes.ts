import { Router } from 'express';
import { z } from 'zod';
import { prisma, comPerfil, perfilAtual } from '../../lib/prisma';
import { asyncHandler, HttpError, idParam, validar } from '../../lib/erros';
import { arredondar, corSchema, textoCurto, totaisPatrimonio } from '../../lib/financas';
import { apagarPerfil, criarPerfil } from '../../lib/perfil';

// Perfis financeiros ("Pessoal", "Empresa", "Casal"): cada um com as próprias contas, cartões, faturas,
// investimentos, categorias, orçamentos e metas. O navegador escolhe o perfil pelo cabeçalho X-Perfil.

const router = Router();

const perfilSchema = z.object({ nome: textoCurto, cor: corSchema.optional() });

router.get(
  '/perfis',
  asyncHandler(async (req, res) => {
    const atual = perfilAtual();
    // LEITOR: só vê o perfil financeiro dele (o que está em uso na requisição).
    const todos = await prisma.perfilFinanceiro.findMany({ orderBy: { id: 'asc' } });
    const perfis = req.usuario?.perfil === 'LEITOR' ? todos.filter((p) => p.id === atual) : todos;
    const lista = await Promise.all(
      perfis.map((p) =>
        comPerfil(p.id, async () => {
          const [contas, investimentos, totais] = await Promise.all([
            prisma.conta.count({ where: { ativo: true } }),
            prisma.investimento.count({ where: { ativo: true } }),
            totaisPatrimonio(),
          ]);
          return {
            id: p.id,
            nome: p.nome,
            cor: p.cor,
            criadoEm: p.criadoEm.toISOString(),
            atual: p.id === atual,
            contas,
            investimentos,
            patrimonio: arredondar(totais.patrimonio),
          };
        })
      )
    );
    res.json(lista);
  })
);

router.post(
  '/perfis',
  asyncHandler(async (req, res) => {
    const dados = validar(perfilSchema, req.body);
    if ((await prisma.perfilFinanceiro.count()) >= 20) throw new HttpError(400, 'O limite é de 20 perfis');
    const repetido = await prisma.perfilFinanceiro.findFirst({ where: { nome: { equals: dados.nome, mode: 'insensitive' } } });
    if (repetido) throw new HttpError(409, 'Já existe um perfil com esse nome');
    const criado = await criarPerfil(dados.nome, dados.cor ?? '#2563eb');
    res.status(201).json({ id: criado.id, nome: criado.nome, cor: criado.cor, criadoEm: criado.criadoEm.toISOString() });
  })
);

router.put(
  '/perfis/:id',
  asyncHandler(async (req, res) => {
    const id = idParam(req);
    const dados = validar(perfilSchema.partial(), req.body);
    const existente = await prisma.perfilFinanceiro.findUnique({ where: { id } });
    if (!existente) throw new HttpError(404, 'Perfil não encontrado');
    if (dados.nome) {
      const repetido = await prisma.perfilFinanceiro.findFirst({
        where: { id: { not: id }, nome: { equals: dados.nome, mode: 'insensitive' } },
      });
      if (repetido) throw new HttpError(409, 'Já existe um perfil com esse nome');
    }
    const atualizado = await prisma.perfilFinanceiro.update({ where: { id }, data: { nome: dados.nome, cor: dados.cor } });
    res.json({ id: atualizado.id, nome: atualizado.nome, cor: atualizado.cor, criadoEm: atualizado.criadoEm.toISOString() });
  })
);

// Apaga o perfil com todos os dados dele. Não deixa apagar o último.
router.delete(
  '/perfis/:id',
  asyncHandler(async (req, res) => {
    const id = idParam(req);
    const existente = await prisma.perfilFinanceiro.findUnique({ where: { id } });
    if (!existente) throw new HttpError(404, 'Perfil não encontrado');
    if ((await prisma.perfilFinanceiro.count()) <= 1) throw new HttpError(400, 'Não dá para apagar o único perfil');
    await apagarPerfil(id);
    res.status(204).end();
  })
);

export default router;
