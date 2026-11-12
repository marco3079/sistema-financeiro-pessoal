// Seed padrão: cria só a conta do titular.
// Senha inicial: ADMIN_SENHA do .env (8 caracteres ou mais) ou, se ausente/curta, a senha padrão demo1234.
// Idempotente: se já houver usuários, não faz nada.
// Os dados de demonstração ficam em seed-demo.ts e só entram com SEED_DEMO=true.

import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { carregarDemonstracao, criarCategoriasPadrao } from './seed-demo';

const prisma = new PrismaClient();

const SENHA_PADRAO = 'demo1234';

async function main(): Promise<void> {
  if ((await prisma.usuario.count()) > 0) {
    console.log('Banco já possui dados, seed ignorado.');
    return;
  }

  const nome = process.env.ADMIN_NOME || 'Demo';
  const email = (process.env.ADMIN_EMAIL || 'demo@financas.local').trim().toLowerCase();
  const senhaEnv = process.env.ADMIN_SENHA || '';
  const demo = process.env.SEED_DEMO === 'true';

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

  await criarCategoriasPadrao(prisma);

  console.log('==== TITULAR CRIADO ====');
  console.log(`E-mail: ${email}`);
  if (padrao) {
    console.log(`Senha padrão: ${SENHA_PADRAO}`);
  }
  console.log('Troque a senha em "Meu perfil" depois do primeiro acesso.');
  console.log('=======================');

  if (demo) {
    await carregarDemonstracao(prisma);
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e: unknown) => {
    console.error('Erro ao executar o seed:', e);
    await prisma.$disconnect();
    process.exit(1);
  });
