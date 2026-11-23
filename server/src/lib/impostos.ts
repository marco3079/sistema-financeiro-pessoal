// Área Impostos: quanto do que a pessoa gasta é imposto.
//
// INDIRETOS (ICMS, PIS/Cofins, IPI, ISS e "outros" embutidos) são ESTIMATIVAS: cada categoria de despesa recebe um
// tipo de gasto com a carga tributária média sobre o preço final, no espírito das tabelas do IBPT usadas no
// "De Olho no Imposto" (Lei 12.741/2012). O valor real muda por produto, estado e regime da empresa; a pessoa pode
// trocar o tipo ou digitar a alíquota de cada categoria.
//
// DIRETOS (IOF, IPVA, IPTU, IR/DARF, INSS/DAS, taxas) são os valores pagos de fato, achados pela categoria do tipo
// "Imposto pago diretamente" ou pela descrição do lançamento.

export interface Componentes {
  icms: number;
  pisCofins: number;
  ipi: number;
  iss: number;
  outros: number; // IRPJ, CSLL, encargos, CIDE, IOF embutido etc.
}

export interface TipoGasto {
  rotulo: string;
  exemplo: string;
  componentes: Componentes; // % do preço final
}

function c(icms: number, pisCofins: number, ipi: number, iss: number, outros: number): Componentes {
  return { icms, pisCofins, ipi, iss, outros };
}

export const TIPOS_GASTO = {
  ALIMENTOS: { rotulo: 'Alimentos (mercado)', exemplo: 'Supermercado, feira, padaria', componentes: c(14, 7, 1, 0, 3) },
  RESTAURANTE: { rotulo: 'Restaurantes e delivery', exemplo: 'Restaurante, lanchonete, iFood', componentes: c(14, 8, 1, 0, 7) },
  COMBUSTIVEL: { rotulo: 'Combustível', exemplo: 'Gasolina, etanol, diesel', componentes: c(22, 11, 0, 0, 3) },
  TRANSPORTE: { rotulo: 'Transporte e aplicativos', exemplo: 'Uber, 99, ônibus, metrô, estacionamento', componentes: c(0, 7, 0, 4, 7) },
  FARMACIA: { rotulo: 'Remédios e farmácia', exemplo: 'Medicamentos, drogaria', componentes: c(17, 9, 0, 0, 5) },
  SAUDE: { rotulo: 'Saúde (serviços)', exemplo: 'Consultas, exames, plano de saúde, terapias', componentes: c(0, 4, 0, 3, 7) },
  VESTUARIO: { rotulo: 'Roupas e calçados', exemplo: 'Roupas, sapatos, acessórios', componentes: c(17, 9, 0, 0, 9) },
  COMPRAS: { rotulo: 'Compras em geral', exemplo: 'Lojas, marketplaces, utilidades, presentes', componentes: c(17, 9, 5, 0, 6) },
  ELETRONICOS: { rotulo: 'Eletrônicos e eletrodomésticos', exemplo: 'Celular, computador, TV, geladeira', componentes: c(18, 9, 10, 0, 6) },
  TELECOM: { rotulo: 'Telefone e internet', exemplo: 'Celular, banda larga, TV por assinatura', componentes: c(18, 4, 0, 0, 7) },
  CASA: { rotulo: 'Contas da casa', exemplo: 'Luz, água, gás', componentes: c(17, 7, 0, 0, 4) },
  ASSINATURAS: { rotulo: 'Assinaturas digitais', exemplo: 'Streaming, aplicativos, software', componentes: c(0, 9, 0, 3, 5) },
  SERVICOS_PESSOAIS: { rotulo: 'Beleza e bem-estar', exemplo: 'Cabelo, unha, estética, academia, pilates', componentes: c(0, 4, 0, 4, 6) },
  EDUCACAO: { rotulo: 'Educação', exemplo: 'Escola, faculdade, cursos', componentes: c(0, 4, 0, 3, 8) },
  LAZER: { rotulo: 'Lazer e cultura', exemplo: 'Cinema, shows, passeios, ingressos', componentes: c(4, 7, 0, 4, 6) },
  VIAGEM: { rotulo: 'Viagens e hospedagem', exemplo: 'Hotel, passagens, pacotes', componentes: c(2, 8, 0, 4, 6) },
  MORADIA: { rotulo: 'Moradia', exemplo: 'Aluguel, condomínio', componentes: c(0, 1, 0, 0, 4) },
  FINANCEIRO: { rotulo: 'Seguros e serviços financeiros', exemplo: 'Seguros, tarifas, juros', componentes: c(0, 5, 0, 0, 7) },
  DIRETO: { rotulo: 'Imposto pago diretamente', exemplo: 'IOF, IPVA, IPTU, DARF, taxas', componentes: c(0, 0, 0, 0, 0) },
  SEM_IMPOSTO: { rotulo: 'Sem imposto embutido', exemplo: 'Pix para pessoas, família, doações, reembolsos', componentes: c(0, 0, 0, 0, 0) },
} satisfies Record<string, TipoGasto>;

