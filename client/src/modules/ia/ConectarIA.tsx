import { useEffect, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { api } from '../../lib/api';
import { mensagemErro } from '../../lib/financas';
import { useDados } from '../../lib/useDados';
import { Abas, Aviso, Botao, Campo, Cartao, Carregando, Modal, Pagina, Selecao, Selo, Tabela, formatarDataHora } from '../../ui';
import './ia.css';

const NOME_MAXIMO = 60;
const ENDERECO = window.location.origin + '/api/mcp';
const SEM_CHAVE = 'SUA_CHAVE';

interface ChaveDTO {
  id: number;
  nome: string;
  prefixo: string;
  permissao: 'LEITURA' | 'ESCRITA';
  criadoEm: string;
  ultimoUsoEm: string | null;
  usos: number;
}

interface FerramentaDTO {
  nome: string;
  titulo: string;
  descricao: string;
  escrita: boolean;
}

interface RespostaChaves {
  chaves: ChaveDTO[];
  ferramentas: FerramentaDTO[];
}

type ChaveCriada = ChaveDTO & { chave: string };

type AbaConexao = 'claude-code' | 'claude-desktop' | 'cursor' | 'vscode' | 'navegador';

const ABAS_CONEXAO: { id: AbaConexao; rotulo: string }[] = [
  { id: 'claude-code', rotulo: 'Claude Code' },
  { id: 'claude-desktop', rotulo: 'Claude Desktop' },
  { id: 'cursor', rotulo: 'Cursor' },
  { id: 'vscode', rotulo: 'VS Code' },
  { id: 'navegador', rotulo: 'Pelo navegador' },
];

function podeCopiar(): boolean {
  return typeof navigator !== 'undefined' && navigator.clipboard !== undefined;
}

function copiarTexto(texto: string): Promise<void> {
  return navigator.clipboard.writeText(texto);
}

// Botão "Copiar" que volta ao normal depois de 2 s. Some se o navegador não tiver área de transferência.
function BotaoCopiar({ texto, rotulo = 'Copiar' }: { texto: string; rotulo?: string }) {
  const [copiado, setCopiado] = useState(false);

  useEffect(() => {
    if (!copiado) return;
    const t = setTimeout(() => setCopiado(false), 2000);
    return () => clearTimeout(t);
  }, [copiado]);

  if (!podeCopiar()) return null;

  return (
    <Botao
      variante="texto"
      aoClicar={() => {
        copiarTexto(texto)
          .then(() => setCopiado(true))
          .catch(() => setCopiado(false));
      }}
    >
      {copiado ? 'Copiada' : rotulo}
    </Botao>
  );
}

function BlocoCodigo({ texto }: { texto: string }) {
  return (
    <div className="ia-bloco-codigo">
      <pre className="ia-codigo">
        <code>{texto}</code>
      </pre>
      <BotaoCopiar texto={texto} />
    </div>
  );
}

// ---------- Criar chave ----------

function FormChave({
  aoCriada,
  aoCancelar,
}: {
  aoCriada: (chave: ChaveCriada) => void;
  aoCancelar: () => void;
}) {
  const [nome, setNome] = useState('');
  const [permissao, setPermissao] = useState<'LEITURA' | 'ESCRITA'>('LEITURA');
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function criar(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    const limpo = nome.trim();
    if (limpo === '') {
      setErro('Informe um nome para a chave.');
      return;
    }
    if (limpo.length > NOME_MAXIMO) {
      setErro(`O nome pode ter até ${NOME_MAXIMO} caracteres.`);
      return;
    }
    setOcupado(true);
    try {
      const criada = await api.post<ChaveCriada>('/mcp/chaves', { nome: limpo, permissao });
      aoCriada(criada);
    } catch (err) {
      setErro(mensagemErro(err));
      setOcupado(false);
    }
  }

  return (
    <form onSubmit={criar}>
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      <Campo rotulo="Nome" valor={nome} aoMudar={setNome} obrigatorio />
      <Selecao
        rotulo="Permissão"
        valor={permissao}
        aoMudar={(v) => setPermissao(v === 'ESCRITA' ? 'ESCRITA' : 'LEITURA')}
        opcoes={[
          { valor: 'LEITURA', rotulo: 'Só consulta' },
          { valor: 'ESCRITA', rotulo: 'Consulta e lança' },
        ]}
        vazio="Selecione"
        obrigatorio
      />
      {permissao === 'ESCRITA' && (
        <Aviso tipo="info">A IA poderá criar lançamentos e mudar categorias. Ela não apaga nada.</Aviso>
      )}
      <div className="pagina-acoes">
        <Botao variante="secundario" aoClicar={aoCancelar} desabilitado={ocupado}>
          Cancelar
        </Botao>
        <Botao tipo="submit" desabilitado={ocupado || nome.trim() === ''}>
          Criar chave
        </Botao>
      </div>
    </form>
  );
}

// ---------- Exemplos de conexão ----------

function ExemplosConexao({ chave }: { chave: string }) {
  const [aba, setAba] = useState<AbaConexao>('claude-code');

  let conteudo: ReactNode;
  switch (aba) {
    case 'claude-code':
      conteudo = (
        <>
          <p className="ia-texto-suave">No terminal, na pasta do seu projeto:</p>
          <BlocoCodigo
            texto={`claude mcp add --transport http financas ${ENDERECO} --header "Authorization: Bearer ${chave}"`}
          />
        </>
      );
      break;
    case 'claude-desktop': {
      const config = {
        mcpServers: {
          financas: {
            command: 'npx',
            args: ['-y', 'mcp-remote', ENDERECO, '--header', 'Authorization:${AUTH_HEADER}'],
            env: { AUTH_HEADER: 'Bearer ' + chave },
          },
        },
      };
      conteudo = (
        <>
          <p className="ia-texto-suave">
            Abra Configurações &gt; Desenvolvedor &gt; Editar configuração e acrescente ao arquivo
            claude_desktop_config.json (precisa do Node.js instalado). Depois feche e abra o Claude Desktop.
          </p>
          <BlocoCodigo texto={JSON.stringify(config, null, 2)} />
        </>
      );
      break;
    }
    case 'cursor': {
      const config = {
        mcpServers: {
          financas: { url: ENDERECO, headers: { Authorization: 'Bearer ' + chave } },
        },
      };
      conteudo = (
        <>
          <p className="ia-texto-suave">
            Crie o arquivo .cursor/mcp.json na pasta do projeto (ou ~/.cursor/mcp.json para valer em todos):
          </p>
          <BlocoCodigo texto={JSON.stringify(config, null, 2)} />
        </>
      );
      break;
    }
    case 'vscode': {
      const config = {
        servers: {
          financas: { type: 'http', url: ENDERECO, headers: { Authorization: 'Bearer ' + chave } },
        },
      };
      conteudo = (
        <>
          <p className="ia-texto-suave">Crie o arquivo .vscode/mcp.json na pasta do projeto:</p>
          <BlocoCodigo texto={JSON.stringify(config, null, 2)} />
        </>
      );
      break;
    }
    case 'navegador':
      conteudo = (
        <>
          <Aviso tipo="info">
            O ChatGPT e o Claude pelo navegador rodam na nuvem e não alcançam o seu computador. Para usar com eles, o
            sistema precisa estar publicado na internet com HTTPS (um domínio seu ou um túnel). Isso expõe a tela de
            login: use uma senha forte.
          </Aviso>
          <p className="ia-texto-suave">
            Com o sistema publicado, cadastre um conector personalizado (nas configurações do aplicativo, em
            Conectores) com este endereço, que já leva a chave:
          </p>
          <BlocoCodigo texto={`https://SEU-ENDERECO/api/mcp/${chave}`} />
          <p className="ia-texto-suave">
            Quem tiver esse endereço consulta seus dados. Trate-o como uma senha e prefira uma chave "Só consulta".
          </p>
        </>
      );
      break;
  }

  return (
    <>
      <Abas abas={ABAS_CONEXAO} ativa={aba} aoMudar={(id) => setAba(id as AbaConexao)} />
      {conteudo}
    </>
  );
}

// ---------- Tela ----------

export function ConectarIA() {
  const { dados, carregando, erro, recarregar } = useDados<RespostaChaves>('/mcp/chaves');
  const [formularioAberto, setFormularioAberto] = useState(false);
  const [nova, setNova] = useState<ChaveCriada | null>(null);
  const [copiadaNova, setCopiadaNova] = useState(false);

  const [aApagar, setAApagar] = useState<ChaveDTO | null>(null);
  const [ocupadoApagar, setOcupadoApagar] = useState(false);
  const [erroApagar, setErroApagar] = useState<string | null>(null);

  useEffect(() => {
    if (!copiadaNova) return;
    const t = setTimeout(() => setCopiadaNova(false), 2000);
    return () => clearTimeout(t);
  }, [copiadaNova]);

  function aoCriada(chave: ChaveCriada) {
    setNova(chave);
    setFormularioAberto(false);
    recarregar();
    window.scrollTo({ top: 0 });
  }

  function abrirApagar(chave: ChaveDTO) {
    setErroApagar(null);
    setAApagar(chave);
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
      await api.del('/mcp/chaves/' + aApagar.id);
      if (nova && nova.id === aApagar.id) setNova(null);
      setAApagar(null);
      setOcupadoApagar(false);
      recarregar();
    } catch (err) {
      setErroApagar(mensagemErro(err));
      setOcupadoApagar(false);
    }
  }

  const chaveExemplo = nova ? nova.chave : SEM_CHAVE;
  const consultar = dados ? dados.ferramentas.filter((f) => !f.escrita) : [];
  const lancar = dados ? dados.ferramentas.filter((f) => f.escrita) : [];

  return (
    <Pagina
      titulo="Conectar IA"
      acoes={<Botao aoClicar={() => setFormularioAberto(true)}>Nova chave</Botao>}
    >
      <div className="ia-blocos">
        <Aviso tipo="info">
          Com uma chave, um assistente de IA consulta seus dados financeiros para responder perguntas como "quanto
          gastei com mercado este ano?". O que ele consultar é enviado ao provedor da IA (Anthropic, OpenAI...). Crie
          uma chave para cada aplicativo e apague as que não usa mais.
        </Aviso>

        {erro && <Aviso tipo="erro">{erro}</Aviso>}

        {nova && (
          <Cartao titulo="Chave criada">
            <div className="ia-blocos">
              <Aviso tipo="info">Copie agora: a chave não aparece de novo.</Aviso>
              <code className="ia-codigo">{nova.chave}</code>
              <div className="pagina-acoes">
                {podeCopiar() && (
                  <Botao
                    aoClicar={() => {
                      copiarTexto(nova.chave)
                        .then(() => setCopiadaNova(true))
                        .catch(() => setCopiadaNova(false));
                    }}
                  >
                    {copiadaNova ? 'Copiada' : 'Copiar chave'}
                  </Botao>
                )}
                <Botao variante="texto" aoClicar={() => setNova(null)}>
                  Já copiei
                </Botao>
              </div>
            </div>
          </Cartao>
        )}

        <Cartao titulo="Chaves de acesso">
          {carregando && <Carregando />}
          {dados && (
            <Tabela<ChaveDTO>
              colunas={[
                { titulo: 'Nome', celula: (c) => c.nome },
                { titulo: 'Chave', celula: (c) => <code className="ia-tabela-chave">{c.prefixo}…</code> },
                {
                  titulo: 'Permissão',
                  celula: (c) =>
                    c.permissao === 'ESCRITA' ? (
                      <Selo cor="amarelo">Consulta e lança</Selo>
                    ) : (
                      <Selo cor="azul">Só consulta</Selo>
                    ),
                },
                { titulo: 'Criada em', celula: (c) => formatarDataHora(c.criadoEm) },
                {
                  titulo: 'Último uso',
                  celula: (c) => (c.ultimoUsoEm ? formatarDataHora(c.ultimoUsoEm) : 'Nunca usada'),
                },
                { titulo: 'Usos', alinhar: 'direita', celula: (c) => c.usos },
                {
                  titulo: 'Ações',
                  acoes: true,
                  celula: (c) => (
                    <Botao variante="texto" aoClicar={() => abrirApagar(c)}>
                      Apagar
                    </Botao>
                  ),
                },
              ]}
              dados={dados.chaves}
              chave={(c) => c.id}
              vazio="Nenhuma chave criada."
            />
          )}
        </Cartao>

        <Cartao titulo="Como conectar">
          <div className="ia-blocos">
            <p className="ia-texto-suave">Nos exemplos, troque SUA_CHAVE pela chave criada.</p>
            <ExemplosConexao chave={chaveExemplo} />
            <p className="ia-texto-suave">
              O caminho dos menus muda entre as versões de cada aplicativo; o que importa é o endereço e o cabeçalho
              Authorization.
            </p>
          </div>
        </Cartao>

        {dados && (
          <Cartao titulo="O que a IA pode fazer">
            <h3 className="ia-lista-titulo">Consultar</h3>
            <ul className="ia-lista">
              {consultar.map((f) => (
                <li key={f.nome} className="ia-item">
                  <strong>{f.titulo}</strong>
                  <span>{f.descricao}</span>
                </li>
              ))}
            </ul>
            <h3 className="ia-lista-titulo">Lançar (só chaves "Consulta e lança")</h3>
            <ul className="ia-lista">
              {lancar.map((f) => (
                <li key={f.nome} className="ia-item">
                  <strong>{f.titulo}</strong>
                  <span>{f.descricao}</span>
                </li>
              ))}
            </ul>
            <p className="ia-texto-suave">
              Nenhuma ferramenta apaga dados. Cada chave enxerga só o perfil financeiro em que foi criada.
            </p>
          </Cartao>
        )}
      </div>

      <Modal aberto={formularioAberto} titulo="Nova chave" aoFechar={() => setFormularioAberto(false)}>
        {formularioAberto && (
          <FormChave aoCriada={aoCriada} aoCancelar={() => setFormularioAberto(false)} />
        )}
      </Modal>

      <Modal aberto={aApagar !== null} titulo="Apagar chave" aoFechar={fecharApagar}>
        {aApagar && (
          <div>
            {erroApagar && <Aviso tipo="erro">{erroApagar}</Aviso>}
            <p>{`Apagar a chave "${aApagar.nome}"? O aplicativo que a usa perde o acesso na hora.`}</p>
            <div className="pagina-acoes">
              <Botao variante="secundario" aoClicar={fecharApagar} desabilitado={ocupadoApagar}>
                Cancelar
              </Botao>
              <Botao variante="perigo" aoClicar={confirmarApagar} desabilitado={ocupadoApagar}>
                Apagar chave
              </Botao>
            </div>
          </div>
        )}
      </Modal>
    </Pagina>
  );
}
