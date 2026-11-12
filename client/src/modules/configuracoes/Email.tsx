import { useState } from 'react';
import { api } from '../../lib/api';
import { Aviso, Botao, Campo, Caixa, Cartao } from '../../ui';
import { mensagemErro, nulo } from '../cadastros/tipos';
import { HistoricoEmails } from './HistoricoEmails';
import { formularioDe } from './tipos';
import type { ConfiguracoesDTO, EmailFormulario } from './tipos';

export function Email({
  config,
  aoSalvo,
}: {
  config: ConfiguracoesDTO;
  aoSalvo: (novo: ConfiguracoesDTO) => Promise<void>;
}) {
  const [form, setForm] = useState<EmailFormulario>(() => formularioDe(config));
  // Senha gravada marcada para remoção (vai como smtpSenha: '' no próximo salvar).
  const [apagarSenha, setApagarSenha] = useState(false);
  const [aviso, setAviso] = useState<{ tipo: 'erro' | 'sucesso'; texto: string } | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const [destinatario, setDestinatario] = useState('');
  const [testando, setTestando] = useState(false);
  const [resultadoTeste, setResultadoTeste] = useState<{
    tipo: 'sucesso' | 'erro';
    texto: string;
  } | null>(null);
  // Muda a cada teste, para o histórico recarregar.
  const [versaoHistorico, setVersaoHistorico] = useState(0);

  function mudar(parcial: Partial<EmailFormulario>) {
    setForm((atual) => ({ ...atual, ...parcial }));
  }

  async function salvar() {
    setAviso(null);
    const porta = Number(form.smtpPorta);
    if (!Number.isInteger(porta) || porta < 1 || porta > 65535) {
      setAviso({ tipo: 'erro', texto: 'A porta deve ser um número de 1 a 65535.' });
      return;
    }
    // Senha: '' apaga a gravada; digitada, troca; em branco e sem remoção, não é enviada (mantém).
    let senhaNoCorpo: { smtpSenha?: string } = {};
    if (apagarSenha) {
      senhaNoCorpo = { smtpSenha: '' };
    } else if (form.smtpSenha !== '') {
      senhaNoCorpo = { smtpSenha: form.smtpSenha };
    }
    const corpo = {
      enderecoSite: nulo(form.enderecoSite),
      smtpServidor: nulo(form.smtpServidor),
      smtpPorta: porta,
      smtpSeguro: form.smtpSeguro,
      smtpUsuario: nulo(form.smtpUsuario),
      ...senhaNoCorpo,
      emailRemetente: nulo(form.emailRemetente),
      emailNomeRemetente: nulo(form.emailNomeRemetente),
      emailAtivo: form.emailAtivo,
      emailRecuperacao: form.emailRecuperacao,
      emailBoasVindas: form.emailBoasVindas,
    };
    setOcupado(true);
    try {
      const novo = await api.put<ConfiguracoesDTO>('/configuracoes/email', corpo);
      setForm(formularioDe(novo));
      setApagarSenha(false);
      await aoSalvo(novo);
      setAviso({ tipo: 'sucesso', texto: 'Configurações de e-mail salvas.' });
    } catch (e) {
      setAviso({ tipo: 'erro', texto: mensagemErro(e) });
    } finally {
      setOcupado(false);
    }
  }

  async function testar() {
    setResultadoTeste(null);
    const para = destinatario.trim();
    if (!para.includes('@')) {
      setResultadoTeste({ tipo: 'erro', texto: 'Informe um e-mail válido para o teste.' });
      return;
    }
    setTestando(true);
    try {
      await api.post('/configuracoes/email/teste', { para });
      setResultadoTeste({ tipo: 'sucesso', texto: `E-mail de teste enviado para ${para}.` });
    } catch (e) {
      setResultadoTeste({ tipo: 'erro', texto: mensagemErro(e) });
    } finally {
      setTestando(false);
      setVersaoHistorico((v) => v + 1);
    }
  }

  return (
    <div className="config-email">
      <Cartao titulo="Servidor de saída (SMTP)">
        <div className="config-grade">
          <Campo
            rotulo="Endereço do site"
            valor={form.enderecoSite}
            aoMudar={(enderecoSite) => mudar({ enderecoSite })}
          />
          <Campo
            rotulo="Servidor"
            valor={form.smtpServidor}
            aoMudar={(smtpServidor) => mudar({ smtpServidor })}
          />
          <Campo
            rotulo="Porta"
            tipo="number"
            valor={form.smtpPorta}
            aoMudar={(smtpPorta) => mudar({ smtpPorta })}
          />
          <Campo
            rotulo="Usuário"
            valor={form.smtpUsuario}
            aoMudar={(smtpUsuario) => mudar({ smtpUsuario })}
          />
          <div className="config-campo-com-ajuda">
            <Campo
              rotulo="Senha"
              tipo="password"
              valor={form.smtpSenha}
              aoMudar={(smtpSenha) => {
                mudar({ smtpSenha });
                setApagarSenha(false);
              }}
            />
            {config.smtpSenhaDefinida && !apagarSenha && (
              <>
                <p className="config-ajuda-campo">Deixe em branco para manter a senha atual.</p>
                <div>
                  <Botao
                    variante="texto"
                    aoClicar={() => {
                      mudar({ smtpSenha: '' });
                      setApagarSenha(true);
                    }}
                  >
                    Remover senha gravada
                  </Botao>
                </div>
              </>
            )}
            {apagarSenha && (
              <div className="config-remocao-senha">
                <p className="config-ajuda-campo">A senha gravada será removida ao salvar.</p>
                <div>
                  <Botao variante="texto" aoClicar={() => setApagarSenha(false)}>
                    Desfazer
                  </Botao>
                </div>
              </div>
            )}
          </div>
        </div>
        <p className="config-ajuda-campo">
          O endereço do site é usado nos links dos e-mails, por exemplo
          https://financas.exemplo.com.br
        </p>
        <Caixa
          rotulo="Conexão segura (TLS direto, porta 465)"
          marcado={form.smtpSeguro}
          aoMudar={(smtpSeguro) => mudar({ smtpSeguro })}
        />
        <div className="config-ajuda">
          <strong>Valores comuns</strong>
          <ul>
            <li>Porta 587: STARTTLS. Deixe "Conexão segura" desmarcado.</li>
            <li>Porta 465: TLS direto. Marque "Conexão segura".</li>
            <li>
              Contas com verificação em duas etapas costumam exigir uma "senha de aplicativo",
              e não a senha comum da conta.
            </li>
          </ul>
        </div>
      </Cartao>

      <Cartao titulo="Remetente">
        <div className="config-grade">
          <Campo
            rotulo="E-mail do remetente"
            tipo="email"
            valor={form.emailRemetente}
            aoMudar={(emailRemetente) => mudar({ emailRemetente })}
          />
          <Campo
            rotulo="Nome do remetente"
            valor={form.emailNomeRemetente}
            aoMudar={(emailNomeRemetente) => mudar({ emailNomeRemetente })}
          />
        </div>
      </Cartao>

      <Cartao titulo="Quando enviar">
        <div className="config-caixas">
          <Caixa
            rotulo="Envio de e-mails ligado"
            marcado={form.emailAtivo}
            aoMudar={(emailAtivo) => mudar({ emailAtivo })}
          />
          <p className="config-ajuda-campo">
            Com o envio desligado, nenhum e-mail sai, exceto o de teste.
          </p>
          <fieldset className="config-grupo">
            <legend>Tipos de e-mail</legend>
            <Caixa
              rotulo="Recuperação de senha"
              marcado={form.emailRecuperacao}
              aoMudar={(emailRecuperacao) => mudar({ emailRecuperacao })}
            />
            <Caixa
              rotulo="Boas-vindas a novos usuários"
              marcado={form.emailBoasVindas}
              aoMudar={(emailBoasVindas) => mudar({ emailBoasVindas })}
            />
          </fieldset>
        </div>
      </Cartao>

      {aviso && <Aviso tipo={aviso.tipo}>{aviso.texto}</Aviso>}
      <div className="pagina-acoes">
        <Botao desabilitado={ocupado} aoClicar={salvar}>
          {ocupado ? 'Salvando...' : 'Salvar'}
        </Botao>
      </div>

      <Cartao titulo="Enviar e-mail de teste">
        <p className="config-ajuda-campo">
          O teste usa a configuração salva. Salve as alterações antes de testar.
        </p>
        <div className="config-linha-teste">
          <Campo
            rotulo="Destinatário"
            tipo="email"
            valor={destinatario}
            aoMudar={setDestinatario}
          />
          <Botao
            variante="secundario"
            desabilitado={testando || destinatario.trim() === ''}
            aoClicar={testar}
          >
            {testando ? 'Enviando...' : 'Enviar e-mail de teste'}
          </Botao>
        </div>
        {resultadoTeste && <Aviso tipo={resultadoTeste.tipo}>{resultadoTeste.texto}</Aviso>}
      </Cartao>

      <Cartao titulo="Últimos envios">
        <HistoricoEmails versao={versaoHistorico} />
      </Cartao>
    </div>
  );
}
