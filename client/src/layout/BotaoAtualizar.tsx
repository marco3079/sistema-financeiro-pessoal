import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import type { AtualizacaoDTO } from '../modules/atualizacao/Atualizacao';
import '../modules/atualizacao/atualizacao.css';
import { Icone } from '../ui/icones';

const INTERVALO_MS = 30 * 60 * 1000;

// Botão redondo do topo: aparece só quando há versão nova do sistema.
export function BotaoAtualizar() {
  const navigate = useNavigate();
  const [dados, setDados] = useState<AtualizacaoDTO | null>(null);

  useEffect(() => {
    let ativo = true;
    function consultar() {
      api
        .get<AtualizacaoDTO>('/atualizacao')
        .then((d) => {
          if (ativo) setDados(d);
        })
        .catch(() => undefined);
    }
    consultar();
    const intervalo = window.setInterval(consultar, INTERVALO_MS);
    return () => {
      ativo = false;
      window.clearInterval(intervalo);
    };
  }, []);

  if (!dados || !dados.haNovidade) return null;

  return (
    <button
      type="button"
      className="casca-botao-redondo atu-botao-topo"
      aria-label="Há uma versão nova do sistema"
      title="Há uma versão nova do sistema"
      onClick={() => navigate('/app/atualizacao')}
    >
      <Icone nome="seta-baixo" tamanho={22} />
      <span className="atu-ponto" aria-hidden="true" />
    </button>
  );
}
