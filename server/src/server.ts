import { criarApp } from './app';

const porta = Number(process.env.PORT ?? 3000);

criarApp().listen(porta, () => {
  console.log(`Servidor rodando na porta ${porta}`);
});
