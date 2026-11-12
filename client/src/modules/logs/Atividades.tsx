import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api';
import { Aviso, Botao, Carregando, Pagina } from '../../ui';
import { Icone } from '../../ui/icones';
import {
  Avatar,
  IndicadorAoVivo,
  SeloPerfil,
  SeloTipo,
  horaCurta,
  mensagemErro,
  rotuloModulo,
  tempoRelativo,
  textoOuTraco,
  useAoVivo,
  usePausaAoVivo,
} from './comum';
import type { ResumoLogDTO } from './comum';

const ALTURA_GRAFICO = 220;
const MARGEM_ROTULOS = 26;
const TOPO_GRAFICO = 10;

// ---------- Gráfico de barras (SVG à mão) ----------

function GraficoHoras({ dados }: { dados: { hora: string; total: number }[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const [largura, setLargura] = useState(600);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const medir = () => setLargura(Math.max(200, Math.floor(el.clientWidth)));
    medir();

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', medir);
      return () => window.removeEventListener('resize', medir);
    }
    const observador = new ResizeObserver(medir);
    observador.observe(el);
    return () => observador.disconnect();
  }, []);

  const n = dados.length;
  const area = ALTURA_GRAFICO - MARGEM_ROTULOS - TOPO_GRAFICO;
  const maior = Math.max(1, ...dados.map((d) => d.total));
  const slot = n > 0 ? largura / n : 0;
  const barra = Math.max(4, slot * 0.6);
  const yBase = TOPO_GRAFICO + area;

  return (
    <div ref={ref} className="logs-grafico">
      {n === 0 ? (
        <p className="tabela-vazia">Sem atividades nas últimas 24 horas.</p>
      ) : (
        <svg
          className="logs-grafico-svg"
          width={largura}
          height={ALTURA_GRAFICO}
          viewBox={`0 0 ${largura} ${ALTURA_GRAFICO}`}
          role="img"
          aria-label="Atividades nas últimas 24 horas"
        >
          <line x1={0} x2={largura} y1={yBase} y2={yBase} className="logs-eixo" />
          {dados.map((d, i) => {
            const altura = (d.total / maior) * area;
            const x = i * slot + (slot - barra) / 2;
            return (
              <g key={d.hora + i}>
                <rect
                  className="logs-barra"
                  x={x}
                  y={yBase - altura}
                  width={barra}
                  height={altura}
                  rx={3}
                >
                  <title>{`${d.hora}: ${d.total}`}</title>
                </rect>
                {i % 3 === 0 && (
                  <text
                    className="logs-eixo-texto"
                    x={i * slot + slot / 2}
                    y={ALTURA_GRAFICO - 6}
                    textAnchor="middle"
                  >
                    {d.hora}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      )}
    </div>
  );
}

// ---------- Listas com barra horizontal ----------

interface ItemBarra {
  chave: string | number;
  rotulo: ReactNode;
  total: number;
}

function ListaBarras({ itens, vazio }: { itens: ItemBarra[]; vazio: string }) {
  if (itens.length === 0) return <p className="tabela-vazia">{vazio}</p>;
  const maior = Math.max(1, ...itens.map((i) => i.total));
  return (
    <ul className="logs-barras">
      {itens.map((item) => (
        <li key={item.chave} className="logs-barra-item">
          <div className="logs-barra-cabecalho">
            <span className="logs-barra-rotulo">{item.rotulo}</span>
            <strong className="logs-barra-total">{item.total.toLocaleString('pt-BR')}</strong>
          </div>
          <div className="logs-trilho" aria-hidden="true">
            <div className="logs-preenchimento" style={{ width: `${(item.total / maior) * 100}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

// ---------- Tela ----------

export function Atividades() {
  const { pausado, visivel, ativo, alternarPausa } = usePausaAoVivo();
  const [resumo, setResumo] = useState<ResumoLogDTO | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const emVoo = useRef(false);

  const atualizar = useCallback(() => {
    if (emVoo.current) return;
    emVoo.current = true;
    api
      .get<ResumoLogDTO>('/logs/resumo')
      .then((r) => {
        setResumo(r);
        setErro(null);
      })
      .catch((e: unknown) => {
        setErro(mensagemErro(e));
      })
      .finally(() => {
        emVoo.current = false;
      });
  }, []);

  useEffect(() => {
    atualizar();
  }, [atualizar]);

  useAoVivo(atualizar, ativo);

  return (
    <Pagina
      titulo="Atividades"
      acoes={
        <>
          <IndicadorAoVivo ativo={ativo} visivel={visivel} />
          <Botao variante="secundario" aoClicar={alternarPausa}>
            <span className="logs-com-icone">
              <Icone nome={pausado ? 'reproduzir' : 'pausar'} tamanho={16} />
              {pausado ? 'Retomar' : 'Pausar'}
            </span>
          </Botao>
        </>
      }
    >
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      {!resumo && !erro && <Carregando />}

      {resumo && (
        <>
          <div className="logs-indicadores">
            <Indicador cor="verde" icone="grupo" valor={resumo.online.length} rotulo="Usuários online" />
            <Indicador cor="azul" icone="atividade" valor={resumo.hoje.atividades} rotulo="Atividades hoje" />
            <Indicador cor="roxo" icone="usuarios" valor={resumo.hoje.usuariosAtivos} rotulo="Usuários ativos hoje" />
            <Indicador cor="laranja" icone="lapis" valor={resumo.hoje.alteracoes} rotulo="Alterações hoje" />
            <Indicador cor="vermelho" icone="fechar" valor={resumo.hoje.falhasLogin} rotulo="Falhas de login hoje" />
          </div>

          <section className="cartao">
            <h2 className="cartao-titulo">
              Online agora
              <span className="logs-subtitulo"> · últimos 5 minutos</span>
            </h2>
            {resumo.online.length === 0 ? (
              <p className="tabela-vazia">Ninguém ativo nos últimos 5 minutos.</p>
            ) : (
              <ul className="logs-online-grade">
                {resumo.online.map((u) => (
                  <li key={u.usuarioId} className="logs-online-item">
                    <div className="logs-online-topo">
                      <span className="logs-avatar-wrap">
                        <Avatar nome={u.nome} />
                        <span className="logs-ponto-online" aria-label="Online" role="img" />
                      </span>
                      <div className="logs-online-identidade">
                        <strong className="logs-online-nome">{u.nome}</strong>
                        <SeloPerfil perfil={u.perfil} />
                      </div>
                    </div>
                    <p className="logs-online-tela">
                      Em: <strong>{textoOuTraco(u.telaAtual)}</strong>
                    </p>
                    <div className="logs-online-ultima">
                      <SeloTipo tipo={u.ultimoTipo} />
                      <span className="logs-online-descricao">{u.ultimaDescricao}</span>
                    </div>
                    <span className="logs-online-tempo">{tempoRelativo(u.ultimaAtividade)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="cartao">
            <h2 className="cartao-titulo">Atividade nas últimas 24 horas</h2>
            <GraficoHoras dados={resumo.porHora} />
          </section>

          <div className="logs-duas-colunas">
            <section className="cartao">
              <h2 className="cartao-titulo">Por módulo</h2>
              <ListaBarras
                vazio="Sem atividades hoje."
                itens={resumo.porModulo.map((m) => ({ chave: m.modulo, rotulo: rotuloModulo(m.modulo), total: m.total }))}
              />
            </section>
            <section className="cartao">
              <h2 className="cartao-titulo">Usuários mais ativos</h2>
              <ListaBarras
                vazio="Sem atividades hoje."
                itens={resumo.topUsuarios.map((u) => ({
                  chave: u.usuarioId,
                  total: u.total,
                  rotulo: (
                    <span className="logs-usuario-barra">
                      <Avatar nome={u.nome} pequeno />
                      <span className="logs-usuario-barra-nome">{u.nome}</span>
                      <SeloPerfil perfil={u.perfil} />
                    </span>
                  ),
                }))}
              />
            </section>
          </div>

          <section className="cartao">
            <div className="logs-cabecalho-cartao">
              <h2 className="cartao-titulo">Últimas atividades</h2>
              <Link className="botao botao-texto" to="/app/logs">
                Ver o log completo
              </Link>
            </div>
            {resumo.recentes.length === 0 ? (
              <p className="tabela-vazia">Nenhuma atividade registrada ainda.</p>
            ) : (
              <ul className="logs-recentes">
                {resumo.recentes.map((r) => (
                  <li key={r.id} className="logs-recente">
                    <span className="logs-hora">{horaCurta(r.criadoEm)}</span>
                    <Avatar nome={r.usuarioNome} pequeno />
                    <div className="logs-recente-corpo">
                      <div className="logs-recente-linha">
                        <strong>{textoOuTraco(r.usuarioNome)}</strong>
                        <SeloTipo tipo={r.tipo} />
                      </div>
                      <span className="logs-recente-descricao">{r.descricao}</span>
                      <span className="logs-recente-modulo">{rotuloModulo(r.modulo)}</span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </Pagina>
  );
}

function Indicador({
  cor,
  icone,
  valor,
  rotulo,
}: {
  cor: 'verde' | 'azul' | 'roxo' | 'laranja' | 'vermelho';
  icone: 'grupo' | 'atividade' | 'usuarios' | 'lapis' | 'fechar';
  valor: number;
  rotulo: string;
}) {
  return (
    <div className="resumo-item logs-indicador">
      <span className={`resumo-icone resumo-icone-${cor}`}>
        <Icone nome={icone} tamanho={24} />
      </span>
      <div className="logs-indicador-texto">
        <span className="resumo-valor">{valor.toLocaleString('pt-BR')}</span>
        <span className="resumo-rotulo">{rotulo}</span>
      </div>
    </div>
  );
}
