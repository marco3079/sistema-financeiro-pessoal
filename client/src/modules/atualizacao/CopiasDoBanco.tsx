import { useState } from 'react';
import { api } from '../../lib/api';
import { mensagemErro } from '../../lib/financas';
import { useDados } from '../../lib/useDados';
import { Aviso, Botao, Campo, Cartao, Carregando, Modal, Tabela } from '../../ui';

interface CopiaDTO {
  arquivo: string; // financas-AAAAMMDD-HHMMSS.sql
  feitaEm: string; // 'AAAA-MM-DDTHH:MM:SS', hora do computador em que a cópia foi feita
  tamanho: number; // bytes
}

interface CopiasDTO {
  copias: CopiaDTO[];
  vigiaAtivo: boolean;
}

const PALAVRA = 'RESTAURAR';

function quando(feitaEm: string): string {
  const [data, hora] = feitaEm.split('T');
  const [ano, mes, dia] = data.split('-');
  return `${dia}/${mes}/${ano} às ${hora.slice(0, 5)}`;
}

function tamanho(bytes: number): string {
  return bytes >= 1024 * 1024
    ? (bytes / (1024 * 1024)).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + ' MB'
    : Math.max(1, Math.round(bytes / 1024)).toLocaleString('pt-BR') + ' KB';
}

// Cópias do banco guardadas antes de cada atualização, com a opção de voltar a uma delas.
// `aoPedir` avisa a tela de fora que um pedido foi aceito, para ela acompanhar o andamento.
export function CopiasDoBanco({ ocupado, aoPedir }: { ocupado: boolean; aoPedir: () => void }) {
  const { dados, carregando, erro, recarregar } = useDados<CopiasDTO>('/atualizacao/copias');
  const [escolhida, setEscolhida] = useState<CopiaDTO | null>(null);
  const [digitado, setDigitado] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [erroAcao, setErroAcao] = useState<string | null>(null);
  const [copiando, setCopiando] = useState(false);
  const [erroCopia, setErroCopia] = useState<string | null>(null);

  // Pede a cópia ao atualizador; a lista é recarregada depois de alguns segundos (o pg_dump é rápido).
  async function criarCopia() {
    setCopiando(true);
    setErroCopia(null);
    try {
      await api.post('/atualizacao/copiar');
      aoPedir();
      window.setTimeout(recarregar, 6000);
      window.setTimeout(recarregar, 15000);
    } catch (e) {
      setErroCopia(mensagemErro(e));
    } finally {
      setCopiando(false);
    }
  }

  async function restaurar() {
    if (!escolhida) return;
    setEnviando(true);
    setErroAcao(null);
    try {
      await api.post('/atualizacao/restaurar', { arquivo: escolhida.arquivo });
      setEscolhida(null);
      setDigitado('');
      aoPedir();
    } catch (e) {
      setErroAcao(mensagemErro(e));
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Cartao>
      <div className="fin-cabecalho">
        <strong>Cópias do banco de dados</strong>
        <Botao desabilitado={!dados?.vigiaAtivo || ocupado || copiando} aoClicar={() => void criarCopia()}>
          {copiando ? 'Pedindo…' : 'Criar cópia agora'}
        </Botao>
      </div>
      <p className="atu-suave">
        Antes de cada atualização o sistema guarda uma cópia de todos os dados na pasta backups, e você pode criar uma
        quando quiser (ficam as 5 mais recentes). Restaurar troca os dados de agora pelos da cópia; antes de trocar, o
        estado atual também é guardado.
      </p>
      {erroCopia && <Aviso tipo="erro">{erroCopia}</Aviso>}
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      {!dados && carregando && <Carregando />}
      {dados && !dados.vigiaAtivo && dados.copias.length > 0 && (
        <Aviso tipo="info">
          O atualizador não está ligado neste computador, então o botão fica desabilitado. Para restaurar sem ele, rode
          no PowerShell: atualizar.ps1 -Restaurar seguido do nome da cópia.
        </Aviso>
      )}
      {dados && (
        <Tabela<CopiaDTO>
          chave={(c) => c.arquivo}
          dados={dados.copias}
          vazio="Nenhuma cópia ainda. Crie uma agora ou espere a próxima atualização."
          colunas={[
            { titulo: 'Feita em', celula: (c) => quando(c.feitaEm) },
            { titulo: 'Arquivo', celula: (c) => c.arquivo },
            { titulo: 'Tamanho', alinhar: 'direita', celula: (c) => tamanho(c.tamanho) },
            {
              titulo: 'Ações',
              acoes: true,
              celula: (c) => (
                <Botao
                  variante="texto"
                  desabilitado={!dados.vigiaAtivo || ocupado}
                  aoClicar={() => {
                    setErroAcao(null);
                    setDigitado('');
                    setEscolhida(c);
                  }}
                >
                  Restaurar
                </Botao>
              ),
            },
          ]}
        />
      )}

      <Modal aberto={escolhida !== null} titulo="Restaurar cópia do banco" aoFechar={() => setEscolhida(null)}>
        {escolhida && (
          <div className="atu-blocos">
            <p>
              Todos os dados de agora (contas, lançamentos, faturas, investimentos, perfis e usuários) serão trocados
              pelos da cópia de {quando(escolhida.feitaEm)}. O que foi lançado depois dessa data deixa de aparecer.
            </p>
            <p className="atu-suave">
              O estado atual é guardado como uma cópia nova antes da troca, então dá para voltar. O sistema fica fora do
              ar por um ou dois minutos e você precisará entrar de novo.
            </p>
            <Campo rotulo={`Digite ${PALAVRA} para confirmar`} valor={digitado} aoMudar={setDigitado} />
            {erroAcao && <Aviso tipo="erro">{erroAcao}</Aviso>}
            <div className="pagina-acoes">
              <Botao variante="secundario" aoClicar={() => setEscolhida(null)}>
                Cancelar
              </Botao>
              <Botao variante="perigo" desabilitado={enviando || digitado.trim().toUpperCase() !== PALAVRA} aoClicar={restaurar}>
                {enviando ? 'Enviando…' : 'Restaurar esta cópia'}
              </Botao>
            </div>
          </div>
        )}
      </Modal>
    </Cartao>
  );
}
