import type { ReactNode } from 'react';

export type NomeIcone =
  | 'inicio' | 'alunos' | 'professores' | 'usuarios' | 'cursos' | 'periodos' | 'turmas'
  | 'matriculas' | 'diario' | 'boletim' | 'historico' | 'pos' | 'financeiro' | 'biblioteca'
  | 'horarios' | 'calendario' | 'comunicados' | 'perfil' | 'menu' | 'mais' | 'sair' | 'fechar'
  | 'busca' | 'sino' | 'seta-direita' | 'seta-cima' | 'seta-baixo' | 'chevron-baixo'
  | 'relogio' | 'raio' | 'grafico' | 'engrenagem' | 'documento' | 'lapis'
  | 'atividade' | 'log' | 'grade' | 'lista' | 'imagem' | 'pausar' | 'reproduzir'
  | 'medalha' | 'suporte' | 'forum' | 'voto-cima' | 'voto-baixo' | 'comentario'
  | 'anexo' | 'estrela' | 'enviar' | 'fixar' | 'cadeado' | 'sol' | 'lua' | 'monitor'
  | 'chat' | 'email' | 'paleta' | 'visto' | 'visto-duplo' | 'responder' | 'lixeira' | 'grupo'
  | 'mais-circulo' | 'seta-esquerda' | 'pedidos' | 'mesas' | 'cardapio' | 'menos' | 'somar'
  | 'contas' | 'cartao' | 'transacoes' | 'investimentos' | 'orcamento' | 'metas' | 'conexoes' | 'categorias'
  | 'sincronizar' | 'importar';

export const NOMES_ICONES: NomeIcone[] = [
  'inicio', 'alunos', 'professores', 'usuarios', 'cursos', 'periodos', 'turmas',
  'matriculas', 'diario', 'boletim', 'historico', 'pos', 'financeiro', 'biblioteca',
  'horarios', 'calendario', 'comunicados', 'perfil', 'menu', 'mais', 'sair', 'fechar',
  'busca', 'sino', 'seta-direita', 'seta-cima', 'seta-baixo', 'chevron-baixo',
  'relogio', 'raio', 'grafico', 'engrenagem', 'documento', 'lapis',
  'atividade', 'log', 'grade', 'lista', 'imagem', 'pausar', 'reproduzir',
  'medalha', 'suporte', 'forum', 'voto-cima', 'voto-baixo', 'comentario',
  'anexo', 'estrela', 'enviar', 'fixar', 'cadeado', 'sol', 'lua', 'monitor',
  'chat', 'email', 'paleta', 'visto', 'visto-duplo', 'responder', 'lixeira', 'grupo',
  'mais-circulo', 'seta-esquerda', 'pedidos', 'mesas', 'cardapio', 'menos', 'somar',
  'contas', 'cartao', 'transacoes', 'investimentos', 'orcamento', 'metas', 'conexoes', 'categorias',
  'sincronizar', 'importar',
];

