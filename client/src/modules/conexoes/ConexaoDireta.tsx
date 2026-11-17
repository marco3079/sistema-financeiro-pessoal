import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api';
import { STATUS_CONEXAO, mensagemErro } from '../../lib/financas';
import type { StatusConexao } from '../../lib/financas';
import { useDados } from '../../lib/useDados';
import { Aviso, Botao, Campo, Cartao, MenuAcoes, Modal, Selecao, Selo, formatarDataHora } from '../../ui';
import type { AcaoMenu } from '../../ui';
import { Icone } from '../../ui/icones';

// Conexão direta com a API do banco (contas PJ) e o quadro de como trazer os dados de cada banco
// (arquivo, Open Finance ou API direta).

interface CampoCredencial {
  nome: string;
  rotulo: string;
  tipo: 'texto' | 'segredo' | 'arquivo';
  obrigatorio: boolean;
  ajuda?: string;
  aceita?: string;
}

interface ConectorDTO {
  id: string;
  nome: string;
  cor: string;
  campos: CampoCredencial[];
  comoObter: string[];
  observacao: string | null;
}

interface ConexaoDiretaDTO {
  id: number;
  banco: string;
  bancoNome: string;
  cor: string | null;
  apelido: string;
  contaId: number | null;
  status: StatusConexao;
  erro: string | null;
  ultimaSincronizacao: string | null;
}

interface EstadoBancosDTO {
  conectores: ConectorDTO[];
  conexoes: ConexaoDiretaDTO[];
}

// Como cada banco chega ao sistema. api: id do conector de API direta, ou o motivo de não haver.
const CATALOGO: { nome: string; api: string }[] = [
  { nome: 'Itaú / Itaú Empresas', api: 'PJ só com contrato e certificado pedidos ao gerente; ainda sem conector' },
  { nome: 'Nubank (PF e PJ)', api: 'Não tem API aberta a clientes' },
  { nome: 'XP Investimentos', api: 'Não tem API aberta a clientes' },
  { nome: 'Banco Inter (PF)', api: 'A API do Inter é só da conta PJ' },
  { nome: 'Banco Inter Empresas', api: 'inter' },
  { nome: 'Cora', api: 'cora' },
  { nome: 'Mercado Pago', api: 'mercadopago' },
  { nome: 'Banco do Brasil', api: 'PJ com convênio no BB Developers; ainda sem conector' },
  { nome: 'Bradesco', api: 'PJ com contrato; ainda sem conector' },
  { nome: 'Santander', api: 'PJ com contrato; ainda sem conector' },
  { nome: 'Sicoob', api: 'PJ com cadastro no portal Sicoob; ainda sem conector' },
  { nome: 'Caixa, C6, BTG e outros', api: 'Sem API aberta a clientes (ou só por contrato)' },
];

async function lerArquivoTexto(arquivo: File): Promise<string> {
  if (arquivo.size > 20_000) throw new Error(`O arquivo ${arquivo.name} é grande demais para um certificado.`);
  return arquivo.text();
}

