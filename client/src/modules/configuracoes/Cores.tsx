import { useEffect, useState } from 'react';
import { PLATAFORMA_PADRAO } from '../../lib/plataforma';
import { Aviso, Botao } from '../../ui';
import { mensagemErro } from '../cadastros/tipos';
import { COMBINACOES_CORES, REGEX_COR } from './tipos';
import type { IdentidadeDados } from './tipos';

export function Cores({
  valor,
  aoMudar,
  aoSalvar,
}: {
  valor: IdentidadeDados;
  aoMudar: (parcial: Partial<IdentidadeDados>) => void;
  aoSalvar: (dados: IdentidadeDados) => Promise<void>;
}) {
  const [aviso, setAviso] = useState<{ tipo: 'erro' | 'sucesso'; texto: string } | null>(null);
  const [ocupado, setOcupado] = useState(false);

  function restaurar() {
    setAviso(null);
    aoMudar({
      corPrimaria: PLATAFORMA_PADRAO.corPrimaria,
      corSecundaria: PLATAFORMA_PADRAO.corSecundaria,
    });
  }

  async function salvar() {
    setAviso(null);
    if (!REGEX_COR.test(valor.corPrimaria) || !REGEX_COR.test(valor.corSecundaria)) {
      setAviso({ tipo: 'erro', texto: 'Use cores no formato #rrggbb.' });
      return;
    }
    setOcupado(true);
    try {
      await aoSalvar(valor);
      setAviso({ tipo: 'sucesso', texto: 'Cores salvas.' });
    } catch (e) {
      setAviso({ tipo: 'erro', texto: mensagemErro(e) });
    } finally {
      setOcupado(false);
    }
  }

  return (
    <div className="config-cores">
      <div className="config-predefinidas" role="group" aria-label="Combinações prontas">
        {COMBINACOES_CORES.map((c) => {
          const ativa =
            c.corPrimaria === valor.corPrimaria && c.corSecundaria === valor.corSecundaria;
          return (
            <button
              key={c.nome}
              type="button"
              className={ativa ? 'config-predefinida config-predefinida-ativa' : 'config-predefinida'}
              aria-pressed={ativa}
              aria-label={`Combinação ${c.nome}`}
              title={c.nome}
              onClick={() =>
                aoMudar({ corPrimaria: c.corPrimaria, corSecundaria: c.corSecundaria })
              }
            >
              <span
                className="config-predefinida-amostra"
                style={{
                  background: `linear-gradient(135deg, ${c.corPrimaria}, ${c.corSecundaria})`,
                }}
              />
              <span className="config-predefinida-nome">{c.nome}</span>
            </button>
          );
        })}
      </div>

      <div className="config-cores-campos">
        <CampoCor
          rotulo="Cor primária"
          valor={valor.corPrimaria}
          aoMudar={(corPrimaria) => aoMudar({ corPrimaria })}
        />
        <CampoCor
          rotulo="Cor secundária"
          valor={valor.corSecundaria}
          aoMudar={(corSecundaria) => aoMudar({ corSecundaria })}
        />
      </div>

      <div className="config-previa-cores" aria-label="Prévia das cores">
        <span className="config-previa-rotulo">Prévia</span>
        <div className="config-faixa-gradiente" />
        <div className="config-previa-linha">
          <Botao>Botão principal</Botao>
          <Botao variante="secundario">Botão secundário</Botao>
          <span className="config-selo-primaria">Selo</span>
          <a
            href="#"
            className="config-link-primaria"
            onClick={(e) => e.preventDefault()}
          >
            Link de exemplo
          </a>
        </div>
      </div>

      {aviso && <Aviso tipo={aviso.tipo}>{aviso.texto}</Aviso>}
      <div className="pagina-acoes">
        <Botao variante="texto" aoClicar={restaurar}>
          Restaurar padrão
        </Botao>
        <Botao desabilitado={ocupado} aoClicar={salvar}>
          {ocupado ? 'Salvando...' : 'Salvar'}
        </Botao>
      </div>
    </div>
  );
}

// Seletor de cor (input color) e campo de texto com o código; o texto só vale quando tem o formato certo.
function CampoCor({
  rotulo,
  valor,
  aoMudar,
}: {
  rotulo: string;
  valor: string;
  aoMudar: (cor: string) => void;
}) {
  const [texto, setTexto] = useState(valor);

  useEffect(() => {
    setTexto(valor);
  }, [valor]);

  const invalido = !REGEX_COR.test(texto);

  function digitar(novo: string) {
    setTexto(novo);
    if (REGEX_COR.test(novo)) {
      aoMudar(novo.toLowerCase());
    }
  }

  return (
    <div className="config-cor">
      <span className="campo-rotulo">{rotulo}</span>
      <div className="config-cor-controles">
        <input
          type="color"
          className="config-cor-seletor"
          value={valor}
          aria-label={rotulo}
          onChange={(e) => aoMudar(e.target.value.toLowerCase())}
        />
        <input
          type="text"
          className="campo-controle config-cor-texto"
          value={texto}
          maxLength={7}
          aria-label={`${rotulo}, código da cor`}
          onChange={(e) => digitar(e.target.value)}
        />
      </div>
      {invalido && <span className="config-erro-suave">Use o formato #rrggbb.</span>}
    </div>
  );
}
