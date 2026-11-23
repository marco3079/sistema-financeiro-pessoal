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

// ---------- IRPF (declaração anual) ----------
//
// Tabela progressiva anual: a mensal da Lei 15.191/2025 (isenção até R$ 2.428,80/mês) vezes 12, vigente em 2026.
// Redução da Lei 15.270/2025 (a partir do ano-calendário 2026): rendimentos tributáveis até R$ 60 mil no ano ficam
// sem imposto; de R$ 60 mil a R$ 88,2 mil a redução diminui em linha reta. Fontes: Receita Federal (tabelas do IRPF)
// e as leis citadas. Para anos anteriores a 2026 a simulação usa a mesma tabela, sem a redução (aproximação).

export const IRPF = {
  faixas: [
    { ate: 29145.6, aliquota: 0, deducao: 0 },
    { ate: 33919.8, aliquota: 0.075, deducao: 2185.92 },
    { ate: 45012.6, aliquota: 0.15, deducao: 4729.92 },
    { ate: 55976.16, aliquota: 0.225, deducao: 8105.88 },
    { ate: Infinity, aliquota: 0.275, deducao: 10904.76 },
  ],
  porDependente: 2275.08,
  limiteEducacao: 3561.5, // por pessoa (titular e cada dependente)
  descontoSimplificado: 0.2,
  tetoSimplificado: 16754.34,
  limitePrevidencia: 0.12, // PGBL e previdência complementar: até 12% da renda tributável
  reducao: { isentoAte: 60000, ate: 88200, constante: 8429.73, fator: 0.095575, desdeAno: 2026 },
  fonte: 'Receita Federal; Lei 15.191/2025 (tabela) e Lei 15.270/2025 (redução até R$ 5 mil por mês)',
} as const;

function impostoDaTabela(base: number): { imposto: number; aliquota: number } {
  const faixa = IRPF.faixas.find((f) => base <= f.ate) ?? IRPF.faixas[IRPF.faixas.length - 1];
  return { imposto: Math.max(0, base * faixa.aliquota - faixa.deducao), aliquota: faixa.aliquota };
}

function reducaoLei15270(rendimentos: number, ano: number): number {
  const r = IRPF.reducao;
  if (ano < r.desdeAno || rendimentos > r.ate) return 0;
  if (rendimentos <= r.isentoAte) return Infinity; // zera o imposto
  return Math.max(0, r.constante - r.fator * rendimentos);
}

// Imposto devido sobre a base, já com a redução da Lei 15.270 (que olha os rendimentos tributáveis, não a base).
export function impostoAnual(base: number, rendimentos: number, ano: number): { imposto: number; aliquota: number; reducao: number } {
  const { imposto, aliquota } = impostoDaTabela(Math.max(0, base));
  const reducao = Math.min(imposto, reducaoLei15270(rendimentos, ano));
  return { imposto: imposto - reducao, aliquota, reducao };
}

export const TIPOS_DEDUTIVEL = {
  SAUDE: 'Saúde',
  EDUCACAO: 'Educação',
  PREVIDENCIA: 'Previdência (PGBL/INSS próprio)',
  NAO: 'Não abate',
} as const;

export type TipoDedutivel = keyof typeof TIPOS_DEDUTIVEL;

export function ehTipoDedutivel(v: unknown): v is TipoDedutivel {
  return typeof v === 'string' && v in TIPOS_DEDUTIVEL;
}

// Palpite: médicos, exames, plano, dentista, psicólogo e terapias abatem; remédio comprado na farmácia, academia e
// estética não. Escola e faculdade abatem (cursos livres e idiomas não, mas pelo nome não dá para separar).
export function dedutivelPeloNome(nome: string, tipo: TipoImposto): TipoDedutivel {
  const n = semAcento(nome);
  if (/previd|pgbl/.test(n)) return 'PREVIDENCIA';
  if (/(idioma|ingles|curso livre|autoescola)/.test(n)) return 'NAO';
  if (tipo === 'SAUDE') return /(pilates|academia|massag|drenagem)/.test(n) ? 'NAO' : 'SAUDE';
  if (tipo === 'EDUCACAO') return 'EDUCACAO';
  return 'NAO';
}

// ---------- Estabelecimentos ----------

