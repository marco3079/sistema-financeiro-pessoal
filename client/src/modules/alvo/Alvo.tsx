import { useState } from 'react';
import type { FormEvent } from 'react';
import { api } from '../../lib/api';
import { formatarPercentual, formatarReais, lerValor, mensagemErro, valorParaCampo } from '../../lib/financas';
import { useDados } from '../../lib/useDados';
import { Aviso, Botao, Campo, Cartao, Carregando, Modal, Pagina } from '../../ui';
import { BarraProgresso, ResumoItem, Vazio } from '../../ui/financas';
import './alvo.css';

type Classe = 'RENDA_VARIAVEL' | 'RENDA_FIXA' | 'FUNDOS' | 'OUTROS';

interface ClasseAlvo {
  classe: Classe;
  rotulo: string;
  saldo: number;
  atual: number;
  alvo: number | null;
  desvio: number | null;
  diferenca: number | null;
}

interface RespostaAlvo {
  total: number;
  definido: boolean;
  classes: ClasseAlvo[];
}

const ORDEM: Classe[] = ['RENDA_VARIAVEL', 'RENDA_FIXA', 'FUNDOS', 'OUTROS'];

// Pontos percentuais com sinal: +5,0 pts / -2,5 pts.
function formatarPontos(valor: number): string {
  const sinal = valor > 0 ? '+' : '';
  return `${sinal}${valor.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} pts`;
}

function corDoSinal(valor: number | null): string {
  if (valor === null || Math.abs(valor) < 0.05) return 'alvo-neutro';
  return valor > 0 ? 'alvo-positivo' : 'alvo-negativo';
}

// ---------- Definir o alvo ----------

function FormAlvo({
  classes,
  aoSalvo,
}: {
  classes: ClasseAlvo[];
  aoSalvo: () => void;
}) {
  const [campos, setCampos] = useState<Record<Classe, string>>(() => {
    const inicial = {} as Record<Classe, string>;
    for (const c of ORDEM) {
      inicial[c] = valorParaCampo(classes.find((x) => x.classe === c)?.alvo ?? null);
    }
    return inicial;
  });
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const numeros = ORDEM.map((c) => lerValor(campos[c]));
  const valido = numeros.every((n) => n !== null && n >= 0 && n <= 100);
  const soma = numeros.reduce<number>((s, n) => s + (n ?? 0), 0);
  const somaCerta = valido && Math.abs(soma - 100) <= 0.01;

  async function salvar(e: FormEvent) {
    e.preventDefault();
    if (!somaCerta || ocupado) return;
    setErro(null);
    setOcupado(true);
    try {
      await api.put('/alvo', {
        classes: ORDEM.map((c, i) => ({ classe: c, percentual: numeros[i] ?? 0 })),
      });
      aoSalvo();
    } catch (err) {
      setErro(mensagemErro(err));
    } finally {
      setOcupado(false);
    }
  }

  return (
    <form className="alvo-form" onSubmit={salvar}>
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      {ORDEM.map((c) => {
        const rotulo = classes.find((x) => x.classe === c)?.rotulo ?? c;
        return (
          <Campo
            key={c}
            rotulo={`${rotulo} (%)`}
            valor={campos[c]}
            aoMudar={(v) => setCampos((atual) => ({ ...atual, [c]: v }))}
          />
        );
      })}
      <p className={somaCerta ? 'alvo-soma' : 'alvo-soma alvo-soma-errada'}>
        Soma: {valido ? formatarPercentual(soma) : 'confira os valores'}
        {valido && !somaCerta && ' (precisa dar 100%)'}
      </p>
      <Botao tipo="submit" desabilitado={!somaCerta || ocupado}>
        {ocupado ? 'Salvando...' : 'Salvar'}
      </Botao>
    </form>
  );
}

// ---------- Tela ----------

