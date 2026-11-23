// Leitura das páginas da Suno Research (área do investidor), usada pelo script com janela (sincronizar.mjs)
// e pelo serviço sem janela (servico.mjs). Só lê o que a página mostra para a pessoa logada.

export const INICIO = 'https://investidor.suno.com.br/carteiras';
export const ESPERA_TABELA_MS = 40 * 1000;

export function naSuno(url) {
  return /^https:\/\/investidor\.suno\.com\.br\//.test(url);
}

// Logado = a página de carteiras mostra os cartões das carteiras.
export async function mostraCarteiras(pagina) {
  try {
    return (await pagina.locator('main a[href*="/carteiras/"]').count()) > 0;
  } catch {
    return false; // página no meio de uma navegação
  }
}

// Espera a pessoa entrar na conta. A Suno abre /carteiras e só depois de conferir a sessão manda para
// login.suno.com.br: por isso quem decide é o que aparece na página, não o endereço.

// Carteiras assinadas da página /carteiras: as do bloco "Carteiras disponíveis" que mostram "rentabilidade total"
// (as de ativos: Dividendos, Valor, FIIs, Start...). Ficam de fora as do bloco "Carteiras que você pode se
// interessar" e as com cadeado (não assinadas: a página só mostra uma prévia) e as listas sem carteira de ativos
// (Renda Fixa, Reserva).
async function listarCarteiras(pagina) {
  await pagina.waitForSelector('a[href*="/carteiras/"]', { timeout: ESPERA_TABELA_MS });
  // Os cartões chegam aos poucos: espera a lista parar de mudar.
  let anterior = -1;
  for (let i = 0; i < 20; i++) {
    const n = await pagina.locator('main a[href*="/carteiras/"]').count();
    if (n === anterior && n > 0) break;
    anterior = n;
    await pagina.waitForTimeout(1000);
  }
  return pagina.evaluate(() => {
    const textoDe = (el) => (el.innerText || '').trim();
    const titulos = [...document.querySelectorAll('main h1, main h2, main h3, main h4, main p, main span')];
    const interessar = titulos.find((el) => /pode se interessar/i.test(textoDe(el)) && el.children.length === 0);
    const vistas = new Map();
    for (const a of document.querySelectorAll('main a[href*="/carteiras/"]')) {
      // Depois do título "Carteiras que você pode se interessar": não assinada.
      if (interessar && interessar.compareDocumentPosition(a) & Node.DOCUMENT_POSITION_FOLLOWING) continue;
      if (!/rentabilidade total/i.test(a.innerText)) continue;
      // Cadeado no cartão: carteira não assinada (ícone "lock" do Material: o arco do cadeado no desenho).
      const desenhos = [...a.querySelectorAll('svg path')].map((p) => p.getAttribute('d') || '');
      if (desenhos.some((d) => /c0-2\.76-2\.24-5-5-5s-5 2\.24-5/.test(d))) continue;
      const url = new URL(a.getAttribute('href'), location.href);
      const slug = url.pathname.replace(/^\/carteiras\//, '').replace(/\/.*$/, '');
      if (!/^[a-z0-9-]+$/.test(slug) || vistas.has(slug)) continue;
      // O texto do cartão começa com a data da última atualização ("há X dias", "hoje", "ontem"...) e
      // depois o nome da carteira. Prefere um título do cartão; senão, a primeira linha que não seja data.
      const ehData = (t) =>
        /^(há\s|hoje|ontem|agora|atualizad|\d{1,2}[/.-]\d{1,2}|\d+\s*(min|h|d|dia|hora|semana|m[eê]s))/i.test(t);
      const partes = a.innerText.split('\n').map((t) => t.trim()).filter(Boolean);
      const titulo = [...a.querySelectorAll('h1, h2, h3, h4, h5, h6')].map(textoDe).find((t) => t && !ehData(t));
      const nome = titulo ?? partes.find((t) => !ehData(t) && !/rentabilidade/i.test(t)) ?? slug;
      vistas.set(slug, { slug, nome, url: `${url.origin}/carteiras/${slug}` });
    }
    return [...vistas.values()];
  });
}

// Espera a tabela recomendada (cabeçalho com "viés" ou "teto") ter linhas com ticker e parar de crescer.
// (Carteiras não assinadas já ficam de fora na lista, pelo cadeado do cartão.)
async function esperarTabela(pagina, tempo) {
  await pagina.waitForFunction(
    () => {
      const sem = (t) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
      const tabelas = [...document.querySelectorAll('main table')];
      return tabelas.some((t, i) => {
        const cab = [...t.querySelectorAll('thead th')].map((th) => sem(th.innerText)).join('|');
        if (!/vies|teto/.test(cab)) return false;
        const corpo = t.querySelectorAll('tbody tr').length > 1 ? t : tabelas[i + 1];
        return !!corpo && [...corpo.querySelectorAll('tbody tr')].some((tr) => /\b[A-Z][A-Z0-9]{3}\d{1,2}\b/.test(tr.innerText));
      });
    },
    null,
    { timeout: tempo, polling: 500 }
  );
  // As linhas podem chegar em partes: espera a contagem ficar igual por 2 segundos.
  let anterior = -1;
  for (let i = 0; i < 30; i++) {
    const n = await pagina.locator('main table tbody tr').count();
    if (n === anterior) break;
    anterior = n;
    await pagina.waitForTimeout(2000);
  }
  return 'PRONTA';
}

// Lê as tabelas da página de uma carteira. A Suno usa tabelas com o cabeçalho separado do corpo (o cabeçalho numa
// <table> e as linhas na seguinte), então cada cabeçalho fica com as linhas da tabela seguinte quando ele não tem.
// null: a tabela não carregou.
async function lerCarteira(pagina, carteira) {
  let carregou = false;
  for (let tentativa = 1; tentativa <= 2 && !carregou; tentativa++) {
    if (tentativa === 1) await pagina.goto(carteira.url, { waitUntil: 'domcontentloaded' });
    else {
      process.stdout.write('demorou, recarregando... ');
      await pagina.reload({ waitUntil: 'domcontentloaded' });
    }
    try {
      await esperarTabela(pagina, tentativa === 1 ? 90000 : 60000);
      carregou = true;
    } catch {
      // tenta de novo
    }
  }
  if (!carregou) return null;
  return pagina.evaluate(() => {
    const limpar = (t) => t.replace(/\s+/g, ' ').trim();
    const tabelas = [...document.querySelectorAll('main table')];
    const blocos = [];
    for (let i = 0; i < tabelas.length; i++) {
      const colunas = [...tabelas[i].querySelectorAll('thead th')].map((th) => limpar(th.innerText));
      if (colunas.length === 0) continue;
      let linhasTr = [...tabelas[i].querySelectorAll('tbody tr')].filter((tr) => tr.innerText.trim());
      if (linhasTr.length === 0 && tabelas[i + 1] && tabelas[i + 1].querySelectorAll('thead th').length === 0) {
        linhasTr = [...tabelas[i + 1].querySelectorAll('tbody tr')].filter((tr) => tr.innerText.trim());
      }
      // Cada célula: o texto em uma linha só (o ticker e o nome da empresa podem vir em linhas separadas).
      const linhas = linhasTr.map((tr) => [...tr.querySelectorAll('td')].map((td) => limpar(td.innerText).slice(0, 400)).slice(0, 40));
      // Título: o cabeçalho mais próximo antes da tabela.
      let titulo = null;
      let el = tabelas[i];
      for (let passos = 0; el && passos < 8 && !titulo; passos++) {
        let irmao = el.previousElementSibling;
        while (irmao && !titulo) {
          const h = irmao.matches('h1,h2,h3,h4') ? irmao : irmao.querySelector('h1,h2,h3,h4');
          if (h && limpar(h.innerText)) titulo = limpar(h.innerText).slice(0, 120);
          irmao = irmao.previousElementSibling;
        }
        el = el.parentElement;
      }
      blocos.push({ titulo, colunas: colunas.slice(0, 40), linhas: linhas.slice(0, 500) });
    }
    return blocos;
  });
}

// Plano da pessoa na Suno: no menu da conta, "Meu plano" mostra "Assinante <plano>" e as datas de início e fim da
// vigência. O botão do menu (ícone de pessoa no canto de cima) só aparece com a página estreita: a página fica
// estreita enquanto lê e volta ao tamanho de antes. Se o site mudar, devolve null e o resto segue.
export async function lerAssinatura(pagina) {
  const tamanho = pagina.viewportSize();
  try {
    await pagina.setViewportSize({ width: 627, height: 845 });
    await pagina.goto(INICIO, { waitUntil: 'domcontentloaded' });
    await pagina.waitForSelector('main a[href*="/carteiras/"]', { timeout: ESPERA_TABELA_MS });
    await pagina.waitForTimeout(1500);
    // Os cliques vão direto no elemento (não pela posição na tela): avisos e promoções que a Suno abre por cima
    // não atrapalham. O item "Meu plano" tem um selo "NOVO" junto, por isso a busca é pelo começo do texto.
    const abriu = await pagina.evaluate(() => {
      const largura = innerWidth;
      const el = [...document.querySelectorAll('button')].find((b) => {
        const r = b.getBoundingClientRect();
        return r.top < 60 && r.left > largura - 90 && r.width > 15 && r.width < 70;
      });
      if (!el) return false;
      el.click();
      return true;
    });
    if (!abriu) return null;
    await pagina.waitForFunction(
      () =>
        [...document.querySelectorAll('*')].some(
          (e) => /^\s*Meu plano/.test(e.textContent || '') && (e.textContent || '').length < 40 && e.getBoundingClientRect().width > 0
        ),
      null,
      { timeout: 15000 }
    );
    await pagina.evaluate(() => {
      const candidatos = [...document.querySelectorAll('*')].filter(
        (e) => /^\s*Meu plano/.test(e.textContent || '') && (e.textContent || '').length < 40 && e.getBoundingClientRect().width > 0
      );
      const alvo = candidatos.find((e) => /pointer/.test(getComputedStyle(e).cursor)) ?? candidatos[candidatos.length - 1];
      alvo?.click();
    });
    await pagina.waitForFunction(() => /fim da vig/i.test(document.body.innerText), null, { timeout: 15000 });
    return await pagina.evaluate(() => {
      const texto = document.body.innerText;
      const iso = (d) => (d ? `${d.slice(6, 10)}-${d.slice(3, 5)}-${d.slice(0, 2)}` : null);
      const m = /Assinante\s+([^\n]+)[\s\S]{0,200}?(\d{2}\.\d{2}\.\d{4})\s*\n+\s*in[ií]cio da vig[eê]ncia\s*\n+\s*(\d{2}\.\d{2}\.\d{4})\s*\n+\s*fim da vig/i.exec(texto);
      const doTopo = /Sua assinatura [eé]\s*\n*\s*([^\n]+)/i.exec(texto);
      const plano = (m?.[1] ?? doTopo?.[1] ?? '').trim();
      if (!plano) return null;
      return { plano: plano.slice(0, 80), inicio: iso(m?.[2]), fim: iso(m?.[3]) };
    });
  } catch {
    return null;
  } finally {
    if (tamanho) await pagina.setViewportSize(tamanho).catch(() => undefined);
  }
}

function semAcento(t) {
  return t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

// Classifica as tabelas: a recomendada tem "viés" ou "teto"; a de encerradas tem "encerramento".
function classificar(blocos) {
  let recomendada = null;
  let encerradas = null;
  const outras = [];
  for (const b of blocos) {
    const cols = b.colunas.map(semAcento).join('|');
    const tabela = { colunas: b.colunas, linhas: b.linhas };
    if (!recomendada && /vies|teto/.test(cols) && b.linhas.length > 0) recomendada = tabela;
    else if (!encerradas && /encerramento/.test(cols)) encerradas = tabela;
    else if (b.linhas.length > 0 && outras.length < 10) outras.push({ titulo: b.titulo, ...tabela });
  }
  return { recomendada, encerradas, outras };
}

// Tudo o que o sistema guarda: as carteiras assinadas (com as tabelas) e o plano. `aviso` recebe o andamento.
export async function lerTudo(pagina, aviso = () => undefined) {
  const lista = await listarCarteiras(pagina);
  aviso(`Carteiras encontradas: ${lista.map((c) => c.nome).join(', ')}`);
  const carteiras = [];
  for (const c of lista) {
    const blocos = await lerCarteira(pagina, c);
    if (!blocos || blocos.length === 0) {
      aviso(`${c.nome}: a tabela não carregou em 2 tentativas, pulei.`);
      continue;
    }
    const tabelas = classificar(blocos);
    const n = tabelas.recomendada?.linhas.length ?? 0;
    aviso(`${c.nome}: ${n} ativos recomendados${tabelas.encerradas ? `, ${tabelas.encerradas.linhas.length} encerrados` : ''}.`);
    carteiras.push({ ...c, ...tabelas });
  }
  if (carteiras.length === 0) throw new Error('Nenhuma carteira com tabela foi encontrada.');
  const assinatura = await lerAssinatura(pagina);
  aviso(assinatura ? `Plano: ${assinatura.plano}${assinatura.fim ? `, vigente até ${assinatura.fim.split('-').reverse().join('/')}` : ''}.` : 'Plano: não encontrei (segue sem).');
  return { carteiras, assinatura };
}
