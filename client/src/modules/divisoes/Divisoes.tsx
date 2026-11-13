import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { api } from '../../lib/api';
import { formatarDia, formatarReais, lerValor, mensagemErro, queryString, valorParaCampo } from '../../lib/financas';
import { useDados } from '../../lib/useDados';
import { Aviso, Botao, Campo, Cartao, Carregando, Modal, Pagina, Selo } from '../../ui';
import { ResumoItem, Vazio } from '../../ui/financas';
import './divisoes.css';

const LIMITE_PESSOA = 40;
const ATRASO_BUSCA_MS = 300;
const ATALHOS_PESSOAS = [2, 3, 4];

// Formatos de GET /divisoes e GET /divisoes/lancamentos (ver server/src/modules/divisoes/routes.ts).
interface ItemDivisao {
  id: number;
  transacaoId: number;
  data: string;
  descricao: string;
  valorDoLancamento: number;
  valor: number;
  quitadoEm: string | null;
}

interface PessoaDivisao {
  pessoa: string;
  emAberto: number;
  quitado: number;
  itens: ItemDivisao[];
}

interface DivisoesDTO {
  pessoas: PessoaDivisao[];
  totalEmAberto: number;
}

interface LancamentoDivisao {
  id: number;
  data: string;
  descricao: string;
  valor: number;
  contaNome: string;
  jaDividido: number;
}

interface ParteRascunho {
  chave: number;
  pessoa: string;
  valor: string;
}

// Texto em centavos inteiros, ou null se não for um valor maior que zero.
function centavosDe(texto: string): number | null {
  const valor = lerValor(texto);
  if (valor === null) return null;
  const cents = Math.round(valor * 100);
  return cents > 0 ? cents : null;
}

// Texto para copiar: "Fulano, você me deve R$ 120,00: Mercado 05/11 (R$ 80,00), Uber 07/11 (R$ 40,00)."
function resumoDe(p: PessoaDivisao): string {
  const abertos = p.itens.filter((i) => i.quitadoEm === null);
  const lista = abertos
    .map((i) => `${i.descricao} ${formatarDia(i.data).slice(0, 5)} (${formatarReais(i.valor)})`)
    .join(', ');
  return `${p.pessoa}, você me deve ${formatarReais(p.emAberto)}: ${lista}.`;
}

// ---------- Nova divisão ----------

