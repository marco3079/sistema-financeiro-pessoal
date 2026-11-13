import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../lib/api';
import type { CategoriaDTO, ContaDTO, TipoTransacao, TransacaoDTO } from '../../lib/financas';
import { formatarReais, hojeISO, lerValor, mensagemErro, valorParaCampo } from '../../lib/financas';
import { useDados } from '../../lib/useDados';
import { Aviso, Botao, Carregando, Cartao, Pagina } from '../../ui';
import './rapido.css';

const CHAVE_CONTA = 'financas.rapido.conta';
const MAX_CHIPS = 8;
const SEGUNDOS_DESFAZER = 8;
const MAX_RECENTES = 5;
const LADO_MAXIMO_FOTO = 1280;
const QUALIDADE_FOTO = 0.7;

interface LeituraCupom {
  valor: number | null;
  data: string | null;
  estabelecimento: string | null;
  categoriaSugerida: string | null;
  itens: number;
}

// Reduz a foto no navegador (até 1280 px no maior lado, JPEG qualidade 0.7) e devolve só o base64, sem prefixo.
async function reduzirFoto(arquivo: File): Promise<string> {
  const url = URL.createObjectURL(arquivo);
  try {
    const imagem = await new Promise<HTMLImageElement>((ok, falha) => {
      const img = new Image();
      img.onload = () => ok(img);
      img.onerror = () => falha(new Error('Não consegui abrir a foto. Tente outra.'));
      img.src = url;
    });
    const escala = Math.min(1, LADO_MAXIMO_FOTO / Math.max(imagem.naturalWidth, imagem.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(imagem.naturalWidth * escala));
    canvas.height = Math.max(1, Math.round(imagem.naturalHeight * escala));
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Este navegador não consegue reduzir a foto.');
    ctx.drawImage(imagem, 0, 0, canvas.width, canvas.height);
    const jpeg = canvas.toDataURL('image/jpeg', QUALIDADE_FOTO);
    return jpeg.slice(jpeg.indexOf(',') + 1);
  } finally {
    URL.revokeObjectURL(url);
  }
}

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
  const [lendoCupom, setLendoCupom] = useState(false);
  const [avisoCupom, setAvisoCupom] = useState<string | null>(null);
  const estadoCupom = useDados<{ configurada: boolean }>('/cupom/estado');
  const fotoRef = useRef<HTMLInputElement | null>(null);
  const navigate = useNavigate();

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

  // Lê a foto do cupom e preenche os campos. Nada é lançado: a pessoa confere e clica em Lançar.
  async function lerCupom(arquivo: File) {
    setAvisoCupom(null);
    setErroEnvio(null);
    setLendoCupom(true);
    try {
      const imagem = await reduzirFoto(arquivo);
      const lido = await api.post<LeituraCupom>('/cupom/ler', { imagem, tipo: 'image/jpeg' });
      if (lido.valor !== null) setValorTexto(valorParaCampo(lido.valor));
      if (lido.data) setData(lido.data);
      if (lido.estabelecimento) setDescricao(lido.estabelecimento);
      if (lido.categoriaSugerida) {
        const sugerida = (categorias.dados ?? []).find(
          (c) => c.tipo === 'DESPESA' && c.nome === lido.categoriaSugerida
        );
        if (sugerida) {
          setTipo('DESPESA');
          setCategoriaId(sugerida.id);
        }
      }
      setAvisoCupom(
        lido.valor === null ? 'Não achei o total do cupom. Confira os campos.' : 'Cupom lido. Confira os dados antes de lançar.'
      );
    } catch (e) {
      setErroEnvio(mensagemErro(e));
    } finally {
      setLendoCupom(false);
      if (fotoRef.current) fotoRef.current.value = '';
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

        <div className="rapido-cupom">
          {estadoCupom.dados?.configurada === false ? (
            <button type="button" className="rapido-chip" onClick={() => navigate('/app/cupom')}>
              Foto do cupom (configurar chave)
            </button>
          ) : (
            <>
              <button
                type="button"
                className="rapido-chip"
                disabled={lendoCupom}
                onClick={() => fotoRef.current?.click()}
              >
                {lendoCupom ? 'Lendo cupom...' : 'Foto do cupom'}
              </button>
              <input
                ref={fotoRef}
                type="file"
                accept="image/*"
                capture="environment"
                hidden
                onChange={(e) => {
                  const arquivo = e.target.files?.[0];
                  if (arquivo) void lerCupom(arquivo);
                }}
              />
            </>
          )}
          {avisoCupom && <Aviso tipo="info">{avisoCupom}</Aviso>}
        </div>

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