// Desenhos sólidos em grade 24 x 24 (área útil 2.5 a 21.5). Preenchidos com currentColor.
// Recortes internos: subcaminhos dentro do mesmo <path> com fillRule="evenodd".
// Ícones de linha pura (menu, fechar, busca, setas, chevron) usam traço no próprio elemento.
const DESENHOS: Record<NomeIcone, ReactNode> = {
  // Importar: seta para cima saindo de uma bandeja.
  importar: (
    <>
      <path d="M12 2.5L18 8.8H13.6V15.5H10.4V8.8H6Z" />
      <path d="M3 13.5H5.4V19.1H18.6V13.5H21V21.5H3Z" />
    </>
  ),

  // Banco: frontão, três colunas e a base.
  contas: (
    <>
      <path d="M12 2.5L21.5 8V10H2.5V8Z" />
      <path d="M4.5 11.5H7.5V17.5H4.5ZM10.5 11.5H13.5V17.5H10.5ZM16.5 11.5H19.5V17.5H16.5Z" />
      <path d="M2.5 19H21.5V21.5H2.5Z" />
    </>
  ),

  // Cartão de crédito: tarja recortada e um campo recortado embaixo.
  cartao: (
    <path
      fillRule="evenodd"
      clipRule="evenodd"
      d="M4.5 5H19.5Q21.5 5 21.5 7V17Q21.5 19 19.5 19H4.5Q2.5 19 2.5 17V7Q2.5 5 4.5 5ZM2.5 8.6V10.9H21.5V8.6ZM5.5 14V15.8H10.5V14Z"
    />
  ),

  // Lançamentos: seta para a direita em cima e para a esquerda embaixo.
  transacoes: (
    <>
      <path d="M3 6.8H15V3.5L21 8L15 12.5V9.2H3Z" />
      <path d="M21 14.8H9V11.5L3 16L9 20.5V17.2H21Z" />
    </>
  ),

  // Investimentos: linha subindo com seta, sobre a base.
  investimentos: (
    <>
      <path d="M3 15.5L8.5 10L12.5 14L18 8.5L16 6.5H21.5V12L19.5 10L12.5 17L8.5 13L4.5 17Z" />
      <path d="M2.5 19.5H21.5V21.5H2.5Z" />
    </>
  ),

  // Orçamento: pizza com uma fatia destacada.
  orcamento: (
    <>
      <path d="M11 3.6V13H20.4A8.5 8.5 0 1 1 11 3.6Z" />
      <path d="M13 2.5A8.5 8.5 0 0 1 21.5 11H13Z" />
    </>
  ),

  // Metas: alvo com anel externo e centro.
  metas: (
    <path
      fillRule="evenodd"
      clipRule="evenodd"
      d="M2.5 12A9.5 9.5 0 1 0 21.5 12A9.5 9.5 0 1 0 2.5 12ZM5.5 12A6.5 6.5 0 1 0 18.5 12A6.5 6.5 0 1 0 5.5 12ZM8.5 12A3.5 3.5 0 1 0 15.5 12A3.5 3.5 0 1 0 8.5 12Z"
    />
  ),

  // Conexões (Open Finance): tomada com dois pinos e o cabo.
  conexoes: (
    <path d="M8 2.5H10V7H14V2.5H16V7H18V11C18 14 16 16.3 13.2 16.9V21.5H10.8V16.9C8 16.3 6 14 6 11V7H8Z" />
  ),

  // Categorias: etiqueta com o furo recortado.
  categorias: (
    <path
      fillRule="evenodd"
      clipRule="evenodd"
      d="M3 3H12L21.5 12.5L12.5 21.5L3 12ZM7.5 6A1.5 1.5 0 1 0 7.5 9A1.5 1.5 0 1 0 7.5 6Z"
    />
  ),

  // Sincronizar: duas setas em círculo (traço puro).
  sincronizar: (
    <path
      d="M19.5 9A8 8 0 0 0 5 8.5M4.5 15A8 8 0 0 0 19 15.5M19.5 4.5V9H15M4.5 19.5V15H9"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.2}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  ),

  // Comanda: folha com o topo picotado e três linhas recortadas.
  pedidos: (
    <path
      fillRule="evenodd"
      clipRule="evenodd"
      d="M5 2.5H19V21.5L16.7 19.8L14.3 21.5L12 19.8L9.7 21.5L7.3 19.8L5 21.5ZM8 6.5V8.3H16V6.5ZM8 10.3V12.1H16V10.3ZM8 14.1V15.9H13V14.1Z"
    />
  ),

  // Mesa vista de frente: tampo, coluna e base, com duas cadeiras ao lado.
  mesas: (
    <>
      <path d="M6 8H18V10.2H13.1V18.3H16V20.5H8V18.3H10.9V10.2H6Z" />
      <path d="M2.5 6.5H4.3V13H7V14.8H4.3V20.5H2.5Z" />
      <path d="M21.5 6.5H19.7V13H17V14.8H19.7V20.5H21.5Z" />
    </>
  ),

  // Garfo e faca.
  cardapio: (
    <>
      <path d="M5 2.5H6.4V8H7.8V2.5H9.2V8H10.6V2.5H12V9.2C12 10.6 11.2 11.6 10 12V21.5H7V12C5.8 11.6 5 10.6 5 9.2Z" />
      <path d="M15 21.5V2.5C17.8 3.6 19.5 6.6 19.5 10.5V14H17.8V21.5Z" />
    </>
  ),

  // Traço horizontal (diminuir quantidade).
  menos: <path d="M5 10.8H19V13.2H5Z" />,

  // Sinal de mais (aumentar quantidade, adicionar item).
  somar: <path d="M10.8 5H13.2V10.8H19V13.2H13.2V19H10.8V13.2H5V10.8H10.8Z" />,

  // Casa sólida com a porta recortada na base.
  inicio: <path d="M12 3L21.5 11H19V21H14V15.5H10V21H5V11H2.5Z" />,

  // Pessoa com capelo pequeno sobre a cabeça e borla do lado direito.
  alunos: (
    <>
      <circle cx="12" cy="12.5" r="3" />
      <path d="M5 21.5C5 18.2 8 16.4 12 16.4C16 16.4 19 18.2 19 21.5Z" />
      <path d="M12 2.8L18.2 5.6L12 8.4L5.8 5.6ZM17.6 6.2L18.6 5.8V10.2H17.6Z" />
    </>
  ),

  // Pessoa ao lado de um quadro sólido (moldura recortada) sobre um cavalete.
  professores: (
    <>
      <circle cx="8" cy="8.5" r="3.5" />
      <path d="M2.5 21.5C2.5 16.6 4.8 13.6 8 13.6C11.2 13.6 13.5 16.6 13.5 21.5Z" />
      <path fillRule="evenodd" clipRule="evenodd" d="M15 4H21.5V12H15ZM16.6 5.6V10.4H19.9V5.6Z" />
      <path d="M17.2 12H18.8V20.5H20.5V21.5H15.5V20.5H17.2Z" />
    </>
  ),

  // Chave: argola recortada à esquerda, haste com dois dentes à direita.
  usuarios: (
    <>
      <path fillRule="evenodd" clipRule="evenodd" d="M2.7 12A4.8 4.8 0 1 0 12.3 12A4.8 4.8 0 1 0 2.7 12ZM5.3 12A2.2 2.2 0 1 0 9.7 12A2.2 2.2 0 1 0 5.3 12Z" />
      <path d="M11.5 10.6H21.5V15.8H19.6V13.4H18.7V15.8H16.8V13.4H11.5Z" />
    </>
  ),

  // Prédio escolar: frontão sólido com janela redonda recortada e fachada com porta.
  cursos: (
    <>
      <path fillRule="evenodd" clipRule="evenodd" d="M12 3.5L21.5 9.5H2.5ZM12 6.3A1.2 1.2 0 1 0 12 8.7A1.2 1.2 0 1 0 12 6.3Z" />
      <path d="M4.5 9.5H19.5V21.5H14V16H10V21.5H4.5Z" />
    </>
  ),

  // Calendário sólido com argolas no topo e um intervalo marcado por barra recortada.
  periodos: (
    <>
      <path fillRule="evenodd" clipRule="evenodd" d="M5.5 4.5H18.5Q21 4.5 21 7V19Q21 21.5 18.5 21.5H5.5Q3 21.5 3 19V7Q3 4.5 5.5 4.5ZM7 12.5H17V14.5H7Z" />
      <path d="M7.5 2.5H9.5V6.5H7.5ZM14.5 2.5H16.5V6.5H14.5Z" />
    </>
  ),

  // Grupo: pessoa na frente e outra menor atrás, à direita.
  turmas: (
    <>
      <circle cx="8.5" cy="8" r="3.5" />
      <path d="M2.5 21.5C2.5 16.6 5 13.2 8.5 13.2C12 13.2 14.5 16.6 14.5 21.5Z" />
      <circle cx="16.8" cy="6.8" r="2.9" />
      <path d="M15.6 21.5C15.6 16.2 17.2 11.2 19 11.2C20.8 11.2 21.5 16 21.5 21.5Z" />
    </>
  ),

  // Folha sólida com duas linhas recortadas e um lápis na diagonal no canto inferior direito.
  matriculas: (
    <>
      <path fillRule="evenodd" clipRule="evenodd" d="M3 2.5H11.5V21.5H3ZM5.8 7.5H10V9.1H5.8ZM5.8 11H10V12.6H5.8Z" />
      <path d="M12.5 21.5L15.82 20.58L21.4 15L19 12.6L13.42 18.18Z" />
    </>
  ),

  // Caderno sólido com lombada separada por fenda vertical e duas linhas recortadas.
  diario: (
    <path fillRule="evenodd" clipRule="evenodd" d="M7.5 2.5H18Q20.5 2.5 20.5 5V19Q20.5 21.5 18 21.5H7.5Q5 21.5 5 19V5Q5 2.5 7.5 2.5ZM8.2 2.5H9.2V21.5H8.2ZM11.5 8H16.5V9.6H11.5ZM11.5 11.8H16.5V13.4H11.5Z" />
  ),

  // Três barras sólidas de alturas diferentes.
  boletim: <path d="M4 12H7.6V21.5H4ZM10.2 7H13.8V21.5H10.2ZM16.4 10H20V21.5H16.4Z" />,

  // Documento com canto superior direito dobrado e três linhas recortadas.
  historico: (
    <path fillRule="evenodd" clipRule="evenodd" d="M6.5 2.5H13.8L19.5 8.2V19.5Q19.5 21.5 17.5 21.5H6.5Q4.5 21.5 4.5 19.5V4.5Q4.5 2.5 6.5 2.5ZM13.8 2.5V8.2H19.5ZM8.5 12H15.5V13.6H8.5ZM8.5 15.4H15.5V17H8.5ZM8.5 18.8H12.5V20.4H8.5Z" />
  ),

  // Erlenmeyer sólido com gargalo, lábio e faixa de nível recortada.
  pos: (
    <path fillRule="evenodd" clipRule="evenodd" d="M8.5 2.5H15.5V4H14.5V9.2L19.8 18.6Q21 21 18.5 21H5.5Q3 21 4.2 18.6L9.5 9.2V4H8.5ZM7.8 14.2H16.2V15.5H7.8Z" />
  ),

  // Moeda: anel sólido com um cifrão sólido no centro.
  financeiro: (
    <>
      <path fillRule="evenodd" clipRule="evenodd" d="M3 12A9 9 0 1 0 21 12A9 9 0 1 0 3 12ZM4.8 12A7.2 7.2 0 1 0 19.2 12A7.2 7.2 0 1 0 4.8 12Z" />
      <path d="M9.5 7.6H14.5V9.3H9.5ZM9.5 9.3H11.2V12.2H9.5ZM9.5 12.2H14.5V13.9H9.5ZM12.8 13.9H14.5V14.7H12.8ZM9.5 14.7H14.5V16.4H9.5ZM11.6 5.4H12.4V7.6H11.6ZM11.6 16.4H12.4V18.6H11.6Z" />
    </>
  ),

  // Livro aberto sólido, com a lombada central recortada entre as duas páginas.
  biblioteca: (
    <path d="M11.2 6.6C8.6 5.2 5.6 4.8 2.5 5.6V18.4C5.6 17.6 8.6 18 11.2 19.4ZM12.8 6.6C15.4 5.2 18.4 4.8 21.5 5.6V18.4C18.4 17.6 15.4 18 12.8 19.4Z" />
  ),

  // Relógio em anel sólido com ponteiros sólidos (um para cima, um para a direita).
  horarios: (
    <>
      <path fillRule="evenodd" clipRule="evenodd" d="M3 12A9 9 0 1 0 21 12A9 9 0 1 0 3 12ZM4.8 12A7.2 7.2 0 1 0 19.2 12A7.2 7.2 0 1 0 4.8 12Z" />
      <path d="M11 6H13V11H16.5V13H11Z" />
    </>
  ),

  // Calendário sólido com cabeçalho separado por fenda, quatro dias recortados e argolas.
  calendario: (
    <>
      <path fillRule="evenodd" clipRule="evenodd" d="M5.5 4.5H18.5Q21 4.5 21 7V19Q21 21.5 18.5 21.5H5.5Q3 21.5 3 19V7Q3 4.5 5.5 4.5ZM3 9.2H21V10.4H3ZM7 13.1A1 1 0 1 0 9 13.1A1 1 0 1 0 7 13.1ZM14.6 13.1A1 1 0 1 0 16.6 13.1A1 1 0 1 0 14.6 13.1ZM7 17.1A1 1 0 1 0 9 17.1A1 1 0 1 0 7 17.1ZM14.6 17.1A1 1 0 1 0 16.6 17.1A1 1 0 1 0 14.6 17.1Z" />
      <path d="M7.5 2.5H9.5V6.5H7.5ZM14.5 2.5H16.5V6.5H14.5Z" />
    </>
  ),

  // Megafone sólido: cone que abre para a direita, com o cabo embaixo.
  comunicados: (
    <>
      <path d="M3.5 9.5H8L19.5 4.5V19.5L8 14.5H3.5Z" />
      <path d="M7.5 14.5H10L11.4 20.5H9.1Z" />
    </>
  ),

  // Pessoa recortada dentro de um disco sólido.
  perfil: (
    <path fillRule="evenodd" clipRule="evenodd" d="M2.5 12A9.5 9.5 0 1 0 21.5 12A9.5 9.5 0 1 0 2.5 12ZM9 9.2A3 3 0 1 0 15 9.2A3 3 0 1 0 9 9.2ZM6.2 18.2C6.8 15.4 9 14.2 12 14.2C15 14.2 17.2 15.4 17.8 18.2Z" />
  ),

  // Três linhas horizontais (traço puro).
  menu: <path d="M4 6H20M4 12H20M4 18H20" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" />,

  // Três pontos sólidos em linha horizontal.
  mais: (
    <>
      <circle cx="5" cy="12" r="2.2" />
      <circle cx="12" cy="12" r="2.2" />
      <circle cx="19" cy="12" r="2.2" />
    </>
  ),

  // Colchete de porta sólido à esquerda com seta sólida saindo para a direita.
  sair: (
    <>
      <path d="M2.5 3.5H10V6.5H5.8V17.5H10V20.5H2.5Z" />
      <path d="M9 10.6H16.5V7.5L21.5 12L16.5 16.5V13.4H9Z" />
    </>
  ),

  // X: duas diagonais cruzadas (traço puro).
  fechar: <path d="M6 6L18 18M18 6L6 18" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" />,

  // Lupa: aro e cabo na diagonal (traço puro).
  busca: (
    <>
      <circle cx="10.5" cy="10.5" r="6.5" fill="none" stroke="currentColor" strokeWidth={2.2} />
      <path d="M15.5 15.5L20.5 20.5" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" />
    </>
  ),

  // Sino sólido com o badalo embaixo.
  sino: (
    <>
      <path d="M12 2.8C8.4 2.8 6.4 5.5 6.4 9V13.6L4.4 16.4V17.6H19.6V16.4L17.6 13.6V9C17.6 5.5 15.6 2.8 12 2.8Z" />
      <path d="M10.2 18.6H13.8C13.8 19.6 13 20.5 12 20.5C11 20.5 10.2 19.6 10.2 18.6Z" />
    </>
  ),

  // Seta para a direita (traço puro com ponta).
  'seta-direita': <path d="M4.5 12H19.5M13.5 6L19.5 12L13.5 18" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />,

  // Seta para cima (traço puro com ponta).
  'seta-cima': <path d="M12 19.5V4.5M6 10.5L12 4.5L18 10.5" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />,

  // Seta para baixo (traço puro com ponta).
  'seta-baixo': <path d="M12 4.5V19.5M6 13.5L12 19.5L18 13.5" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />,

  // "V" aberto para baixo (traço puro).
  'chevron-baixo': <path d="M6 9.5L12 15.5L18 9.5" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />,

  // Cronômetro sólido com coroa no topo e ponteiros recortados.
  relogio: (
    <>
      <path fillRule="evenodd" clipRule="evenodd" d="M3 12A9 9 0 1 0 21 12A9 9 0 1 0 3 12ZM11 6.5H13V11H16.5V13H11Z" />
      <path d="M10.5 2.5H13.5V4.2H10.5Z" />
    </>
  ),

  // Raio sólido em zigue-zague.
  raio: <path d="M13.5 2.5L4.5 13.5H11L9.5 21.5L19.5 9.8H13Z" />,

  // Três barras sólidas crescentes com uma ponta de seta sólida no canto superior direito.
  grafico: (
    <path d="M3.5 14H8.2V21.5H3.5ZM9.9 11H14.6V21.5H9.9ZM16.3 8H21V21.5H16.3ZM14.5 2.5H21.5V9.5Z" />
  ),

  // Engrenagem de oito dentes sólidos com o furo central recortado.
  engrenagem: (
    <path fillRule="evenodd" clipRule="evenodd" d="M10.31 5.21L10.51 2.62L13.49 2.62L13.69 5.21L15.61 6L17.58 4.31L19.69 6.42L18 8.4L18.79 10.31L21.38 10.51L21.38 13.49L18.79 13.69L18 15.61L19.69 17.58L17.58 19.69L15.61 18L13.69 18.79L13.49 21.38L10.51 21.38L10.31 18.79L8.4 18L6.42 19.69L4.31 17.58L6 15.61L5.21 13.69L2.62 13.49L2.62 10.51L5.21 10.31L6 8.4L4.31 6.42L6.42 4.31L8.4 6ZM9 12A3 3 0 1 0 15 12A3 3 0 1 0 9 12Z" />
  ),

  // Folha sólida com canto inferior direito dobrado e duas linhas recortadas.
  documento: (
    <path fillRule="evenodd" clipRule="evenodd" d="M4.5 2.5H19.5V15.5L14.5 21.5H4.5ZM14.5 15.5H19.5L14.5 21.5ZM8 7H16V8.8H8ZM8 11.2H16V13H8Z" />
  ),

  // Lápis sólido na diagonal, ponta para baixo à esquerda, com a virola recortada.
  lapis: (
    <path fillRule="evenodd" clipRule="evenodd" d="M3.5 20.5L8.24 18.88L21.06 6.06L17.94 2.94L5.12 15.76ZM14.21 6.67L17.33 9.79L17.96 9.16L14.84 6.04Z" />
  ),

  // Linha de pulso (traço grosso, como um eletrocardiograma).
  atividade: <path d="M2.5 12H7L9.5 6.5L13 17.5L15.5 12H21.5" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />,

  // Folha sólida com três linhas recortadas e um ponto recortado à esquerda de cada linha.
  log: (
    <path fillRule="evenodd" clipRule="evenodd" d="M4.5 2.5H19.5V21.5H4.5ZM6.4 8A1.1 1.1 0 1 0 8.6 8A1.1 1.1 0 1 0 6.4 8ZM10 7.2H16.5V8.8H10ZM6.4 12A1.1 1.1 0 1 0 8.6 12A1.1 1.1 0 1 0 6.4 12ZM10 11.2H16.5V12.8H10ZM6.4 16A1.1 1.1 0 1 0 8.6 16A1.1 1.1 0 1 0 6.4 16ZM10 15.2H16.5V16.8H10Z" />
  ),

  // Quatro quadrados arredondados sólidos em 2 x 2.
  grade: (
    <path d="M4.5 2.5H9Q11 2.5 11 4.5V9Q11 11 9 11H4.5Q2.5 11 2.5 9V4.5Q2.5 2.5 4.5 2.5ZM15 2.5H19.5Q21.5 2.5 21.5 4.5V9Q21.5 11 19.5 11H15Q13 11 13 9V4.5Q13 2.5 15 2.5ZM4.5 13H9Q11 13 11 15V19.5Q11 21.5 9 21.5H4.5Q2.5 21.5 2.5 19.5V15Q2.5 13 4.5 13ZM15 13H19.5Q21.5 13 21.5 15V19.5Q21.5 21.5 19.5 21.5H15Q13 21.5 13 19.5V15Q13 13 15 13Z" />
  ),

  // Três barras sólidas horizontais, cada uma com um ponto sólido à esquerda.
  lista: (
    <path d="M2.5 6A2 2 0 1 0 6.5 6A2 2 0 1 0 2.5 6ZM9 4.5H21V7.5H9ZM2.5 12A2 2 0 1 0 6.5 12A2 2 0 1 0 2.5 12ZM9 10.5H21V13.5H9ZM2.5 18A2 2 0 1 0 6.5 18A2 2 0 1 0 2.5 18ZM9 16.5H21V19.5H9Z" />
  ),

  // Moldura sólida com uma montanha e um sol recortados.
  imagem: (
    <path fillRule="evenodd" clipRule="evenodd" d="M2.5 4H21.5V20H2.5ZM14.5 9A2 2 0 1 0 18.5 9A2 2 0 1 0 14.5 9ZM4.5 17L9.5 11.5L12.5 14.5L14.5 12.5L19.5 17Z" />
  ),

  // Duas barras verticais sólidas.
  pausar: <path d="M6 4H10V20H6ZM14 4H18V20H14Z" />,

  // Triângulo sólido apontando para a direita.
  reproduzir: <path d="M7 4.5L19.5 12L7 19.5Z" />,

  // Círculo sólido com estrela recortada e duas fitas embaixo.
  medalha: (
    <>
      <path fillRule="evenodd" clipRule="evenodd" d="M5.5 9A6.5 6.5 0 1 0 18.5 9A6.5 6.5 0 1 0 5.5 9ZM12 5.4L12.88 7.79L15.42 7.89L13.43 9.46L14.12 11.91L12 10.5L9.88 11.91L10.57 9.46L8.58 7.89L11.12 7.79Z" />
      <path d="M7 13.8H10.4L9.5 21.5L8.7 20.3L7.8 21.5ZM17 13.8H13.6L14.5 21.5L15.3 20.3L16.2 21.5Z" />
    </>
  ),

  // Balão de conversa sólido com um ponto de interrogação recortado.
  suporte: (
    <path fillRule="evenodd" clipRule="evenodd" d="M5.5 3H18.5Q21 3 21 5.5V14Q21 16.5 18.5 16.5H10.5L6.5 20.5V16.5H5.5Q3 16.5 3 14V5.5Q3 3 5.5 3ZM9.7 8.4A2.3 2.3 0 1 1 12 10.7L12 9.5A0.9 0.9 0 1 0 11.1 8.4ZM11.3 10.9H12.7V12.9H11.3ZM11.1 14.6A0.9 0.9 0 1 0 12.9 14.6A0.9 0.9 0 1 0 11.1 14.6Z" />
  ),

  // Dois balões de conversa sólidos sobrepostos.
  forum: (
    <path d="M10.5 2.5H19Q21.5 2.5 21.5 5V10Q21.5 12.5 19 12.5H17.5L15.5 14.5V12.5H10.5Q8 12.5 8 10V5Q8 2.5 10.5 2.5ZM5.5 9H13.5Q16 9 16 11.5V16Q16 18.5 13.5 18.5H13V21.5L9.5 18.5H5.5Q3 18.5 3 16V11.5Q3 9 5.5 9Z" />
  ),

  // Seta larga para cima (triângulo com haste), sólida.
  'voto-cima': <path d="M12 3L21.5 12.5H16.5V21H7.5V12.5H2.5Z" />,

  // Seta larga para baixo (triângulo com haste), sólida.
  'voto-baixo': <path d="M12 21L21.5 11.5H16.5V3H7.5V11.5H2.5Z" />,

  // Balão de conversa sólido com três pontos recortados.
  comentario: (
    <path fillRule="evenodd" clipRule="evenodd" d="M5.5 3H18.5Q21 3 21 5.5V14Q21 16.5 18.5 16.5H10.5L6.5 20.5V16.5H5.5Q3 16.5 3 14V5.5Q3 3 5.5 3ZM6.7 10A1.3 1.3 0 1 0 9.3 10A1.3 1.3 0 1 0 6.7 10ZM10.7 10A1.3 1.3 0 1 0 13.3 10A1.3 1.3 0 1 0 10.7 10ZM14.7 10A1.3 1.3 0 1 0 17.3 10A1.3 1.3 0 1 0 14.7 10Z" />
  ),

  // Clipe de papel em traço.
  anexo: (
    <path d="M20 11.5L12.2 19.3A4.8 4.8 0 0 1 5.4 12.5L13.2 4.7A3.2 3.2 0 0 1 17.7 9.2L10.1 16.8A1.6 1.6 0 0 1 7.8 14.5L14.6 7.7" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />
  ),

  // Estrela sólida de cinco pontas.
  estrela: <path d="M12 2.5L14.9 8.6L21.5 9.4L16.6 14L17.9 20.6L12 17.3L6.1 20.6L7.4 14L2.5 9.4L9.1 8.6Z" />,

  // Avião de papel sólido apontando para a direita.
  enviar: <path d="M2.5 3.5L21.5 12L2.5 20.5L4.5 13.5L13.5 12L4.5 10.5Z" />,

  // Alfinete sólido na diagonal (cabeça no canto superior direito, agulha embaixo à esquerda).
  fixar: <path d="M14.5 2.5L21.5 9.5L18.5 11L13 16.5L13.5 19.5L12 21L8.5 17.5L3 12L4.5 10.5L7.5 11L13 5.5ZM3.2 20.8L7.6 16.4L8.4 17.2L4 21.6Z" />,

  // Cadeado sólido: arco em traço cheio separado do corpo, com fechadura recortada.
  cadeado: (
    <>
      <path d="M7 10V8A5 5 0 0 1 17 8V10H15V8A3 3 0 0 0 9 8V10Z" />
      <path fillRule="evenodd" clipRule="evenodd" d="M5 10H19Q20.5 10 20.5 11.5V20Q20.5 21.5 19 21.5H5Q3.5 21.5 3.5 20V11.5Q3.5 10 5 10ZM10.5 15A1.5 1.5 0 1 0 13.5 15A1.5 1.5 0 1 0 10.5 15ZM11.2 16.5H12.8V18.5H11.2Z" />
    </>
  ),

  // Sol sólido: disco central com oito raios sólidos (quatro retos e quatro diagonais).
  sol: (
    <>
      <circle cx="12" cy="12" r="5" />
      <path d="M11 2.5H13V5H11ZM11 19H13V21.5H11ZM2.5 11H5V13H2.5ZM19 11H21.5V13H19Z" />
      <path d="M17.66 7.76L19.42 6L18.01 4.57L16.24 6.34ZM6.34 7.76L4.58 6L5.99 4.57L7.76 6.34ZM17.66 16.24L19.42 18L18.01 19.43L16.24 17.66ZM6.34 16.24L4.58 18L5.99 19.43L7.76 17.66Z" />
    </>
  ),

  // Lua crescente sólida (arco externo e arco interno que recorta a parte iluminada).
  lua: <path d="M21 12.79A9 9 0 1 1 11.21 3A7 7 0 0 0 21 12.79Z" />,

  // Monitor sólido: moldura com tela recortada, haste e base.
  monitor: (
    <>
      <path fillRule="evenodd" clipRule="evenodd" d="M2.5 3.5H21.5V16.5H2.5ZM4.5 5.5V14.5H19.5V5.5Z" />
      <path d="M10 16.5H14V18.5H17V20.5H7V18.5H10Z" />
    </>
  ),

  // Balão de conversa sólido com duas linhas recortadas.
  chat: (
    <path fillRule="evenodd" clipRule="evenodd" d="M5.5 3H18.5Q21 3 21 5.5V14Q21 16.5 18.5 16.5H10.5L6.5 20.5V16.5H5.5Q3 16.5 3 14V5.5Q3 3 5.5 3ZM7 7.8H17V9.4H7ZM7 11.6H14V13.2H7Z" />
  ),

  // Envelope sólido com a aba em V recortada.
  email: (
    <path fillRule="evenodd" clipRule="evenodd" d="M2.5 5H21.5V19H2.5ZM4.5 7.2V17H19.5V7.2L12 13Z" />
  ),

  // Paleta de pintor sólida com três furos recortados (cores).
  paleta: (
    <>
      <path fillRule="evenodd" clipRule="evenodd" d="M12 2.5C6.8 2.5 2.5 6.6 2.5 11.8C2.5 17 6.6 21.5 11.5 21.5C13 21.5 13.5 20.6 13.5 19.7C13.5 18.8 12.8 18.3 12.8 17.4C12.8 16.5 13.5 15.8 14.4 15.8H16.5C19.5 15.8 21.5 13.8 21.5 10.8C21.5 6 17.4 2.5 12 2.5ZM5.4 10A1.6 1.6 0 1 0 8.6 10A1.6 1.6 0 1 0 5.4 10ZM9.4 6.2A1.6 1.6 0 1 0 12.6 6.2A1.6 1.6 0 1 0 9.4 6.2ZM15.2 7.4A1.6 1.6 0 1 0 18.4 7.4A1.6 1.6 0 1 0 15.2 7.4Z" />
    </>
  ),

  // Um tique sólido.
  visto: <path d="M3.5 12.5L5.6 10.4L9.2 14L18.4 4.8L20.5 6.9L9.2 18.2Z" />,

  // Dois tiques sólidos sobrepostos (o segundo deslocado para a direita).
  'visto-duplo': (
    <path d="M1.5 12.5L3.6 10.4L7 13.8L14.9 5.9L17 8L7 18ZM6 12.5L8.1 10.4L11.5 13.8L19.4 5.9L21.5 8L11.5 18Z" />
  ),

  // Seta curva para a esquerda saindo para a direita embaixo (resposta citada), sólida.
  responder: (
    <path d="M9.5 8V4.5L2.5 11.5L9.5 18.5V15C15.5 15 19.5 16.5 21.5 20.5C20.5 14.5 16.5 10.5 9.5 10Z" />
  ),

  // Lixeira sólida: tampa com alça e corpo com duas ranhuras recortadas.
  lixeira: (
    <>
      <path d="M9 2.5H15V4.5H21V6.5H3V4.5H9Z" />
      <path fillRule="evenodd" clipRule="evenodd" d="M5 8H19L18.2 20.8Q18 21.5 17 21.5H7Q6 21.5 5.8 20.8ZM9 10.5V19H10.5V10.5ZM13.5 10.5V19H15V10.5Z" />
    </>
  ),

  // Dois grupos de pessoas: uma em destaque na frente e duas menores nas laterais.
  grupo: (
    <>
      <circle cx="12" cy="7.5" r="3.5" />
      <path d="M5.5 21.5C5.5 16.5 8.3 13.8 12 13.8C15.7 13.8 18.5 16.5 18.5 21.5Z" />
      <circle cx="5" cy="9.6" r="2.6" />
      <path d="M1.8 21.5V19.6C1.8 17.4 3.2 16 5 16C6.8 16 8.2 17.4 8.2 19.6V21.5Z" />
      <circle cx="19" cy="9.6" r="2.6" />
      <path d="M22.2 21.5V19.6C22.2 17.4 20.8 16 19 16C17.2 16 15.8 17.4 15.8 19.6V21.5Z" />
    </>
  ),

  // Círculo sólido com um sinal de mais recortado no centro.
  'mais-circulo': (
    <path fillRule="evenodd" clipRule="evenodd" d="M12 2.5A9.5 9.5 0 1 0 12 21.5A9.5 9.5 0 1 0 12 2.5ZM11 6.8H13V11H17.2V13H13V17.2H11V13H6.8V11H11Z" />
  ),

  // Seta para a esquerda (traço puro com ponta).
  'seta-esquerda': <path d="M19.5 12H4.5M10.5 6L4.5 12L10.5 18" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />,
};

export function Icone({
  nome,
  tamanho = 22,
  className,
}: {
  nome: NomeIcone;
  tamanho?: number;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={tamanho}
      height={tamanho}
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      {DESENHOS[nome]}
    </svg>
  );
}