function NovaDivisao({ aoSalvo }: { aoSalvo: () => void }) {
  const [busca, setBusca] = useState('');
  const [lancamentos, setLancamentos] = useState<LancamentoDivisao[]>([]);
  const [carregandoBusca, setCarregandoBusca] = useState(true);
  const [erroBusca, setErroBusca] = useState<string | null>(null);
  const [escolhido, setEscolhido] = useState<LancamentoDivisao | null>(null);
  const [partes, setPartes] = useState<ParteRascunho[]>([]);
  const proximaChave = useRef(0);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    if (escolhido) return;
    let cancelado = false;
    setCarregandoBusca(true);
    setErroBusca(null);
    const atraso = setTimeout(() => {
      api
        .get<LancamentoDivisao[]>('/divisoes/lancamentos' + queryString({ busca: busca.trim() }))
        .then((resposta) => {
          if (!cancelado) setLancamentos(resposta);
        })
        .catch((e: unknown) => {
          if (!cancelado) setErroBusca(mensagemErro(e));
        })
        .finally(() => {
          if (!cancelado) setCarregandoBusca(false);
        });
    }, ATRASO_BUSCA_MS);
    return () => {
      cancelado = true;
      clearTimeout(atraso);
    };
  }, [busca, escolhido]);

  function novaParte(pessoa: string, valor: string): ParteRascunho {
    proximaChave.current += 1;
    return { chave: proximaChave.current, pessoa, valor };
  }

  function escolher(lancamento: LancamentoDivisao) {
    setEscolhido(lancamento);
    setPartes([]);
    setErro(null);
  }

  function trocar() {
    setEscolhido(null);
    setPartes([]);
    setErro(null);
  }

  function alterarParte(chave: number, campo: 'pessoa' | 'valor', texto: string) {
    setPartes((atuais) => atuais.map((p) => (p.chave === chave ? { ...p, [campo]: texto } : p)));
  }

  function removerParte(chave: number) {
    setPartes((atuais) => atuais.filter((p) => p.chave !== chave));
  }

  // Quanto ainda não foi dividido do lançamento, em centavos.
  const disponivelC = escolhido ? Math.round(escolhido.valor * 100) - Math.round(escolhido.jaDividido * 100) : 0;
  const valoresC = partes.map((p) => centavosDe(p.valor));
  const somaC = valoresC.reduce<number>((total, v) => total + (v ?? 0), 0);
  const suaParteC = disponivelC - somaC;

  let motivo: string | null = null;
  if (partes.length === 0) motivo = 'Adicione pelo menos uma pessoa.';
  else if (partes.some((p) => p.pessoa.trim() === '')) motivo = 'Preencha o nome de todas as pessoas.';
  else if (partes.some((p) => p.pessoa.trim().length > LIMITE_PESSOA))
    motivo = `O nome pode ter até ${LIMITE_PESSOA} caracteres.`;
  else if (valoresC.some((v) => v === null)) motivo = 'Informe um valor maior que zero para cada pessoa.';
  else if (suaParteC < 0) motivo = 'As partes passam do valor do lançamento.';

  // Divide o que falta igualmente: cada uma das outras pessoas deve uma cota; sua parte fica com o resto.
  function dividirIgualmente(pessoas: number) {
    const cotaC = Math.floor(disponivelC / pessoas);
    const outras = pessoas - 1;
    const novas: ParteRascunho[] = [];
    for (let i = 0; i < outras; i += 1) {
      const anterior = partes[i];
      novas.push(
        anterior
          ? { ...anterior, valor: valorParaCampo(cotaC / 100) }
          : novaParte('', valorParaCampo(cotaC / 100))
      );
    }
    setPartes(novas);
  }

  async function salvar(e: FormEvent) {
    e.preventDefault();
    if (!escolhido || motivo) return;
    setOcupado(true);
    setErro(null);
    try {
      await api.post('/divisoes', {
        transacaoId: escolhido.id,
        partes: partes.map((p, i) => ({ pessoa: p.pessoa.trim(), valor: (valoresC[i] ?? 0) / 100 })),
      });
      aoSalvo();
    } catch (err) {
      setErro(mensagemErro(err));
      setOcupado(false);
    }
  }

  if (!escolhido) {
    return (
      <div className="divisoes-nova">
        <Campo rotulo="Buscar lançamento" valor={busca} aoMudar={setBusca} />
        {erroBusca && <Aviso tipo="erro">{erroBusca}</Aviso>}
        {carregandoBusca && <Carregando />}
        {!carregandoBusca && !erroBusca && lancamentos.length === 0 && (
          <p className="divisoes-texto-suave">Nenhuma despesa encontrada.</p>
        )}
        {!carregandoBusca && lancamentos.length > 0 && (
          <ul className="divisoes-escolhas">
            {lancamentos.map((l) => (
              <li key={l.id}>
                <button type="button" className="divisoes-escolha" onClick={() => escolher(l)}>
                  <span className="divisoes-escolha-nome">{l.descricao}</span>
                  <span className="divisoes-texto-suave">
                    {`${formatarDia(l.data)} · ${l.contaNome} · ${formatarReais(l.valor)}`}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  return (
    <form className="divisoes-nova" onSubmit={salvar}>
      {erro && <Aviso tipo="erro">{erro}</Aviso>}

      <div className="divisoes-escolhido">
        <div>
          <strong>{escolhido.descricao}</strong>
          <span className="divisoes-texto-suave">
            {`${formatarDia(escolhido.data)} · ${escolhido.contaNome} · ${formatarReais(escolhido.valor)}`}
          </span>
          {escolhido.jaDividido > 0 && (
            <span className="divisoes-texto-suave">{`Já dividido: ${formatarReais(escolhido.jaDividido)}`}</span>
          )}
        </div>
        <Botao variante="texto" aoClicar={trocar}>
          Trocar lançamento
        </Botao>
      </div>

      <div className="divisoes-atalhos">
        {ATALHOS_PESSOAS.map((n) => (
          <Botao key={n} variante="secundario" aoClicar={() => dividirIgualmente(n)}>
            {`Dividir igualmente entre ${n} pessoas`}
          </Botao>
        ))}
      </div>

      {partes.map((p) => (
        <div key={p.chave} className="divisoes-parte">
          <Campo rotulo="Pessoa" valor={p.pessoa} aoMudar={(t) => alterarParte(p.chave, 'pessoa', t)} />
          <Campo rotulo="Valor (R$)" valor={p.valor} aoMudar={(t) => alterarParte(p.chave, 'valor', t)} />
          <Botao variante="texto" aoClicar={() => removerParte(p.chave)}>
            Remover
          </Botao>
        </div>
      ))}

      <div className="divisoes-atalhos">
        <Botao variante="secundario" aoClicar={() => setPartes((atuais) => [...atuais, novaParte('', '')])}>
          Adicionar pessoa
        </Botao>
      </div>

      <p className="divisoes-sua-parte">{`Sua parte: ${formatarReais(Math.max(suaParteC, 0) / 100)}`}</p>
      {motivo && <p className="divisoes-texto-suave">{motivo}</p>}

      <div className="pagina-acoes">
        <Botao tipo="submit" desabilitado={ocupado || motivo !== null}>
          Salvar divisão
        </Botao>
      </div>
    </form>
  );
}

// ---------- Tela ----------

export function Divisoes() {
  const { dados, carregando, erro, recarregar } = useDados<DivisoesDTO>('/divisoes');
  const [novaAberta, setNovaAberta] = useState(false);
  const [ocupadoId, setOcupadoId] = useState<number | null>(null);
  const [erroAcao, setErroAcao] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  const [aApagar, setAApagar] = useState<{ item: ItemDivisao; pessoa: string } | null>(null);
  const [ocupadoApagar, setOcupadoApagar] = useState(false);
  const [erroApagar, setErroApagar] = useState<string | null>(null);

  async function copiar(p: PessoaDivisao) {
    setErroAcao(null);
    setAviso(null);
    try {
      await navigator.clipboard.writeText(resumoDe(p));
      setAviso(`Resumo de ${p.pessoa} copiado.`);
    } catch {
      setErroAcao('Não foi possível copiar. Tente de novo.');
    }
  }

  async function alternarRecebido(item: ItemDivisao) {
    setOcupadoId(item.id);
    setErroAcao(null);
    setAviso(null);
    try {
      await api.post(`/divisoes/${item.id}/${item.quitadoEm ? 'reabrir' : 'quitar'}`);
      recarregar();
    } catch (err) {
      setErroAcao(mensagemErro(err));
    } finally {
      setOcupadoId(null);
    }
  }

  function abrirApagar(item: ItemDivisao, pessoa: string) {
    setErroApagar(null);
    setAApagar({ item, pessoa });
  }

  function fecharApagar() {
    if (ocupadoApagar) return;
    setAApagar(null);
  }

  async function confirmarApagar() {
    if (!aApagar) return;
    setOcupadoApagar(true);
    setErroApagar(null);
    try {
      await api.del(`/divisoes/${aApagar.item.id}`);
      setAApagar(null);
      recarregar();
    } catch (err) {
      setErroApagar(mensagemErro(err));
    } finally {
      setOcupadoApagar(false);
    }
  }

  return (
    <Pagina titulo="Divisão de gastos" acoes={<Botao aoClicar={() => setNovaAberta(true)}>Nova divisão</Botao>}>
      <p className="divisoes-texto-suave">
        Registre a parte de um gasto que outra pessoa deve a você. Cada lançamento continua do seu jeito; aqui fica só
        o que falta receber.
      </p>

      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      {erroAcao && <Aviso tipo="erro">{erroAcao}</Aviso>}
      {aviso && <Aviso tipo="sucesso">{aviso}</Aviso>}
      {carregando && <Carregando />}

      {dados && (
        <>
          <div className="divisoes-resumo">
            <ResumoItem icone="grupo" cor="verde" valor={formatarReais(dados.totalEmAberto)} rotulo="A receber" />
            <ResumoItem icone="grupo" cor="azul" valor={dados.pessoas.length} rotulo="Pessoas" />
          </div>

          {dados.pessoas.length === 0 && (
            <Vazio
              icone="grupo"
              titulo="Nenhuma divisão ainda"
              texto="Quando alguém dividir um gasto com você, ele aparece aqui."
            />
          )}

          {dados.pessoas.map((p) => (
            <Cartao key={p.pessoa}>
              <div className="divisoes-cabecalho">
                <div>
                  <strong className="divisoes-nome">{p.pessoa}</strong>
                  <span className="divisoes-total">{`${formatarReais(p.emAberto)} em aberto`}</span>
                </div>
                <Botao variante="texto" aoClicar={() => copiar(p)} desabilitado={p.emAberto <= 0}>
                  Copiar resumo
                </Botao>
              </div>

              <ul className="divisoes-itens">
                {p.itens.map((item) => (
                  <li key={item.id} className="divisoes-item">
                    <div className="divisoes-item-texto">
                      <span>{item.descricao}</span>
                      <small className="divisoes-texto-suave">{formatarDia(item.data)}</small>
                    </div>
                    <strong className="divisoes-item-valor">{formatarReais(item.valor)}</strong>
                    {item.quitadoEm && <Selo cor="verde">Recebido</Selo>}
                    <div className="divisoes-item-acoes">
                      <Botao
                        variante="secundario"
                        aoClicar={() => alternarRecebido(item)}
                        desabilitado={ocupadoId === item.id}
                      >
                        {item.quitadoEm ? 'Reabrir' : 'Marcar como recebido'}
                      </Botao>
                      <Botao variante="perigo" aoClicar={() => abrirApagar(item, p.pessoa)}>
                        Excluir
                      </Botao>
                    </div>
                  </li>
                ))}
              </ul>
            </Cartao>
          ))}
        </>
      )}

      <Modal aberto={novaAberta} titulo="Nova divisão" aoFechar={() => setNovaAberta(false)}>
        {novaAberta && (
          <NovaDivisao
            aoSalvo={() => {
              setNovaAberta(false);
              recarregar();
            }}
          />
        )}
      </Modal>

      <Modal aberto={aApagar !== null} titulo="Excluir divisão" aoFechar={fecharApagar}>
        {aApagar && (
          <div>
            {erroApagar && <Aviso tipo="erro">{erroApagar}</Aviso>}
            <p>
              {`Excluir a parte de ${aApagar.pessoa} em "${aApagar.item.descricao}"? O lançamento continua no lugar.`}
            </p>
            <div className="pagina-acoes">
              <Botao variante="secundario" aoClicar={fecharApagar} desabilitado={ocupadoApagar}>
                Cancelar
              </Botao>
              <Botao variante="perigo" aoClicar={confirmarApagar} desabilitado={ocupadoApagar}>
                Excluir
              </Botao>
            </div>
          </div>
        )}
      </Modal>
    </Pagina>
  );
}
