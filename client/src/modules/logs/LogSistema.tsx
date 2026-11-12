import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { api } from '../../lib/api';
import { Aviso, Botao, Campo, Carregando, Modal, Pagina, Selecao, Selo, Tabela } from '../../ui';
import type { ColunaTabela } from '../../ui';
import { Icone } from '../../ui/icones';
import {
  Avatar,
  IndicadorAoVivo,
  SeloTipo,
  TIPOS_LOG,
  dataHoraCompleta,
  mensagemErro,
  rotuloModulo,
  rotuloPerfil,
  textoOuTraco,
  useAoVivo,
  usePausaAoVivo,
} from './comum';
import type { LogDTO } from './comum';

const LIMITE_PAGINA = 50;
const MAXIMO_NA_MEMORIA = 500;
const DESTAQUE_MS = 2000;
const ESPERA_BUSCA_MS = 300;

interface Filtros {
  busca: string;
  tipo: string;
  modulo: string;
  de: string;
  ate: string;
}

const FILTROS_VAZIOS: Filtros = { busca: '', tipo: '', modulo: '', de: '', ate: '' };

interface PaginaLogs {
  itens: LogDTO[];
  haMais: boolean;
}

// 2xx e 3xx verdes, 4xx amarelos, 5xx vermelhos; outros códigos ficam cinza.
function corDoStatus(status: number): 'verde' | 'amarelo' | 'vermelho' | 'cinza' {
  if (status >= 500) return 'vermelho';
  if (status >= 400) return 'amarelo';
  if (status >= 200 && status < 400) return 'verde';
  return 'cinza';
}

function montarCaminho(filtros: Filtros, extra: Record<string, string | number>): string {
  const p = new URLSearchParams();
  if (filtros.busca.trim()) p.set('busca', filtros.busca.trim());
  if (filtros.tipo) p.set('tipo', filtros.tipo);
  if (filtros.modulo.trim()) p.set('modulo', filtros.modulo.trim());
  if (filtros.de) p.set('de', filtros.de);
  if (filtros.ate) p.set('ate', filtros.ate);
  for (const [chave, valor] of Object.entries(extra)) p.set(chave, String(valor));
  return `/logs?${p.toString()}`;
}

// Primeiro ancestral que rola na vertical; null quando é a própria janela.
function rolagemPai(el: HTMLElement | null): HTMLElement | null {
  let atual = el ? el.parentElement : null;
  while (atual) {
    const { overflowY } = window.getComputedStyle(atual);
    if ((overflowY === 'auto' || overflowY === 'scroll') && atual.scrollHeight > atual.clientHeight) {
      return atual;
    }
    atual = atual.parentElement;
  }
  return null;
}

interface Ancora {
  alvo: HTMLElement | null;
  altura: number;
  posicao: number;
}

function capturarAncora(raiz: HTMLElement | null): Ancora {
  const alvo = rolagemPai(raiz);
  if (alvo) return { alvo, altura: alvo.scrollHeight, posicao: alvo.scrollTop };
  return { alvo: null, altura: document.documentElement.scrollHeight, posicao: window.scrollY };
}