function Conectar({ conectores, aoConectado }: { conectores: ConectorDTO[]; aoConectado: (c: ConexaoDiretaDTO) => void }) {
  const [banco, setBanco] = useState(conectores[0]?.id ?? '');
  const [apelido, setApelido] = useState('');
  const [valores, setValores] = useState<Record<string, string>>({});
  const [nomesArquivos, setNomesArquivos] = useState<Record<string, string>>({});
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const conector = conectores.find((c) => c.id === banco) ?? null;

  function trocarBanco(id: string) {
    setBanco(id);
    setValores({});
    setNomesArquivos({});
    setErro(null);
  }

  async function escolherArquivo(campo: string, arquivo: File | undefined) {
    if (!arquivo) return;
    try {
      const texto = await lerArquivoTexto(arquivo);
      setValores((v) => ({ ...v, [campo]: texto }));
      setNomesArquivos((n) => ({ ...n, [campo]: arquivo.name }));
    } catch (e) {
      setErro(mensagemErro(e));
    }
  }

  async function enviar(e: FormEvent) {
    e.preventDefault();
    if (!conector) return;
    setErro(null);
    setOcupado(true);
    try {
      const criada = await api.post<ConexaoDiretaDTO>('/bancos/conexoes', {
        banco: conector.id,
        apelido: apelido.trim() || conector.nome,
        credenciais: valores,
      });
      aoConectado(criada);
    } catch (err) {
      setErro(mensagemErro(err));
    } finally {
      setOcupado(false);
    }
  }

  return (
    <form onSubmit={enviar}>
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      <Selecao
        rotulo="Banco"
        valor={banco}
        aoMudar={trocarBanco}
        opcoes={conectores.map((c) => ({ valor: c.id, rotulo: c.nome }))}
        obrigatorio
      />
      {conector && (
        <>
          <div className="conexoes-direta-passos">
            <strong>Como gerar as credenciais</strong>
            <ol>
              {conector.comoObter.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ol>
            {conector.observacao && <p className="fin-suave">{conector.observacao}</p>}
          </div>
          <Campo rotulo="Nome da conta no sistema" valor={apelido} aoMudar={setApelido} />
          {conector.campos.map((campo) =>
            campo.tipo === 'arquivo' ? (
              <label key={campo.nome} className="campo">
                <span className="campo-rotulo">
                  {campo.rotulo}
                  {campo.obrigatorio && ' *'}
                </span>
                <input
                  className="campo-controle"
                  type="file"
                  accept={campo.aceita}
                  required={campo.obrigatorio && !valores[campo.nome]}
                  onChange={(e) => void escolherArquivo(campo.nome, e.target.files?.[0])}
                />
                {nomesArquivos[campo.nome] && <span className="fin-suave">Lido: {nomesArquivos[campo.nome]}</span>}
              </label>
            ) : (
              <Campo
                key={campo.nome}
                rotulo={campo.rotulo}
                tipo={campo.tipo === 'segredo' ? 'password' : 'text'}
                valor={valores[campo.nome] ?? ''}
                aoMudar={(v) => setValores((atual) => ({ ...atual, [campo.nome]: v }))}
                obrigatorio={campo.obrigatorio}
              />
            ),
          )}
          <p className="fin-suave">
            Antes de gravar, o sistema testa as credenciais no banco. Elas ficam cifradas no banco de dados, nunca voltam
            para o navegador e só servem para ler saldo e extrato.
          </p>
        </>
      )}
      <div className="pagina-acoes">
        <Botao tipo="submit" desabilitado={ocupado || !conector}>
          {ocupado ? 'Testando e conectando...' : 'Conectar'}
        </Botao>
      </div>
    </form>
  );
}

export function ConexoesDiretas() {
  const { dados, erro: erroCarga, recarregar } = useDados<EstadoBancosDTO>('/bancos/estado');
  const [abrirConectar, setAbrirConectar] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [sucesso, setSucesso] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  async function sincronizar(c: ConexaoDiretaDTO) {
    setErro(null);
    setSucesso(null);
    setOcupado(true);
    try {
      const atualizada = await api.post<ConexaoDiretaDTO>(`/bancos/conexoes/${c.id}/sincronizar`);
      if (atualizada.erro) setErro(atualizada.erro);
      else setSucesso(`${atualizada.apelido} atualizada.`);
      recarregar();
    } catch (e) {
      setErro(mensagemErro(e));
    } finally {
      setOcupado(false);
    }
  }

  async function remover(c: ConexaoDiretaDTO, manterDados: boolean) {
    const pergunta = manterDados
      ? `Remover a conexão ${c.apelido}? A conta e os lançamentos continuam, mas param de atualizar.`
      : `Remover a conexão ${c.apelido} e apagar a conta e todos os lançamentos dela?`;
    if (!window.confirm(pergunta)) return;
    setErro(null);
    setSucesso(null);
    try {
      await api.del(`/bancos/conexoes/${c.id}${manterDados ? '?manterDados=true' : ''}`);
      setSucesso(`Conexão ${c.apelido} removida.`);
      recarregar();
    } catch (e) {
      setErro(mensagemErro(e));
    }
  }

  function acoes(c: ConexaoDiretaDTO): AcaoMenu[] {
    return [
      { rotulo: 'Sincronizar agora', icone: 'sincronizar', aoClicar: () => void sincronizar(c) },
      { rotulo: 'Remover e manter os dados', icone: 'fechar', aoClicar: () => void remover(c, true) },
      { rotulo: 'Remover e apagar os dados', icone: 'lixeira', perigo: true, aoClicar: () => void remover(c, false) },
    ];
  }

  const conectores = dados?.conectores ?? [];
  const conexoes = dados?.conexoes ?? [];
  const nomeDoConector = new Map(conectores.map((c) => [c.id, c.nome]));

  return (
    <>
      <Cartao>
        <div className="fin-cabecalho">
          <div>
            <strong>API direta do banco (conta PJ)</strong>
            <p className="fin-suave">
              Saldo e extrato lidos direto na API do banco, com as credenciais e o certificado que o próprio banco dá à
              empresa. Atualiza sozinho a cada 6 horas.
            </p>
          </div>
          <Botao desabilitado={conectores.length === 0} aoClicar={() => setAbrirConectar(true)}>
            Conectar pela API
          </Botao>
        </div>
        {erroCarga && <Aviso tipo="erro">{erroCarga}</Aviso>}
        {erro && <Aviso tipo="erro">{erro}</Aviso>}
        {sucesso && <Aviso tipo="sucesso">{sucesso}</Aviso>}
        {ocupado && <Aviso tipo="info">Buscando saldo e extrato no banco...</Aviso>}
        {conexoes.length > 0 && (
          <div className="fin-cartoes">
            {conexoes.map((c) => (
              <article key={c.id} className="cartao conexoes-item">
                <div className="conexoes-item-cabecalho">
                  <span className="conexoes-logo conexoes-logo-cor" style={{ background: c.cor ?? 'var(--cor-primaria)' }} aria-hidden="true">
                    <Icone nome="contas" tamanho={22} />
                  </span>
                  <strong className="conexoes-item-nome">{c.apelido}</strong>
                  <Selo cor={STATUS_CONEXAO[c.status].cor}>{STATUS_CONEXAO[c.status].rotulo}</Selo>
                  <MenuAcoes rotulo={'Ações de ' + c.apelido} acoes={acoes(c)} />
                </div>
                <span className="fin-suave conexoes-item-linha">{c.bancoNome} · API direta</span>
                <span className="fin-suave conexoes-item-linha">
                  {c.ultimaSincronizacao ? `Atualizada em ${formatarDataHora(c.ultimaSincronizacao)}` : 'Ainda não sincronizada'}
                </span>
                {c.erro && <Aviso tipo="erro">{c.erro}</Aviso>}
              </article>
            ))}
          </div>
        )}
      </Cartao>

      <Cartao titulo="Como trazer os dados de cada banco">
        <p className="fin-suave">
          Todo banco entra por <Link to="/app/importar">arquivo</Link> (extrato e fatura em CSV, OFX, PDF ou XLSX) e pelo
          Open Finance (Pluggy, acima). Conta de pessoa física não tem API direta no Brasil: o acesso por API a ela é o
          Open Finance. A API direta existe para contas PJ, banco a banco.
        </p>
        <div className="conexoes-catalogo" role="table" aria-label="Formas de conexão por banco">
          <div className="conexoes-catalogo-linha conexoes-catalogo-cabecalho" role="row">
            <span role="columnheader">Banco</span>
            <span role="columnheader">Arquivo</span>
            <span role="columnheader">Open Finance</span>
            <span role="columnheader">API direta</span>
          </div>
          {CATALOGO.map((b) => {
            const temConector = nomeDoConector.has(b.api);
            return (
              <div key={b.nome} className="conexoes-catalogo-linha" role="row">
                <span role="cell">
                  <strong>{b.nome}</strong>
                </span>
                <span role="cell">Sim</span>
                <span role="cell">Sim</span>
                <span role="cell" className={temConector ? 'conexoes-catalogo-sim' : 'fin-suave'}>
                  {temConector ? 'Sim, neste sistema' : b.api}
                </span>
              </div>
            );
          })}
        </div>
      </Cartao>

      <Modal aberto={abrirConectar} titulo="Conectar pela API do banco" aoFechar={() => setAbrirConectar(false)}>
        {abrirConectar && (
          <Conectar
            conectores={conectores}
            aoConectado={(c) => {
              setAbrirConectar(false);
              if (c.erro) setErro(`Conectado, mas a primeira leitura falhou: ${c.erro}`);
              else setSucesso(`${c.apelido} conectada. Saldo e extrato dos últimos 90 dias trazidos.`);
              recarregar();
            }}
          />
        )}
      </Modal>
    </>
  );
}
