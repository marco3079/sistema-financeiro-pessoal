// Seed: cria a conta do titular e as categorias padrão. Nenhum dado financeiro é criado.
// Senha inicial: ADMIN_SENHA do .env (8 caracteres ou mais) ou, se ausente/curta, a senha padrão demo1234.
// Idempotente: se já houver usuários, não faz nada.

import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { criarCategoriasPadrao } from './categorias-padrao';

const prisma = new PrismaClient();

const SENHA_PADRAO = 'demo1234';

async function main(): Promise<void> {
  // O perfil financeiro "Pessoal" (id 1) recebe tudo o que já existia antes de haver perfis.
  if ((await prisma.perfilFinanceiro.count()) === 0) {
    await prisma.perfilFinanceiro.create({ data: { id: 1, nome: 'Pessoal' } });
    await prisma.$executeRawUnsafe(
      `SELECT setval(pg_get_serial_sequence('"PerfilFinanceiro"', 'id'), GREATEST((SELECT MAX(id) FROM "PerfilFinanceiro"), 1))`
    );
  }

  if ((await prisma.usuario.count()) > 0) {
    console.log('Banco já possui dados, seed ignorado.');
    return;
  }

  const nome = process.env.ADMIN_NOME || 'Demo';
  const email = (process.env.ADMIN_EMAIL || 'demo@financas.local').trim().toLowerCase();
  const senhaEnv = process.env.ADMIN_SENHA || '';

  let senha = senhaEnv;
  let padrao = false;
  if (senha.length < 8) {
    senha = SENHA_PADRAO;
    padrao = true;
  }

  await prisma.usuario.create({
    data: {
      nome,
      email,
      perfil: 'TITULAR',
      ativo: true,
      senhaHash: bcrypt.hashSync(senha, 10),
    },
  });

  await criarCategoriasPadrao(prisma, 1);

  console.log('==== TITULAR CRIADO ====');
  console.log(`E-mail: ${email}`);
  if (padrao) {
    console.log(`Senha padrão: ${SENHA_PADRAO}`);
  }
  console.log('Troque a senha em "Meu perfil" depois do primeiro acesso.');
  console.log('=======================');

}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e: unknown) => {
    console.error('Erro ao executar o seed:', e);
    await prisma.$disconnect();
    process.exit(1);
  });