export function LogSistema() {
  const { pausado, visivel, ativo, alternarPausa } = usePausaAoVivo();

  // Campos digitados e filtros já aplicados (a busca espera 300 ms).
  const [form, setForm] = useState<Filtros>(FILTROS_VAZIOS);
  const [aplicados, setAplicados] = useState<Filtros>(FILTROS_VAZIOS);

  const [itens, setItens] = useState<LogDTO[]>([]);
  const [haMais, setHaMais] = useState(false);
  const [carregando, setCarregando] = useState(true);
  const [carregandoMais, setCarregandoMais] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [novos, setNovos] = useState<Set<number>>(new Set());
  const [selecionado, setSelecionado] = useState<LogDTO | null>(null);

  const raizRef = useRef<HTMLDivElement>(null);
  const itensRef = useRef<LogDTO[]>([]);
  const geracao = useRef(0);
  const carregandoRef = useRef(false);
  const emVoo = useRef(false);
  const timerNovos = useRef<number | null>(null);
  const ancora = useRef<Ancora | null>(null);

  const definirItens = useCallback((lista: LogDTO[]) => {
    itensRef.current = lista;
    setItens(lista);
  }, []);

  // A busca espera 300 ms; os outros filtros valem na hora.
  useEffect(() => {
    const espera = form.busca === aplicados.busca ? 0 : ESPERA_BUSCA_MS;
    const t = window.setTimeout(() => setAplicados(form), espera);
    return () => window.clearTimeout(t);
  }, [form]);

  const consulta = montarCaminho(aplicados, {});

  // Carga inicial de cada conjunto de filtros. Respostas antigas são ignoradas.
  useEffect(() => {
    const minha = ++geracao.current;
    carregandoRef.current = true;
    setCarregando(true);
    setErro(null);
    setNovos(new Set());

    api
      .get<PaginaLogs>(montarCaminho(aplicados, { limite: LIMITE_PAGINA }))
      .then((r) => {
        if (minha !== geracao.current) return;
        definirItens(r.itens);
        setHaMais(r.haMais);
      })
      .catch((e: unknown) => {
        if (minha === geracao.current) setErro(mensagemErro(e));
      })
      .finally(() => {
        if (minha !== geracao.current) return;
        carregandoRef.current = false;
        setCarregando(false);
      });
  }, [consulta, definirItens]);

  // Mantém a posição de rolagem quando novas linhas entram no topo.
  useLayoutEffect(() => {
    const a = ancora.current;
    if (!a) return;
    ancora.current = null;
    if (a.posicao <= 0) return;
    const alturaDepois = a.alvo ? a.alvo.scrollHeight : document.documentElement.scrollHeight;
    const diferenca = alturaDepois - a.altura;
    if (diferenca <= 0) return;
    if (a.alvo) a.alvo.scrollTop = a.posicao + diferenca;
    else window.scrollTo(0, a.posicao + diferenca);
  }, [itens]);

  // Tempo real: busca só os registros com id maior que o mais novo da lista.
  const atualizarNovos = useCallback(() => {
    const lista = itensRef.current;
    if (emVoo.current || carregandoRef.current || lista.length === 0) return;
    emVoo.current = true;
    const minha = geracao.current;
    const maiorId = lista[0].id;

    api
      .get<PaginaLogs>(montarCaminho(aplicados, { limite: LIMITE_PAGINA, depoisDe: maiorId }))
      .then((r) => {
        if (minha !== geracao.current || r.itens.length === 0) return;
        const idsNovos = new Set(r.itens.map((i) => i.id));
        const antigos = itensRef.current.filter((i) => !idsNovos.has(i.id));
        const combinados = [...r.itens, ...antigos];

        ancora.current = capturarAncora(raizRef.current);
        if (combinados.length > MAXIMO_NA_MEMORIA) setHaMais(true);
        definirItens(combinados.slice(0, MAXIMO_NA_MEMORIA));
        setNovos(idsNovos);

        if (timerNovos.current !== null) window.clearTimeout(timerNovos.current);
        timerNovos.current = window.setTimeout(() => {
          timerNovos.current = null;
          setNovos(new Set());
        }, DESTAQUE_MS);
      })
      .catch((e: unknown) => {
        if (minha === geracao.current) setErro(mensagemErro(e));
      })
      .finally(() => {
        emVoo.current = false;
      });
  }, [aplicados, definirItens]);

  useAoVivo(atualizarNovos, ativo);

  useEffect(() => {
    return () => {
      if (timerNovos.current !== null) window.clearTimeout(timerNovos.current);
    };
  }, []);

  function carregarMais() {
    const lista = itensRef.current;
    if (lista.length === 0 || carregandoMais || !haMais) return;
    const minha = geracao.current;
    const menorId = lista[lista.length - 1].id;
    setCarregandoMais(true);

    api
      .get<PaginaLogs>(montarCaminho(aplicados, { limite: LIMITE_PAGINA, antesDe: menorId }))
      .then((r) => {
        if (minha !== geracao.current) return;
        const ids = new Set(itensRef.current.map((i) => i.id));
        const acrescentar = r.itens.filter((i) => !ids.has(i.id));
        const combinados = [...itensRef.current, ...acrescentar];
        if (combinados.length > MAXIMO_NA_MEMORIA) {
          definirItens(combinados.slice(0, MAXIMO_NA_MEMORIA));
          setHaMais(true);
        } else {
          definirItens(combinados);
          setHaMais(r.haMais);
        }
      })
      .catch((e: unknown) => {
        if (minha === geracao.current) setErro(mensagemErro(e));
      })
      .finally(() => {
        if (minha === geracao.current) setCarregandoMais(false);
      });
  }

  function limparFiltros() {
    setForm(FILTROS_VAZIOS);
  }

  const colunas: ColunaTabela<LogDTO>[] = [
    {
      titulo: 'Hora',
      celula: (r) => (
        <span className="logs-hora-celula">
          {dataHoraCompleta(r.criadoEm).replace(/,\s*/, ' ')}
          {novos.has(r.id) && <span className="logs-marca-nova" aria-hidden="true" />}
        </span>
      ),
    },
    {
      titulo: 'Usuário',
      celula: (r) => (
        <span className="logs-usuario-linha">
          <Avatar nome={r.usuarioNome} pequeno />
          <span className="logs-usuario-texto">
            <span className="logs-usuario-nome">{textoOuTraco(r.usuarioNome)}</span>
            <span className="logs-usuario-perfil">{rotuloPerfil(r.perfil)}</span>
          </span>
        </span>
      ),
    },
    { titulo: 'Tipo', celula: (r) => <SeloTipo tipo={r.tipo} /> },
    { titulo: 'Atividade', celula: (r) => r.descricao },
    { titulo: 'Módulo', celula: (r) => rotuloModulo(r.modulo) },
    {
      titulo: 'Status',
      alinhar: 'direita',
      celula: (r) => {
        if (r.status === null) return '—';
        return <Selo cor={corDoStatus(r.status)}>{r.status}</Selo>;
      },
    },
    {
      titulo: 'Duração',
      alinhar: 'direita',
      celula: (r) => (r.duracaoMs === null ? '—' : `${r.duracaoMs} ms`),
    },
  ];

  const campos: { rotulo: string; valor: ReactNode }[] = selecionado
    ? [
        { rotulo: 'Data e hora', valor: dataHoraCompleta(selecionado.criadoEm) },
        { rotulo: 'Usuário', valor: textoOuTraco(selecionado.usuarioNome) },
        { rotulo: 'Código do usuário', valor: textoOuTraco(selecionado.usuarioId) },
        { rotulo: 'Perfil', valor: rotuloPerfil(selecionado.perfil) },
        { rotulo: 'Tipo', valor: <SeloTipo tipo={selecionado.tipo} /> },
        { rotulo: 'Atividade', valor: selecionado.descricao },
        { rotulo: 'Módulo', valor: rotuloModulo(selecionado.modulo) },
        { rotulo: 'Método', valor: textoOuTraco(selecionado.metodo) },
        { rotulo: 'Caminho', valor: textoOuTraco(selecionado.caminho) },
        { rotulo: 'Status', valor: textoOuTraco(selecionado.status) },
        { rotulo: 'Duração', valor: selecionado.duracaoMs === null ? '—' : `${selecionado.duracaoMs} ms` },
        { rotulo: 'IP', valor: textoOuTraco(selecionado.ip) },
        { rotulo: 'Navegador', valor: textoOuTraco(selecionado.navegador) },
      ]
    : [];

  return (
    <Pagina
      titulo="Log do sistema"
      acoes={<IndicadorAoVivo ativo={ativo} visivel={visivel} />}
    >
      <div ref={raizRef} className="logs-log">
        <section className="barra-ferramentas">
          <div className="filtros">
            <Campo
              rotulo="Buscar"
              valor={form.busca}
              aoMudar={(v) => setForm((f) => ({ ...f, busca: v }))}
            />
            <Selecao
              rotulo="Tipo"
              valor={form.tipo}
              vazio="Todos os tipos"
              opcoes={TIPOS_LOG}
              aoMudar={(v) => setForm((f) => ({ ...f, tipo: v }))}
            />
            <Campo
              rotulo="Módulo"
              valor={form.modulo}
              aoMudar={(v) => setForm((f) => ({ ...f, modulo: v }))}
            />
            <Campo
              rotulo="Data inicial"
              tipo="date"
              valor={form.de}
              aoMudar={(v) => setForm((f) => ({ ...f, de: v }))}
            />
            <Campo
              rotulo="Data final"
              tipo="date"
              valor={form.ate}
              aoMudar={(v) => setForm((f) => ({ ...f, ate: v }))}
            />
          </div>
          <div className="logs-botoes">
            <Botao variante="secundario" aoClicar={alternarPausa}>
              <span className="logs-com-icone">
                <Icone nome={pausado ? 'reproduzir' : 'pausar'} tamanho={16} />
                {pausado ? 'Retomar' : 'Pausar'}
              </span>
            </Botao>
            <Botao variante="texto" aoClicar={limparFiltros}>
              Limpar filtros
            </Botao>
          </div>
        </section>

        {erro && <Aviso tipo="erro">{erro}</Aviso>}
        {carregando && itens.length === 0 && <Carregando />}

        {(!carregando || itens.length > 0) && (
          <section className="cartao logs-cartao-tabela">
            <Tabela<LogDTO>
              colunas={colunas}
              dados={itens}
              chave={(r) => r.id}
              vazio="Nenhum registro encontrado para estes filtros."
              aoClicarLinha={(r) => setSelecionado(r)}
            />
          </section>
        )}

        <div className="logs-rodape">
          <span className="logs-contador">
            {itens.length.toLocaleString('pt-BR')} registros carregados
          </span>
          {haMais && (
            <Botao variante="secundario" desabilitado={carregandoMais} aoClicar={carregarMais}>
              {carregandoMais ? 'Carregando...' : 'Carregar mais antigos'}
            </Botao>
          )}
        </div>
      </div>

      <Modal
        aberto={selecionado !== null}
        titulo={selecionado ? `Registro ${selecionado.id}` : 'Registro'}
        aoFechar={() => setSelecionado(null)}
      >
        <dl className="logs-detalhes">
          {campos.map((c) => (
            <div key={c.rotulo} className="logs-detalhe">
              <dt>{c.rotulo}</dt>
              <dd>{c.valor}</dd>
            </div>
          ))}
        </dl>
      </Modal>
    </Pagina>
  );
}
