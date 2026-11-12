import { Router } from 'express';
import { asyncHandler } from '../../lib/erros';

// Endereço para abrir o sistema em outro aparelho da mesma rede (celular, tablet).
// O servidor roda dentro do Docker e não enxerga o IP da máquina; por isso o endereço vem do ambiente:
//   ENDERECO_REDE   IP ou nome escolhido por quem instalou (ex.: 192.168.0.15 ou financas-pessoais.local)
//   NOME_DA_MAQUINA nome do computador (no Windows o docker-compose preenche sozinho com COMPUTERNAME);
//                   vira "nome.local", que os celulares atuais encontram na rede sem configuração.

const router = Router();

function limpar(valor: string | undefined): string {
  return (valor ?? '')
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/[/:].*$/, '')
    .toLowerCase();
}

router.get(
  '/rede',
  asyncHandler(async (_req, res) => {
    const bruta = (process.env.WEB_PORT ?? '8092').trim();
    const porta = /^\d{1,5}$/.test(bruta) ? bruta : '8092';
    const sufixo = porta === '80' ? '' : ':' + porta;
    const enderecos: { rotulo: string; url: string }[] = [];
    const escolhido = limpar(process.env.ENDERECO_REDE);
    // localhost não serve: no celular ele aponta para o próprio celular.
    const local = escolhido === 'localhost' || escolhido.startsWith('127.');
    if (escolhido && !local && /^[a-z0-9.-]+$/.test(escolhido)) {
      enderecos.push({ rotulo: 'Endereço configurado', url: `http://${escolhido}${sufixo}` });
    }
    const maquina = limpar(process.env.NOME_DA_MAQUINA);
    if (maquina && /^[a-z0-9-]+$/.test(maquina)) {
      enderecos.push({ rotulo: 'Nome do computador', url: `http://${maquina}.local${sufixo}` });
    }
    res.json({ porta: Number(porta), enderecos });
  })
);

export default router;
