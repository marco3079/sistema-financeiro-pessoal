# g13 — Tela Rendimento (carteira contra Selic, IPCA, Ibovespa e IFIX)

## Objetivo

Tela nova `/app/rendimento` que mostra quanto os investimentos renderam, compara com os índices, lista o saldo da renda fixa estimado pela taxa e projeta 12 meses. A API já existe; você só faz a tela.

Projeto: `client/` é React 18 + TypeScript + Vite. Leia antes: `client/src/modules/importar/Historico.tsx` e `client/src/modules/importar/Cotacoes.tsx` (uso de `useDados`, `api`, `Cartao`, `Tabela`, botões com estado), `client/src/modules/investimentos/index.tsx` (formato da rota), `client/src/ui/index.tsx`, `client/src/ui/financas.tsx`, `client/src/lib/financas.ts`.

## Arquivos (só estes)

- criar `client/src/modules/rendimento/index.tsx`
- criar `client/src/modules/rendimento/Rendimento.tsx`
- criar `client/src/modules/rendimento/tipos.ts`
- criar `client/src/modules/rendimento/rendimento.css`

Os módulos são carregados sozinhos pela pasta: não edite nenhum outro arquivo.

## Rota (`index.tsx`)

```tsx
import type { RotaModulo } from '../../lib/rotas';
import { Rendimento } from './Rendimento';

export const rotas: RotaModulo[] = [
  { caminho: '/app/rendimento', rotulo: 'Rendimento', icone: 'investimentos', perfis: ['TITULAR'], elemento: <Rendimento />, ordem: 42 },
];
```

## API

- `GET /rendimento` → `RelatorioRendimento`. Na primeira vez pode levar até uns 30 segundos (busca os índices): mostre `<Carregando />` e, abaixo, o texto suave `Buscando Selic, IPCA, Ibovespa e IFIX. Na primeira vez pode levar alguns segundos.`
- `POST /rendimento/atualizar` (sem corpo; use `api.post<RelatorioRendimento>('/rendimento/atualizar', {})`) → o mesmo relatório recalculado. Guarde a resposta no estado da tela (ela substitui o que veio do GET).

`tipos.ts` (copie exatamente):

```ts
import type { TipoInvestimento } from '../../lib/financas';

export type Indice = 'SELIC' | 'IPCA' | 'IBOV' | 'IFIX';

export interface LinhaRendimento {
  aportes: number;      // tudo o que foi aplicado
  retiradas: number;    // resgates e vendas
  proventos: number;    // dividendos, JCP e rendimentos recebidos em dinheiro
  saldo: number;        // valor hoje
  ganho: number;        // saldo + retiradas + proventos - aportes
  rentabilidade: number | null; // % sobre o total aplicado
  taxaAnual: number | null;     // % ao ano
  desde: string | null;         // 'AAAA-MM-DD' da primeira aplicação
}

export interface ComparacaoIndice {
  indice: Indice;
  rotulo: string;
  valorHoje: number | null;  // quanto os mesmos aportes e retiradas valeriam hoje no índice
  ganho: number | null;
  taxaAnual: number | null;  // % ao ano
  diferenca: number | null;  // carteira menos índice (positivo = a carteira rendeu mais)
}

interface ContraIndice {
  indice: Indice;
  rotuloIndice: string;
  valorNoIndice: number | null;
  taxaAnualDoIndice: number | null;
  diferenca: number | null;
}

export interface AtivoRendimento extends LinhaRendimento, ContraIndice {
  id: number;
  nome: string;
  codigo: string | null;
  tipo: TipoInvestimento;
}

export interface ClasseRendimento extends LinhaRendimento, ContraIndice {
  tipo: TipoInvestimento;
  ativos: number;
}

export interface ProjecaoClasse {
  tipo: TipoInvestimento;
  saldo: number;
  referencia: string;   // de onde vem a taxa, ex.: "Ibovespa dos últimos 12 meses"
  taxa: number | null;  // % esperado em 12 meses
  projetado: number;
}

export interface RelatorioRendimento {
  geradoEm: string;
  indices: { indice: Indice; rotulo: string; ultimaData: string | null; retorno12m: number | null; retornoNoAno: number | null }[];
  carteira: LinhaRendimento & { ativos: number; comparacao: ComparacaoIndice[] };
  classes: ClasseRendimento[];
  ativos: AtivoRendimento[];
  semHistorico: { id: number; nome: string; saldo: number }[];
  rendaFixa: {
    estimados: { id: number; nome: string; regra: string; saldo: number }[];
    semEstimativa: { id: number; nome: string; motivo: string }[];
  };
  projecao: { classes: ProjecaoClasse[]; saldo: number; projetado: number; ganho: number; taxa: number | null };
  avisos: string[];
}
```