export function Alvo() {
  const { dados, carregando, erro, recarregar } = useDados<RespostaAlvo>('/alvo');
  const [aRemover, setARemover] = useState(false);
  const [removendo, setRemovendo] = useState(false);
  const [erroRemover, setErroRemover] = useState<string | null>(null);

  async function remover() {
    setErroRemover(null);
    setRemovendo(true);
    try {
      await api.del('/alvo');
      setARemover(false);
      recarregar();
    } catch (err) {
      setErroRemover(mensagemErro(err));
    } finally {
      setRemovendo(false);
    }
  }

  const maiorDesvio = dados?.definido
    ? dados.classes.reduce<ClasseAlvo | null>((maior, c) => {
        if (c.desvio === null) return maior;
        if (maior === null || Math.abs(c.desvio) > Math.abs(maior.desvio ?? 0)) return c;
        return maior;
      }, null)
    : null;

  return (
    <Pagina titulo="Carteira-alvo">
      {carregando && <Carregando />}
      {erro && <Aviso tipo="erro">{erro}</Aviso>}

      {dados && (
        <>
          <div className="resumo">
            <ResumoItem icone="investimentos" cor="azul" valor={formatarReais(dados.total)} rotulo="Total investido" />
            <ResumoItem
              icone="metas"
              cor="roxo"
              valor={maiorDesvio && maiorDesvio.desvio !== null ? `${maiorDesvio.rotulo}: ${formatarPontos(maiorDesvio.desvio)}` : 'Sem alvo'}
              rotulo="Maior desvio"
            />
          </div>

          {dados.total === 0 ? (
            <Cartao>
              <Vazio
                icone="investimentos"
                titulo="Nenhum investimento cadastrado"
                texto="Cadastre seus investimentos para ver a carteira em relação ao alvo."
              />
            </Cartao>
          ) : (
            <Cartao titulo="Carteira por classe">
              <ul className="alvo-lista">
                {dados.classes.map((c) => (
                  <li key={c.classe} className="alvo-item">
                    <div className="alvo-item-cabecalho">
                      <strong>{c.rotulo}</strong>
                      <span>{formatarReais(c.saldo)}</span>
                    </div>
                    <div className="alvo-barra-area">
                      <div className="alvo-barra">
                        <BarraProgresso percentual={c.atual} />
                      </div>
                      {c.alvo !== null && (
                        <span
                          className="alvo-marcador"
                          style={{ left: `${Math.max(0, Math.min(100, c.alvo))}%` }}
                          aria-label={`Alvo: ${formatarPercentual(c.alvo)}`}
                        />
                      )}
                    </div>
                    <dl className="alvo-numeros">
                      <div>
                        <dt>Atual</dt>
                        <dd>{formatarPercentual(c.atual)}</dd>
                      </div>
                      <div>
                        <dt>Alvo</dt>
                        <dd>{c.alvo === null ? 'Sem alvo' : formatarPercentual(c.alvo)}</dd>
                      </div>
                      <div>
                        <dt>Desvio</dt>
                        <dd className={corDoSinal(c.desvio)}>{c.desvio === null ? '—' : formatarPontos(c.desvio)}</dd>
                      </div>
                    </dl>
                    {c.diferenca !== null && (
                      <p className={`alvo-diferenca ${corDoSinal(c.diferenca)}`}>
                        {c.diferenca > 0.005
                          ? `acima do alvo em ${formatarReais(c.diferenca)}`
                          : c.diferenca < -0.005
                            ? `abaixo do alvo em ${formatarReais(Math.abs(c.diferenca))}`
                            : 'no alvo'}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            </Cartao>
          )}

          <Cartao titulo="Definir alvo">
            <FormAlvo key={JSON.stringify(dados.classes.map((c) => c.alvo))} classes={dados.classes} aoSalvo={recarregar} />
            {dados.definido && (
              <div className="alvo-remover">
                <Botao variante="perigo" aoClicar={() => setARemover(true)}>
                  Remover alvo
                </Botao>
              </div>
            )}
          </Cartao>

          <p className="alvo-aviso-fixo">
            A tela só mostra a distância entre a carteira e o alvo que você definiu. Não é recomendação de compra ou venda.
          </p>
        </>
      )}

      <Modal aberto={aRemover} titulo="Remover alvo" aoFechar={() => setARemover(false)}>
        <div>
          {erroRemover && <Aviso tipo="erro">{erroRemover}</Aviso>}
          <p>O alvo sai da tela. Os seus investimentos não são alterados.</p>
          <div className="alvo-acoes">
            <Botao variante="secundario" aoClicar={() => setARemover(false)}>
              Cancelar
            </Botao>
            <Botao variante="perigo" desabilitado={removendo} aoClicar={remover}>
              {removendo ? 'Removendo...' : 'Remover'}
            </Botao>
          </div>
        </div>
      </Modal>
    </Pagina>
  );
}
