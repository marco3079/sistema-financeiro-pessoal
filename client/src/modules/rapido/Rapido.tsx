import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { api } from '../../lib/api';
import type { CategoriaDTO, ContaDTO, TipoTransacao, TransacaoDTO } from '../../lib/financas';
import { formatarReais, hojeISO, lerValor, mensagemErro } from '../../lib/financas';
import { useDados } from '../../lib/useDados';
import { Aviso, Botao, Carregando, Cartao, Pagina } from '../../ui';
import './rapido.css';

const CHAVE_CONTA = 'financas.rapido.conta';
const MAX_CHIPS = 8;
const SEGUNDOS_DESFAZER = 8;
const MAX_RECENTES = 5;

// Lê a última conta usada; qualquer falha (armazenamento bloqueado, valor inválido) vira null.
function lerContaSalva(): number | null {
  try {
    const bruto = localStorage.getItem(CHAVE_CONTA);
    if (!bruto) return null;
    const numero = Number(bruto);
    return Number.isInteger(numero) && numero > 0 ? numero : null;
  } catch {
    return null;
  }
}

function salvarConta(id: number): void {
  try {
    localStorage.setItem(CHAVE_CONTA, String(id));
  } catch {
    // Sem armazenamento: a conta simplesmente não é lembrada.
  }
}