export type TipoImposto = keyof typeof TIPOS_GASTO;

export function ehTipoImposto(v: unknown): v is TipoImposto {
  return typeof v === 'string' && v in TIPOS_GASTO;
}

export function totalDosComponentes(comp: Componentes): number {
  return comp.icms + comp.pisCofins + comp.ipi + comp.iss + comp.outros;
}

function semAcento(t: string): string {
  return t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

// Palpite pelo nome da categoria. Trecho com espaço: procura no nome todo; sem espaço: alguma palavra começa com ele.
// A ordem importa (o primeiro que casar vence).
const PALPITES: { trechos: string[]; tipo: TipoImposto }[] = [
  { trechos: ['imposto', 'impostos', 'iof', 'ipva', 'iptu', 'darf', 'tributo', 'detran', 'licenciamento', 'inss'], tipo: 'DIRETO' },
  { trechos: ['igreja', 'dizimo', 'doacao', 'doacoes', 'mae', 'pai', 'vovo', 'familia', 'reembolso', 'mesada', 'pensao'], tipo: 'SEM_IMPOSTO' },
  { trechos: ['cabelo', 'barbe', 'unha', 'sobrancelha', 'estetica', 'pele', 'pilates', 'academia', 'bem estar', 'beleza', 'salao', 'massag', 'drenagem', 'depila'], tipo: 'SERVICOS_PESSOAIS' },
  { trechos: ['mercado', 'supermercado', 'feira', 'padaria', 'acougue', 'hortifruti', 'alimenta'], tipo: 'ALIMENTOS' },
  { trechos: ['restaurante', 'bar', 'bares', 'lanche', 'lanchonete', 'delivery', 'ifood', 'cafe', 'pizza'], tipo: 'RESTAURANTE' },
  { trechos: ['combustivel', 'gasolina', 'posto', 'etanol', 'diesel'], tipo: 'COMBUSTIVEL' },
  { trechos: ['farmacia', 'remedio', 'medicamento', 'drogaria'], tipo: 'FARMACIA' },
  { trechos: ['saude', 'medic', 'exame', 'hapvida', 'unimed', 'dentista', 'terapia', 'psic', 'fisio', 'hospital', 'clinica'], tipo: 'SAUDE' },
  { trechos: ['transporte', 'uber', 'onibus', 'metro', 'taxi', 'estacionamento', 'pedagio'], tipo: 'TRANSPORTE' },
  { trechos: ['roupa', 'sapato', 'calcado', 'vestuario', 'moda', 'tenis'], tipo: 'VESTUARIO' },
  { trechos: ['eletronico', 'eletrodomestico', 'informatica', 'celular novo'], tipo: 'ELETRONICOS' },
  { trechos: ['assinatura', 'streaming', 'netflix', 'spotify', 'software'], tipo: 'ASSINATURAS' },
  { trechos: ['claro', 'vivo', 'internet', 'telefone', 'telefonia'], tipo: 'TELECOM' },
  { trechos: ['contas da casa', 'luz', 'energia', 'agua', 'gas'], tipo: 'CASA' },
  { trechos: ['educa', 'escola', 'curso', 'faculdade', 'livro'], tipo: 'EDUCACAO' },
  { trechos: ['lazer', 'cinema', 'show', 'ingresso', 'teatro', 'passeio'], tipo: 'LAZER' },
  { trechos: ['viagem', 'viagens', 'hotel', 'hospedagem', 'passagem', 'airbnb', 'cruzeiro'], tipo: 'VIAGEM' },
  { trechos: ['aluguel', 'moradia', 'condominio'], tipo: 'MORADIA' },
  { trechos: ['seguro', 'tarifa', 'juros', 'banco', 'emprestimo', 'financiamento'], tipo: 'FINANCEIRO' },
];

export function tipoPeloNome(nome: string): TipoImposto {
  const n = semAcento(nome);
  const palavras = n.split(/[^a-z0-9]+/).filter(Boolean);
  const casa = (t: string) => (t.includes(' ') ? n.includes(t) : palavras.some((p) => p.startsWith(t)));
  return PALPITES.find((p) => p.trechos.some(casa))?.tipo ?? 'COMPRAS';
}

// Componentes que valem para uma categoria: os do tipo ou, com alíquota própria, os do tipo na mesma proporção.
export function componentesDaCategoria(tipo: TipoImposto, aliquotaPropria: number | null): Componentes {
  const base = TIPOS_GASTO[tipo].componentes;
  if (aliquotaPropria === null) return base;
  const total = totalDosComponentes(base);
  if (total === 0) return c(0, 0, 0, 0, aliquotaPropria);
  const f = aliquotaPropria / total;
  return c(base.icms * f, base.pisCofins * f, base.ipi * f, base.iss * f, base.outros * f);
}

// ---------- Impostos diretos ----------

export const TIPOS_DIRETO = {
  IOF: 'IOF',
  IPVA: 'IPVA e licenciamento',
  IPTU: 'IPTU',
  IR: 'Imposto de renda (DARF/IRPF)',
  INSS: 'INSS e DAS',
  INVESTIMENTOS: 'IR retido em investimentos',
  OUTROS: 'Outros impostos e taxas',
} as const;

export type TipoDireto = keyof typeof TIPOS_DIRETO;

const REGRAS_DIRETO: { re: RegExp; tipo: TipoDireto }[] = [
  { re: /\biofv?\b/, tipo: 'IOF' },
  { re: /\b(ipva|licenciamento|dpvat|detran)\b/, tipo: 'IPVA' },
  { re: /\biptu\b/, tipo: 'IPTU' },
  { re: /\b(darf|irpf|imposto de renda|receita federal)\b/, tipo: 'IR' },
  { re: /\b(inss|gps|das mei|simples nacional)\b/, tipo: 'INSS' },
  { re: /\b(imposto|tributo|taxa de lixo|tlp)\b/, tipo: 'OUTROS' },
];

// Tipo do imposto direto pela descrição; null se a descrição não parece um imposto.
export function diretoPelaDescricao(descricao: string): TipoDireto | null {
  const d = semAcento(descricao);
  return REGRAS_DIRETO.find((r) => r.re.test(d))?.tipo ?? null;
}

// ---------- Reforma: o que sobra dos tributos antigos em cada ano da transição ----------

// Parte do ICMS e do ISS que ainda existe no ano (LC 214/2025: cai 10% ao ano de 2029 a 2032 e acaba em 2033).
export function fatorIcmsIss(ano: number): number {
  if (ano <= 2028) return 1;
  if (ano >= 2033) return 0;
  return 1 - (ano - 2028) * 0.1;
}

// PIS, Cofins e (quase todo) o IPI acabam em 2027, quando a CBS entra cheia.
export function fatorPisCofinsIpi(ano: number): number {
  return ano <= 2026 ? 1 : 0;
}

// ---------- Datas ----------

// Último dia útil (segunda a sexta) do mês; não considera feriados.
export function ultimoDiaUtil(ano: number, mesIndice: number): Date {
  const d = new Date(Date.UTC(ano, mesIndice + 1, 0));
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d.setUTCDate(d.getUTCDate() - 1);
  return d;
}
