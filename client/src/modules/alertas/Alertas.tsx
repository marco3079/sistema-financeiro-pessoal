import { Link } from 'react-router-dom';
import { formatarDia, formatarReais } from '../../lib/financas';
import { useDados } from '../../lib/useDados';
import { Aviso, Cartao, Carregando, Pagina, Selo } from '../../ui';
import { ResumoItem, Vazio } from '../../ui/financas';
import './alertas.css';

export interface ItemAlertaDTO {
  id: number;
  data: string;
  descricao: string;
  valor: number;
  contaNome: string;
}

export interface AlertaDTO {
  tipo: 'DUPLICADA' | 'AUMENTO' | 'PARCELA_A_MAIS' | 'ASSINATURA_NOVA';
  gravidade: 'alta' | 'media';
  titulo: string;
  texto: string;
  lancamentos: ItemAlertaDTO[];
}

export interface AlertasDTO {
  alertas: AlertaDTO[];
  analisados: number;
}

const ROTULO_GRAVIDADE: Record<AlertaDTO['gravidade'], { rotulo: string; cor: 'vermelho' | 'amarelo' }> = {
  alta: { rotulo: 'Atenção', cor: 'vermelho' },
  media: { rotulo: 'Confira', cor: 'amarelo' },
};

const TEXTO_FIXO = 'São indícios calculados pelos seus lançamentos. Confira na fatura antes de contestar uma cobrança.';

export function Alertas() {
  const { dados, carregando, erro } = useDados<AlertasDTO>('/alertas');

  return (
    <Pagina titulo="Cobranças estranhas">
      {carregando && <Carregando />}
      {erro && <Aviso tipo="erro">{erro}</Aviso>}

      {dados && (
        <>
          <div className="alertas-resumo">
            <ResumoItem icone="sino" cor="vermelho" valor={dados.alertas.length} rotulo="alertas" />
            <ResumoItem icone="transacoes" cor="azul" valor={dados.analisados} rotulo="lançamentos analisados" />
          </div>

          {dados.alertas.length === 0 ? (
            <Cartao>
              <Vazio icone="sino" titulo="Nada estranho encontrado" />
            </Cartao>
          ) : (
            dados.alertas.map((alerta, indice) => {
              const gravidade = ROTULO_GRAVIDADE[alerta.gravidade];
              return (
                <Cartao key={`${alerta.tipo}-${indice}`} titulo={alerta.titulo}>
                  <div className="alertas-selo">
                    <Selo cor={gravidade.cor}>{gravidade.rotulo}</Selo>
                  </div>
                  <p className="alertas-texto">{alerta.texto}</p>
                  <ul className="alertas-lista">
                    {alerta.lancamentos.map((item) => (
                      <li key={item.id} className="alertas-item">
                        <span className="alertas-data">{formatarDia(item.data)}</span>
                        <span className="alertas-descricao">{item.descricao}</span>
                        <span className="alertas-conta">{item.contaNome}</span>
                        <span className="alertas-valor">{formatarReais(item.valor)}</span>
                      </li>
                    ))}
                  </ul>
                  <Link className="alertas-ver" to="/app/transacoes">
                    Ver nos lançamentos
                  </Link>
                </Cartao>
              );
            })
          )}

          <p className="alertas-rodape">{TEXTO_FIXO}</p>
        </>
      )}
    </Pagina>
  );
}