// Nome do lugar a partir da descrição do lançamento: tira parcelas, códigos de maquininha e números.
export function nomeDoEstabelecimento(descricao: string): string {
  let d = descricao;
  if (d.includes('|')) d = d.split('|').slice(1).join(' ');
  d = semAcento(d)
    .replace(/\(iof\)/g, ' ')
    .replace(/\b\d+\s*\/\s*\d+\b/g, ' ') // parcelas 2/10
    .replace(/\b(parcela|parc)\b.*$/g, ' ')
    .replace(/^(mp|pg|pm|ec|ifd|pag|pagseguro|merpago|mercadopago|sumup|stone|cielo|ton|picpay|ppro|dl|iz|ebn|pay)\s*\*+\s*/g, ' ')
    .replace(/\*/g, ' ')
    .replace(/\bs\.?a\b\.?/g, ' ')
    .replace(/[^a-z\s.]/g, ' ')
    .replace(
      /\b(compra|pagamento|pix|debito|credito|cartao|no|na|em|de|do|da|dos|das|transferencia|enviada|enviado|pelo|para|ltda|eireli|me|comercio|servicos|brasil|trip)\b/g,
      ' '
    )
    .replace(/\s+/g, ' ')
    .trim();
  // Tira palavras repetidas ou cortadas ('uber uber trip', 'mercadolivre mercadol').
  const palavras: string[] = [];
  for (const p of d.split(' ').filter((x) => x.length > 1 && x !== '.')) {
    if (palavras.some((q) => q.startsWith(p) || p.startsWith(q))) continue;
    palavras.push(p);
    if (palavras.length === 3) break;
  }
  const nome = palavras.join(' ');
  return nome ? nome.replace(/\b\w/g, (l) => l.toUpperCase()) : 'Sem descrição';
}

// ---------- Combustível, IOF e tarifas ----------

export function ehCombustivel(descricao: string): boolean {
  return /\b(posto|combustive(l|is)|gasolina|etanol|shell|ipiranga|petrobras|br mania|auto posto|ale combustiveis)\b/.test(semAcento(descricao));
}

export const TIPOS_IOF = {
  INTERNACIONAL: 'Compras internacionais',
  CAMBIO: 'Câmbio e remessas',
  CREDITO: 'Crédito, empréstimo e financiamento',
  ROTATIVO: 'Rotativo e parcelamento da fatura',
  INVESTIMENTO: 'Resgate de aplicações',
} as const;

export type TipoIof = keyof typeof TIPOS_IOF;

export function tipoDoIof(descricao: string): TipoIof {
  const d = semAcento(descricao);
  if (/(rotativo|atraso|parcelamento|parcelado|\biofv\b|saque|cheque especial|limite)/.test(d)) return 'ROTATIVO';
  if (/(resgate|fundo|aplicacao)/.test(d)) return 'INVESTIMENTO';
  if (/(cambio|remessa|wise|conversao|moeda em especie)/.test(d)) return 'CAMBIO';
  if (/(emprestimo|financiamento|credito pessoal|consignado|cdc)/.test(d)) return 'CREDITO';
  return 'INTERNACIONAL';
}

// Tarifas e pacotes bancários (sem anuidade, juros e multas, que a pessoa preferiu deixar de fora).
export function ehTarifaBancaria(descricao: string): boolean {
  const d = semAcento(descricao);
  if (/(anuidade|juros|multa|mora)/.test(d)) return false;
  return /\b(tarifa|tarifas|pacote de servicos|cesta de servicos|cesta|manutencao de conta|tar\.?\s|taxa de saque|taxa ted|tarifa ted|tarifa doc|servicos bancarios)/.test(d);
}

// ---------- Renda fixa e fundos ----------

// IR regressivo da renda fixa e dos fundos (Lei 11.033/2004), pelo prazo da aplicação em dias.
export function aliquotaRegressiva(dias: number): number {
  if (dias <= 180) return 22.5;
  if (dias <= 360) return 20;
  if (dias <= 720) return 17.5;
  return 15;
}

// LCI, LCA, CRI, CRA, poupança e debêntures incentivadas são isentas para pessoa física.
export function rendaFixaIsenta(texto: string): boolean {
  return /\b(lci|lca|cri|cra|poupanca|debenture incentivada|incentivada|lig)\b/.test(semAcento(texto));
}
