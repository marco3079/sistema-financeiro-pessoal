import { useState } from 'react';
import { useDados } from '../../lib/useDados';
import { Abas, Aviso, Carregando, Pagina, Selecao } from '../../ui';
import { Vazio } from '../../ui/financas';
import { AbaAnalises } from './AbaAnalises';
import { AbaProventos } from './AbaProventos';
import { AbaRelatorio } from './AbaRelatorio';
import { AbaResumo } from './AbaResumo';
import type { CarteiraDTO, ClasseCarteira } from './tipos';
import './carteira.css';

type Aba = 'resumo' | 'analises' | 'relatorio' | 'proventos';

const ABAS: { id: Aba; rotulo: string }[] = [
  { id: 'resumo', rotulo: 'Resumo' },
  { id: 'analises', rotulo: 'Análises' },
  { id: 'relatorio', rotulo: 'Relatório' },
  { id: 'proventos', rotulo: 'Proventos' },
];

const PERIODOS = [
  { valor: '6', rotulo: '6 meses' },
  { valor: '12', rotulo: '12 meses' },
  { valor: '24', rotulo: '24 meses' },
  { valor: '60', rotulo: '5 anos' },
  { valor: '0', rotulo: 'Desde o início' },
];

// Carteira de investimentos: resumo, análises de rentabilidade, relatório e proventos.
// As três primeiras abas usam a mesma consulta (GET /carteira); a de proventos busca a dela.
export function Carteira() {
  const [aba, setAba] = useState<Aba>('resumo');
  const [meses, setMeses] = useState('24');
  const [classe, setClasse] = useState<'TODAS' | ClasseCarteira>('TODAS');
  const daCarteira = aba !== 'proventos';
  const { dados, carregando, erro } = useDados<CarteiraDTO>(
    daCarteira ? `/carteira?meses=${meses}${classe === 'TODAS' ? '' : '&classe=' + classe}` : null
  );

  return (
    <Pagina
      titulo="Carteira"
      acoes={
        daCarteira ? <Selecao rotulo="Período" valor={meses} aoMudar={setMeses} opcoes={PERIODOS} /> : undefined
      }
    >
      <Abas abas={ABAS} ativa={aba} aoMudar={(id) => setAba(ABAS.find((a) => a.id === id)?.id ?? 'resumo')} />

      {daCarteira && erro && <Aviso tipo="erro">{erro}</Aviso>}
      {daCarteira && !dados && carregando && (
        <>
          <Carregando />
          <p className="fin-suave">Montando o histórico da carteira. Na primeira vez, a busca dos preços pode levar meio minuto.</p>
        </>
      )}
      {daCarteira && dados && dados.avisos.map((aviso, i) => (
        <Aviso key={i} tipo="info">
          {aviso}
        </Aviso>
      ))}
      {daCarteira && dados && dados.resumo.ativos === 0 && classe === 'TODAS' && (
        <Vazio
          icone="investimentos"
          titulo="Nenhum investimento na carteira"
          texto="Importe a planilha de movimentação da B3 em Importar ou cadastre seus investimentos."
        />
      )}
      {daCarteira && dados && (dados.resumo.ativos > 0 || classe !== 'TODAS') && (
        <div className={carregando ? 'cart-conteudo cart-atualizando' : 'cart-conteudo'}>
          {aba === 'resumo' && <AbaResumo dados={dados} />}
          {aba === 'analises' && <AbaAnalises dados={dados} classe={classe} aoMudarClasse={setClasse} />}
          {aba === 'relatorio' && <AbaRelatorio dados={dados} />}
        </div>
      )}
      {aba === 'proventos' && <AbaProventos />}
    </Pagina>
  );
}
