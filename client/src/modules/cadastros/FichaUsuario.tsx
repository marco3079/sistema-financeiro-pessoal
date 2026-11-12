import { Link } from 'react-router-dom';
import { useDados } from '../../lib/useDados';
import { Aviso, Carregando, Selo, formatarData, formatarDataHora } from '../../ui';
import type { ListaLogDTO, LogDTO, ResumoUsuarioLogDTO, UsuarioDTO } from './tipos';
import { rotuloPerfil } from './tipos';
import {
  FichaCabecalho,
  FichaIndicador,
  FichaItem,
  FichaLinha,
  FichaModal,
  FichaSecao,
} from './FichaComum';
import './fichas.css';

// ---------- Rótulos e cores ----------

type CorSelo = 'verde' | 'amarelo' | 'vermelho' | 'azul' | 'cinza';

const ROTULO_TIPO_LOG: Record<string, { rotulo: string; cor: CorSelo }> = {
  LOGIN: { rotulo: 'Entrada', cor: 'verde' },
  FALHA_LOGIN: { rotulo: 'Falha de login', cor: 'vermelho' },
  SAIDA: { rotulo: 'Saída', cor: 'cinza' },
  TELA: { rotulo: 'Tela', cor: 'azul' },
  CONSULTA: { rotulo: 'Consulta', cor: 'cinza' },
  CRIACAO: { rotulo: 'Criação', cor: 'verde' },
  ALTERACAO: { rotulo: 'Alteração', cor: 'amarelo' },
  EXCLUSAO: { rotulo: 'Exclusão', cor: 'vermelho' },
};

function SeloTipoLog({ tipo }: { tipo: string }) {
  const info = ROTULO_TIPO_LOG[tipo];
  return <Selo cor={info?.cor ?? 'cinza'}>{info?.rotulo ?? tipo}</Selo>;
}

// Selo do perfil.
export function SeloPerfilUsuario({ perfil }: { perfil: string }) {
  const rotulo = rotuloPerfil(perfil);
  if (perfil === 'TITULAR') return <Selo cor="azul">{rotulo}</Selo>;
  return <Selo cor="cinza">{rotulo}</Selo>;
}

// ---------- Seções ----------

function Indicadores({ resumo }: { resumo: ResumoUsuarioLogDTO }) {
  return (
    <div className="ficha-indicadores">
      <FichaIndicador
        icone="atividade"
        cor="azul"
        valor={resumo.atividadesHoje}
        rotulo="Atividades hoje"
      />
      <FichaIndicador
        icone="grafico"
        cor="roxo"
        valor={resumo.atividades7Dias}
        rotulo="Atividades em 7 dias"
      />
      <FichaIndicador
        icone="relogio"
        cor="verde"
        valor={resumo.ultimoLogin ? formatarDataHora(resumo.ultimoLogin) : 'Nunca'}
        rotulo="Último acesso"
      />
      <FichaIndicador
        icone="perfil"
        cor="laranja"
        valor={
          resumo.online ? (
            <span className="usuario-online">
              {resumo.telaAtual ? `Online: ${resumo.telaAtual}` : 'Online'}
            </span>
          ) : (
            'Offline'
          )
        }
        rotulo="Agora"
      />
    </div>
  );
}

function AtividadePorTipo({ resumo }: { resumo: ResumoUsuarioLogDTO }) {
  const maior = Math.max(1, ...resumo.porTipo.map((t) => t.total));
  return (
    <FichaSecao titulo="Atividade por tipo" icone="grafico">
      {resumo.porTipo.length === 0 && (
        <p className="ficha-vazio">Sem atividade nos últimos 7 dias.</p>
      )}
      {resumo.porTipo.map((t) => (
        <div key={t.tipo} className="usuario-barra-linha">
          <span className="usuario-barra-rotulo">
            <SeloTipoLog tipo={t.tipo} />
          </span>
          <span className="usuario-barra" aria-hidden="true">
            <span className="usuario-barra-preench" style={{ width: `${(t.total / maior) * 100}%` }} />
          </span>
          <span className="usuario-barra-total">{t.total}</span>
        </div>
      ))}
    </FichaSecao>
  );
}

function UltimasAtividades({ logs }: { logs: LogDTO[] }) {
  return (
    <FichaSecao titulo="Últimas atividades" icone="atividade">
      {logs.length === 0 && <p className="ficha-vazio">Sem atividade registrada.</p>}
      {logs.map((l) => (
        <FichaItem key={l.id} titulo={l.descricao} selo={<SeloTipoLog tipo={l.tipo} />}>
          {formatarDataHora(l.criadoEm)} · {l.modulo}
        </FichaItem>
      ))}
      <Link className="ficha-mais" to="/app/logs">
        Ver no log do sistema
      </Link>
    </FichaSecao>
  );
}

// ---------- Ficha ----------

function Conteudo({
  usuario,
  aoEditar,
}: {
  usuario: UsuarioDTO;
  aoEditar: () => void;
}) {
  const resumo = useDados<ResumoUsuarioLogDTO>(`/logs/usuarios/${usuario.id}/resumo`);
  const logs = useDados<ListaLogDTO>(`/logs?usuarioId=${usuario.id}&limite=20`);

  return (
    <>
      <FichaCabecalho
        nome={usuario.nome}
        subtitulo={usuario.email}
        detalhe={`Perfil: ${rotuloPerfil(usuario.perfil)}`}
        ativo={usuario.ativo}
        aoEditar={aoEditar}
      />

      {resumo.erro && <Aviso tipo="erro">{resumo.erro}</Aviso>}
      {resumo.carregando && !resumo.dados && <Carregando />}
      {resumo.dados && <Indicadores resumo={resumo.dados} />}

      <div className="ficha-colunas">
        <div className="ficha-coluna">
          <FichaSecao titulo="Dados" icone="perfil">
            <FichaLinha rotulo="E-mail" valor={usuario.email} />
            <FichaLinha rotulo="Telefone" valor={usuario.telefone} />
            {usuario.cpf && <FichaLinha rotulo="CPF" valor={usuario.cpf} />}
            <FichaLinha rotulo="Cadastrado em" valor={formatarData(usuario.criadoEm)} />
            <FichaLinha rotulo="Perfil" valor={<SeloPerfilUsuario perfil={usuario.perfil} />} />
          </FichaSecao>

          {resumo.dados && <AtividadePorTipo resumo={resumo.dados} />}
        </div>

        <div className="ficha-coluna">
          {logs.erro && <Aviso tipo="erro">{logs.erro}</Aviso>}
          {logs.carregando && !logs.dados && <Carregando />}
          {logs.dados && <UltimasAtividades logs={logs.dados.itens} />}
        </div>
      </div>
    </>
  );
}

export function FichaUsuario({
  usuario,
  aoFechar,
  aoEditar,
}: {
  usuario: UsuarioDTO;
  aoFechar: () => void;
  aoEditar: () => void;
}) {
  return (
    <FichaModal aberto titulo="Ficha do usuário" aoFechar={aoFechar}>
      <Conteudo usuario={usuario} aoEditar={aoEditar} />
    </FichaModal>
  );
}