## Funções auxiliares (dentro de `Rendimento.tsx`)

```ts
// 12.34 -> "+12,34%"; -3.2 -> "-3,20%"; null -> "—"
function pct(valor: number | null): string
// "+R$ 1.234,56" / "-R$ 1.234,56"; null -> "—"   (use formatarReais(Math.abs(v)) e ponha o sinal na frente)
function reaisComSinal(valor: number | null): string
// classe CSS pela direção: valor > 0 -> 'rend-positivo'; valor < 0 -> 'rend-negativo'; 0 ou null -> ''
function classeDoSinal(valor: number | null): string
```

Use `toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })` em `pct`.
Rótulo do tipo de investimento: `rotuloDe(TIPOS_INVESTIMENTO, tipo)` de `../../lib/financas`.

## O que a tela mostra, nesta ordem

`<Pagina titulo="Rendimento" acoes={<Botao variante="secundario" desabilitado={atualizando} aoClicar={atualizar}>{atualizando ? 'Atualizando…' : 'Atualizar índices'}</Botao>}>`

Confira em `client/src/ui/index.tsx` quais valores `variante` aceita; se `secundario` não existir, use o que houver de botão não primário.

1. Erros e avisos: `erro` → `<Aviso tipo="erro">`; cada texto de `relatorio.avisos` → `<Aviso tipo="info">`.
2. Estado vazio: quando `relatorio.carteira.ativos === 0 && relatorio.semHistorico.length === 0`, mostre `<Vazio icone="investimentos" titulo="Nenhum investimento com histórico" texto="Importe a planilha de movimentação da B3 em Importar ou cadastre seus investimentos para comparar com os índices." />` e NÃO mostre as seções 3 a 8 (a seção 9 continua).
3. `<div className="resumo">` com quatro `ResumoItem`:
   - `icone="investimentos" cor="azul"` valor `formatarReais(carteira.saldo)` rótulo `Valor hoje`
   - `icone="seta-cima" cor="verde"` valor `reaisComSinal(carteira.ganho)` rótulo `Ganho total (com proventos)`
   - `icone="financeiro" cor="roxo"` valor `pct(carteira.taxaAnual)` rótulo `Rentabilidade ao ano`
   - `icone="transacoes" cor="laranja"` valor `formatarReais(carteira.proventos)` rótulo `Proventos recebidos`
   Confira em `client/src/ui/icones.tsx` e em `ResumoItem` se esses nomes de ícone e cor existem; se algum não existir, troque por um que exista.
4. `<Cartao titulo="Sua carteira contra os índices">`:
   - texto suave: `Quanto os mesmos aportes e retiradas, nas mesmas datas, valeriam hoje se tivessem seguido cada índice. Desde {formatarDia(carteira.desde)}.`
   - bloco de barras `rend-barras` (com `div`, sem biblioteca): primeira linha `Sua carteira` com `carteira.saldo`; depois uma linha por item de `carteira.comparacao` com `valorHoje !== null`. Cada linha: rótulo, barra com largura proporcional ao maior valor entre todas as linhas (mínimo 2%; valores negativos contam como 0) e o valor em reais. A barra da carteira usa a classe `rend-barra-carteira`; as dos índices, `rend-barra-indice`.
   - `Tabela<ComparacaoIndice>` com `chave={(c) => c.indice}`, colunas: `Índice` → `rotulo`; `Valeria hoje` (direita) → `formatarReais` ou `—`; `Ganho` (direita) → `reaisComSinal(ganho)`; `Ao ano` (direita) → `pct(taxaAnual)`; `Sua carteira rendeu` (direita) → `<span className={classeDoSinal(c.diferenca)}>{c.diferenca === null ? '—' : reaisComSinal(c.diferenca) + (c.diferenca >= 0 ? ' a mais' : ' a menos')}</span>`.
