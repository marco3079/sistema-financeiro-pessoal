import { useState } from 'react';
import type { FormEvent } from 'react';
import { api } from '../../lib/api';
import { mensagemErro } from '../../lib/financas';
import { Aviso, Botao, Campo, Caixa } from '../../ui';
import type { EstadoOpenFinanceDTO } from './Conexoes';

export function Credenciais({ estado, aoSalvo }: { estado: EstadoOpenFinanceDTO; aoSalvo: () => void }) {
  const jaTemSecret = estado.origemCredenciais === 'BANCO';
  const [clientId, setClientId] = useState(jaTemSecret ? (estado.clientId ?? '') : '');
  const [clientSecret, setClientSecret] = useState('');
  const [sandbox, setSandbox] = useState(estado.sandbox);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function salvar(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    setOcupado(true);
    try {
      const corpo: { clientId: string; clientSecret?: string; sandbox: boolean } = {
        clientId: clientId.trim(),
        sandbox,
      };
      if (clientSecret.trim() !== '') corpo.clientSecret = clientSecret.trim();
      await api.put('/openfinance/credenciais', corpo);
      setClientSecret('');
      aoSalvo();
    } catch (err) {
      setErro(mensagemErro(err));
    } finally {
      setOcupado(false);
    }
  }

  async function apagar() {
    if (!window.confirm('Apagar as credenciais da Pluggy? As conexões bancárias deixam de sincronizar.')) return;
    setErro(null);
    setOcupado(true);
    try {
      await api.del('/openfinance/credenciais');
      aoSalvo();
    } catch (err) {
      setErro(mensagemErro(err));
    } finally {
      setOcupado(false);
    }
  }

  return (
    <form onSubmit={salvar}>
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      <Campo rotulo="Client ID" valor={clientId} aoMudar={setClientId} obrigatorio />
      <Campo
        rotulo={jaTemSecret ? 'Client Secret (deixe vazio para manter o atual)' : 'Client Secret'}
        tipo="password"
        valor={clientSecret}
        aoMudar={setClientSecret}
        obrigatorio={!jaTemSecret}
      />
      <Caixa rotulo="Mostrar bancos de teste (sandbox da Pluggy)" marcado={sandbox} aoMudar={setSandbox} />
      <p className="fin-suave">O Client Secret é guardado cifrado no banco de dados e nunca volta para o navegador.</p>
      <div className="pagina-acoes">
        {jaTemSecret && (
          <Botao variante="perigo" desabilitado={ocupado} aoClicar={apagar}>
            Apagar credenciais
          </Botao>
        )}
        <Botao tipo="submit" desabilitado={ocupado}>
          Salvar
        </Botao>
      </div>
    </form>
  );
}