// Data 'AAAA-MM-DD' de `dias` dias antes de hoje (0 = hoje), no fuso local.
function dataDiasAtras(dias: number): string {
  const d = new Date();
  d.setDate(d.getDate() - dias);
  const mes = String(d.getMonth() + 1).padStart(2, '0');
  const dia = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mes}-${dia}`;
}

export function Rapido() {
  const contas = useDados<ContaDTO[]>('/contas');
  const categorias = useDados<CategoriaDTO[]>('/categorias');
  const recentes = useDados<{ itens: TransacaoDTO[] }>('/transacoes?porPagina=200');

  const [tipo, setTipo] = useState<TipoTransacao>('DESPESA');
  const [valorTexto, setValorTexto] = useState('');
  const [categoriaId, setCategoriaId] = useState<number | null>(null);
  const [verTodas, setVerTodas] = useState(false);
  const [contaId, setContaId] = useState<number | null>(() => lerContaSalva());
  const [descricao, setDescricao] = useState('');
  const [data, setData] = useState(hojeISO());
  const [enviando, setEnviando] = useState(false);
  const [erroEnvio, setErroEnvio] = useState<string | null>(null);
  const [ultimo, setUltimo] = useState<TransacaoDTO | null>(null);
  const [sessao, setSessao] = useState<TransacaoDTO[]>([]);

  const enviandoRef = useRef(false);
  const timerRef = useRef<number | null>(null);
  const campoValorRef = useRef<HTMLInputElement | null>(null);

  // Foco automático no valor ao abrir.
  useEffect(() => {
    campoValorRef.current?.focus();
  }, []);

  // Cancela o temporizador de "Desfazer" ao sair da tela.
  useEffect(() => {
    return () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    };
  }, []);

  // Contas que o servidor aceita lançamento manual (as do Open Finance chegam sozinhas).
  const contasManuais = (contas.dados ?? []).filter((c) => c.origem !== 'OPEN_FINANCE');

  // Se a conta lembrada não existe mais, deixa de pré-selecioná-la.
  useEffect(() => {
    if (contas.dados === null) return;
    if (contaId !== null && !contasManuais.some((c) => c.id === contaId)) setContaId(null);
  }, [contas.dados]);

  const categoriasDoTipo = (categorias.dados ?? []).filter((c) => c.tipo === tipo);

  // Contagem de uso por categoria nos últimos lançamentos do tipo escolhido (sem transferências).
  const usos = new Map<number, number>();
  for (const t of recentes.dados?.itens ?? []) {
    if (t.tipo !== tipo || t.transferencia || t.categoriaId === null) continue;
    usos.set(t.categoriaId, (usos.get(t.categoriaId) ?? 0) + 1);
  }
  const categoriasOrdenadas = [...categoriasDoTipo].sort((a, b) => {
    const diferenca = (usos.get(b.id) ?? 0) - (usos.get(a.id) ?? 0);
    return diferenca !== 0 ? diferenca : a.nome.localeCompare(b.nome, 'pt-BR');
  });
  const chipsVisiveis = verTodas ? categoriasOrdenadas : categoriasOrdenadas.slice(0, MAX_CHIPS);

  const categoriaEscolhida = categoriasDoTipo.find((c) => c.id === categoriaId) ?? null;

  const valor = lerValor(valorTexto);
  const podeLancar = valor !== null && valor > 0 && contaId !== null && !enviando;

  function mudarTipo(novo: TipoTransacao) {
    setTipo(novo);
    setCategoriaId(null);
    setVerTodas(false);
  }

  function escolherConta(id: number) {
    setContaId(id);
    salvarConta(id);
  }

  function limparFormulario() {
    setValorTexto('');
    setCategoriaId(null);
    setDescricao('');
    setData(hojeISO());
    setVerTodas(false);
    setErroEnvio(null);
  }

  async function lancar(evento?: FormEvent) {
    evento?.preventDefault();
    if (enviandoRef.current || valor === null || valor <= 0 || contaId === null) return;

    enviandoRef.current = true;
    setEnviando(true);
    setErroEnvio(null);

    const textoDescricao =
      descricao.trim() || categoriaEscolhida?.nome || 'Lançamento rápido';

    try {
      const criado = await api.post<TransacaoDTO>('/transacoes', {
        contaId,
        data,
        descricao: textoDescricao,
        valor,
        tipo,
        categoriaId,
      });

      setSessao((lista) => [criado, ...lista].slice(0, MAX_RECENTES));
      setUltimo(criado);
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => {
        setUltimo(null);
        timerRef.current = null;
      }, SEGUNDOS_DESFAZER * 1000);

      limparFormulario();
      requestAnimationFrame(() => campoValorRef.current?.focus());
    } catch (e) {
      setErroEnvio(mensagemErro(e));
    } finally {
      enviandoRef.current = false;
      setEnviando(false);
    }
  }

  async function desfazer() {
    if (!ultimo || enviandoRef.current) return;
    const alvo = ultimo;
    enviandoRef.current = true;
    setEnviando(true);
    try {
      await api.del(`/transacoes/${alvo.id}`);
      setSessao((lista) => lista.filter((t) => t.id !== alvo.id));
      setUltimo(null);
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      timerRef.current = null;
    } catch (e) {
      setErroEnvio(mensagemErro(e));
    } finally {
      enviandoRef.current = false;
      setEnviando(false);
    }
  }

  if (contas.carregando || categorias.carregando || recentes.carregando) {
    return (
      <Pagina titulo="Lançar rápido">
        <Carregando />
      </Pagina>
    );
  }

  const erroCarga = contas.erro ?? categorias.erro ?? recentes.erro;
  if (erroCarga) {
    return (
      <Pagina titulo="Lançar rápido">
        <Aviso tipo="erro">{erroCarga}</Aviso>
      </Pagina>
    );
  }

  return (
    <Pagina titulo="Lançar rápido">
      <form className="rapido" onSubmit={lancar}>
        <div className="rapido-alternador" role="group" aria-label="Tipo do lançamento">
          <button
            type="button"
            className={`rapido-tipo ${tipo === 'DESPESA' ? 'ativo' : ''}`}
            aria-pressed={tipo === 'DESPESA'}
            onClick={() => mudarTipo('DESPESA')}
          >
            Gasto
          </button>
          <button
            type="button"
            className={`rapido-tipo ${tipo === 'RECEITA' ? 'ativo' : ''}`}
            aria-pressed={tipo === 'RECEITA'}
            onClick={() => mudarTipo('RECEITA')}
          >
            Receita
          </button>
        </div>

        <label className="rapido-valor">
          <span className="rapido-rotulo">Valor (R$)</span>
          <input
            ref={campoValorRef}
            className="rapido-valor-campo"
            type="text"
            inputMode="decimal"
            placeholder="0,00"
            value={valorTexto}
            onChange={(e) => setValorTexto(e.target.value)}
          />
        </label>

        <Cartao titulo="Categoria">
          {categoriasDoTipo.length === 0 ? (
            <p className="rapido-ajuda">Nenhuma categoria de {tipo === 'DESPESA' ? 'gasto' : 'receita'} cadastrada.</p>
          ) : (
            <>
              <div className="rapido-chips">
                {chipsVisiveis.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    className={`rapido-chip ${categoriaId === c.id ? 'ativo' : ''}`}
                    aria-pressed={categoriaId === c.id}
                    onClick={() => setCategoriaId(categoriaId === c.id ? null : c.id)}
                  >
                    {c.nome}
                  </button>
                ))}
              </div>
              {categoriasOrdenadas.length > MAX_CHIPS && (
                <button type="button" className="rapido-ver-todas" onClick={() => setVerTodas(!verTodas)}>
                  {verTodas ? 'Ver menos' : 'Ver todas'}
                </button>
              )}
            </>
          )}
        </Cartao>

        <Cartao titulo="Conta ou cartão">
          <div className="rapido-chips">
            {contasManuais.map((c) => (
              <button
                key={c.id}
                type="button"
                className={`rapido-chip ${contaId === c.id ? 'ativo' : ''}`}
                aria-pressed={contaId === c.id}
                onClick={() => escolherConta(c.id)}
              >
                {c.nome}
              </button>
            ))}
          </div>
          {contasManuais.length === 0 && <p className="rapido-ajuda">Cadastre uma conta antes de lançar.</p>}
        </Cartao>

        <Cartao titulo="Detalhes">
          <label className="campo">
            <span className="campo-rotulo">Descrição (opcional)</span>
            <input
              className="campo-controle"
              type="text"
              maxLength={200}
              placeholder={categoriaEscolhida?.nome ?? 'Lançamento rápido'}
              value={descricao}
              onChange={(e) => setDescricao(e.target.value)}
            />
          </label>
          <label className="campo">
            <span className="campo-rotulo">Data</span>
            <input className="campo-controle" type="date" value={data} onChange={(e) => setData(e.target.value)} />
          </label>
          <div className="rapido-chips">
            <button type="button" className={`rapido-chip ${data === dataDiasAtras(0) ? 'ativo' : ''}`} onClick={() => setData(dataDiasAtras(0))}>
              Hoje
            </button>
            <button type="button" className={`rapido-chip ${data === dataDiasAtras(1) ? 'ativo' : ''}`} onClick={() => setData(dataDiasAtras(1))}>
              Ontem
            </button>
          </div>
        </Cartao>

        {erroEnvio && <Aviso tipo="erro">{erroEnvio}</Aviso>}

        {ultimo && (
          <div className="rapido-desfazer">
            <Aviso tipo="sucesso">
              Lançado: {formatarReais(ultimo.valor)} em {ultimo.categoriaNome ?? 'sem categoria'}
            </Aviso>
            <Botao variante="secundario" desabilitado={enviando} aoClicar={desfazer}>
              Desfazer
            </Botao>
          </div>
        )}

        <div className="rapido-rodape">
          <button type="submit" className="rapido-lancar" disabled={!podeLancar}>
            {enviando ? 'Lançando...' : 'Lançar'}
          </button>
        </div>
      </form>

      <Cartao titulo="Últimos lançados aqui">
        {sessao.length === 0 ? (
          <p className="rapido-ajuda">Nenhum lançamento nesta sessão.</p>
        ) : (
          <ul className="rapido-recentes">
            {sessao.map((t) => (
              <li key={t.id}>
                <span>{t.descricao}</span>
                <strong>{formatarReais(t.valor)}</strong>
              </li>
            ))}
          </ul>
        )}
      </Cartao>
    </Pagina>
  );
}