5. `<Cartao titulo="Por classe de ativo">`: `Tabela<ClasseRendimento>`, `chave={(c) => c.tipo}`, colunas: `Classe` → rótulo do tipo + em texto suave `{ativos} ativo(s)`; `Aplicado` (direita) → `formatarReais(aportes)`; `Valor hoje` (direita); `Proventos` (direita); `Ganho` (direita, com `classeDoSinal`) → `reaisComSinal(ganho)`; `Ao ano` (direita) → `pct(taxaAnual)`; `Referência` → `{rotuloIndice}: {pct(taxaAnualDoIndice)} ao ano`; `Diferença` (direita, com `classeDoSinal`) → `reaisComSinal(diferenca)`.
6. `<Cartao titulo="Por ativo">`: `Tabela<AtivoRendimento>`, `chave={(a) => a.id}`, `vazio="Nenhum ativo com histórico."`, colunas: `Ativo` → `codigo ?? nome` em negrito e, se houver código, o nome em texto suave; `Desde` → `formatarDia(desde)`; `Aplicado` (direita); `Valor hoje` (direita); `Proventos` (direita); `Ganho` (direita, com sinal e classe); `Rentabilidade` (direita) → `pct(rentabilidade)`; `Ao ano` (direita) → `pct(taxaAnual)`; `Contra {rotuloIndice}` (título da coluna fixo: `Contra o índice`) → `{rotuloIndice}: ` + `reaisComSinal(diferenca)` com `classeDoSinal`.
7. Se `semHistorico.length > 0`: `<Cartao titulo="Fora da comparação">` com texto suave `Estes ativos não têm aplicação registrada, então não dá para saber quando o dinheiro entrou.` e uma lista simples `nome — formatarReais(saldo)`.
8. `<Cartao titulo="Projeção para 12 meses">`:
   - `<div className="resumo">` com três `ResumoItem`: `Hoje` (`formatarReais(projecao.saldo)`), `Em 12 meses` (`formatarReais(projecao.projetado)`), `Ganho estimado` (`reaisComSinal(projecao.ganho)` + ` (${pct(projecao.taxa)})`).
   - `Tabela<ProjecaoClasse>`, `chave={(c) => c.tipo}`, colunas: `Classe`; `Hoje` (direita); `Taxa usada` → `pct(taxa)` e em texto suave a `referencia`; `Em 12 meses` (direita).
   - `<Aviso tipo="info">Estimativa: supõe que cada classe repete o que o índice dela rendeu nos últimos 12 meses. Rendimento passado não garante rendimento futuro.</Aviso>`
9. `<Cartao titulo="Renda fixa pela taxa">`:
   - texto suave: `Títulos sem cotação têm o saldo corrigido pela taxa informada no cadastro ("110% do CDI", "IPCA + 6%", "12% a.a.").`
   - se `rendaFixa.estimados.length > 0`: `Tabela` com colunas `Título` → `nome`; `Taxa` → `regra`; `Saldo estimado` (direita) → `formatarReais(saldo)`.
   - se `rendaFixa.semEstimativa.length > 0`: subtítulo `Sem estimativa` e uma lista `nome — motivo` em texto suave.
   - se as duas listas estão vazias: texto suave `Nenhum título de renda fixa cadastrado.`
10. `<Cartao titulo="Índices de referência">`: `Tabela` de `relatorio.indices`, `chave={(i) => i.indice}`, colunas `Índice` → `rotulo`; `12 meses` (direita, com `classeDoSinal`) → `pct(retorno12m)`; `No ano` (direita, com `classeDoSinal`) → `pct(retornoNoAno)`; `Último dado` → `formatarDia(ultimaData)`. Abaixo, texto suave: `Selic e IPCA: Banco Central. Ibovespa e IFIX: B3.`

## Estado e carregamento

- `const { dados, carregando, erro } = useDados<RelatorioRendimento>('/rendimento');`
- `const [atualizado, setAtualizado] = useState<RelatorioRendimento | null>(null);` e `const relatorio = atualizado ?? dados;`
- `atualizar()`: `setAtualizando(true)`; `try { setAtualizado(await api.post(...)) } catch (e) { setErroAcao(mensagemErro(e)) } finally { setAtualizando(false) }`.

## CSS (`rendimento.css`, importado no topo de `Rendimento.tsx`)

- `.rend-positivo { color: var(--cor-sucesso, #16a34a); }` e `.rend-negativo { color: var(--cor-erro, #dc2626); }` — antes, procure em `client/src/ui/estilo.css` os nomes reais das variáveis de verde e vermelho do tema e use-os (o valor depois da vírgula é só reserva).
- `.rend-barras`: coluna com `gap: 0.6rem`. `.rend-linha`: grid `minmax(90px, 150px) 1fr auto`, `gap: 0.75rem`, centralizado; abaixo de 520 px vira 2 colunas com o valor embaixo do rótulo.
- trilho da barra: `height: 14px; border-radius: 999px; background: var(--cor-borda); overflow: hidden`. `.rend-barra-carteira { background: var(--cor-primaria); }` `.rend-barra-indice { background: color-mix(in srgb, var(--cor-primaria) 40%, transparent); }`
- Só variáveis do tema, sem `!important`.

## Critérios de aceite

- `cd client && npx tsc --noEmit` sem erros.
- Sem `any`, sem `// @ts-ignore`, sem biblioteca nova.
- A tela não quebra quando qualquer número é `null` e quando as listas estão vazias.
- Tema claro e escuro; sem rolagem horizontal da página em 360 px (as tabelas já rolam sozinhas).
- Nenhum arquivo além dos quatro listados foi alterado.
