/**
 * Formulários do BKO de conteúdo (RF-CAT-07), puros e testáveis: texto da tela ↔ contrato. A API revalida tudo
 * (Zod + domain); aqui só a conversão com mensagem em português.
 */
import { BOM_CSV } from '@macuxi/comum/csv';
import { SalvarCadastroCatalogo, SalvarConteudo, SalvarSinonimo, type FichaProduto, type ItemVitrine, type Sinonimo } from '../../contracts';
import { LIMITES_CADASTRO_CATALOGO, validarCadastroCatalogo } from '../../domain/cadastro-catalogo';

export interface FormConteudo {
  descricao: string;
  /** Um argumento de venda por linha. */
  argumentos: string;
  /** Uma pergunta por bloco: "P: ..." e "R: ..." em linhas seguidas. */
  faq: string;
  /** Um atributo por linha: "Nome: valor". */
  atributos: string;
}

const linhas = (s: string) =>
  s
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

export function formDaFicha(f: Pick<FichaProduto, 'content' | 'attributes'>): FormConteudo {
  return {
    descricao: f.content.description ?? '',
    argumentos: f.content.selling_points.join('\n'),
    faq: f.content.faq.map((q) => `P: ${q.question}\nR: ${q.answer}`).join('\n'),
    atributos: f.attributes.map((a) => `${a.name}: ${a.value}`).join('\n'),
  };
}

type Problema = { path: PropertyKey[]; message: string };

const CAMPOS_CONTEUDO: Record<string, string> = { description: 'Descrição', selling_points: 'Argumentos de venda', faq: 'Perguntas frequentes', attributes: 'Ficha técnica' };

/** Conteúdo: nunca o caminho técnico do campo (ex.: `faq.0.answer`), só o nome que a tela mostra. */
export function mensagemDoConteudo(i: Problema): string {
  const nome = CAMPOS_CONTEUDO[String(i.path[0])];
  return nome ? `${nome}: ${i.message}` : i.message;
}

/** Cadastro do Catálogo: mensagens da spec docs/design/catalogo-aplicacao.md §4.1 no lugar de "Confira o campo referencias.0.codigo". */
export function mensagemDoCadastro(i: Problema): string {
  const [campo, indice] = i.path;
  if (campo === 'referencias' && typeof indice === 'number') return `Código ${indice + 1}: use até ${LIMITES_CADASTRO_CATALOGO.codigo} caracteres.`;
  if (campo === 'referencias') return `Use até ${LIMITES_CADASTRO_CATALOGO.referencias} referências de concorrente.`;
  if (campo === 'oferece_junto' || campo === 'oferece_junto_codigos') return `Oferece junto: use até ${LIMITES_CADASTRO_CATALOGO.ofereceJunto} produtos.`;
  if (campo === 'etiquetas') return `Use até ${LIMITES_CADASTRO_CATALOGO.etiquetas} etiquetas, com até ${LIMITES_CADASTRO_CATALOGO.etiqueta} caracteres cada.`;
  if (campo === 'aplicacao') return `Aplicação: ${i.message}`;
  return i.message;
}

export type ResultadoForm<T> = { ok: true; valor: T } | { ok: false; erro: string };

/** Formulário → corpo do `PUT produtos/:id/conteudo`. */
export function conteudoDoForm(f: FormConteudo): ResultadoForm<SalvarConteudo> {
  const attributes: { name: string; value: string }[] = [];
  for (const l of linhas(f.atributos)) {
    const i = l.indexOf(':');
    if (i <= 0 || !l.slice(i + 1).trim()) return { ok: false, erro: `Atributo "${l}": use o formato "Nome: valor", um por linha.` };
    attributes.push({ name: l.slice(0, i).trim(), value: l.slice(i + 1).trim() });
  }
  const faq: { question: string; answer: string }[] = [];
  let pergunta: string | null = null;
  for (const l of linhas(f.faq)) {
    const m = /^([PpRr])\s*:\s*(.*)$/.exec(l);
    if (!m) return { ok: false, erro: `FAQ: comece cada linha com "P:" (pergunta) ou "R:" (resposta). Linha: "${l}".` };
    if (m[1]!.toUpperCase() === 'P') {
      if (pergunta !== null) return { ok: false, erro: `FAQ: a pergunta "${pergunta}" está sem resposta.` };
      pergunta = m[2]!.trim();
    } else {
      if (pergunta === null) return { ok: false, erro: 'FAQ: há uma resposta sem pergunta antes.' };
      faq.push({ question: pergunta, answer: m[2]!.trim() });
      pergunta = null;
    }
  }
  if (pergunta !== null) return { ok: false, erro: `FAQ: a pergunta "${pergunta}" está sem resposta.` };
  const r = SalvarConteudo.safeParse({ description: f.descricao.trim() || null, selling_points: linhas(f.argumentos), faq, attributes });
  if (!r.success) {
    return { ok: false, erro: mensagemDoConteudo(r.error.issues[0]!) };
  }
  return { ok: true, valor: r.data };
}

// ---------- seção Catálogo do cadastro do produto (T-0085 K9; RN-CAT-09, RN-CAT-11) ----------
export interface FormCadastroCatalogo {
  aplicacao: string;
  /** Códigos ERP dos produtos de "Oferece junto", um por linha (até 5). */
  ofereceJunto: string;
  /** Uma linha por referência (até 3): marca escolhida da lista + código. */
  referencias: { marca_id: string; codigo: string }[];
  /** Separadas por vírgula (até 4, de até 20 caracteres). */
  etiquetas: string;
}

/** As 3 linhas de referência sempre aparecem; as sem marca e sem código ficam de fora ao salvar. */
export function formCadastroDaFicha(f: Pick<FichaProduto, 'catalogo'>): FormCadastroCatalogo {
  const c = f.catalogo;
  const refs = (c?.referencias ?? []).map((r) => ({ marca_id: r.marca_id ?? '', codigo: r.codigo }));
  while (refs.length < LIMITES_CADASTRO_CATALOGO.referencias) refs.push({ marca_id: '', codigo: '' });
  return { aplicacao: c?.aplicacao ?? '', ofereceJunto: (c?.oferece_junto ?? []).map((o) => o.erp_code).join('\n'), referencias: refs, etiquetas: (c?.etiquetas ?? []).join(', ') };
}

/**
 * Formulário → corpo do `PUT produtos/:id/cadastro-catalogo`. `idsPorCodigo` traduz o código ERP digitado em "Oferece junto"
 * para o id do produto (a lista de produtos da tela, sem diferenciar maiúsculas). Código que a tela não conhece vai em
 * `oferece_junto_codigos` e o servidor resolve (produto fora da página carregada; 422 se não existir). A mesma
 * `validarCadastroCatalogo` da API confere os limites.
 */
export function cadastroCatalogoDoForm(
  produtoId: string,
  f: FormCadastroCatalogo,
  opcoes: { idsPorCodigo: ReadonlyMap<string, string>; aplicacaoMax: number; semReferencias?: boolean },
): ResultadoForm<SalvarCadastroCatalogo> {
  const oferece: string[] = [];
  const codigosNoServidor: string[] = [];
  const minusculas = new Map([...opcoes.idsPorCodigo].map(([c, id]) => [c.trim().toLowerCase(), id]));
  for (const codigo of linhas(f.ofereceJunto)) {
    const id = minusculas.get(codigo.trim().toLowerCase());
    if (id) oferece.push(id);
    else codigosNoServidor.push(codigo);
  }
  // sem marcas carregadas o servidor não conhece as referências: não manda a lista (ausente = não mexe)
  const referencias = opcoes.semReferencias ? [] : f.referencias.filter((r) => r.marca_id !== '' || r.codigo.trim() !== '');
  for (const r of referencias) {
    // a marca é opcional (RN-CAT-09): só o código é obrigatório
    if (r.codigo.trim() === '') return { ok: false, erro: 'Há uma marca sem código. Informe o código do concorrente ou tire a marca.' };
  }
  const corpo = SalvarCadastroCatalogo.safeParse({
    aplicacao: f.aplicacao.trim() === '' ? null : f.aplicacao.trim(),
    oferece_junto: oferece,
    ...(codigosNoServidor.length > 0 ? { oferece_junto_codigos: codigosNoServidor } : {}),
    referencias: opcoes.semReferencias ? undefined : referencias.map((r) => ({ marca_id: r.marca_id === '' ? null : r.marca_id, codigo: r.codigo.trim() })),
    etiquetas: f.etiquetas.split(',').map((e) => e.trim()).filter(Boolean),
  });
  if (!corpo.success) return { ok: false, erro: mensagemDoCadastro(corpo.error.issues[0]!) };
  const erros = validarCadastroCatalogo(produtoId, corpo.data, { aplicacaoMax: opcoes.aplicacaoMax });
  if (erros.length > 0) return { ok: false, erro: erros[0]!.mensagem };
  return { ok: true, valor: corpo.data };
}

export interface FormSinonimo {
  termo: string;
  /** Separados por vírgula. */
  sinonimos: string;
  ativo: boolean;
}

export const formDoSinonimo = (s: Sinonimo): FormSinonimo => ({ termo: s.term, sinonimos: s.synonyms.join(', '), ativo: s.active });

/** Formulário → corpo do `PUT sinonimos/:id`. */
export function sinonimoDoForm(f: FormSinonimo): ResultadoForm<SalvarSinonimo> {
  const r = SalvarSinonimo.safeParse({ term: f.termo, synonyms: f.sinonimos.split(',').map((s) => s.trim()).filter(Boolean), active: f.ativo });
  if (!r.success) return { ok: false, erro: r.error.issues[0]!.message };
  return { ok: true, valor: r.data };
}

const celula = (v: string | number | null | undefined) => {
  const s = v === null || v === undefined ? '' : String(v);
  return /[;"\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** CSV dos produtos da tela (padrão do Excel brasileiro: `;`, CRLF e BOM). */
export function produtosParaCsv(itens: readonly ItemVitrine[]): string {
  const cab = ['Código', 'Produto', 'Marca', 'Categoria', 'Unidade', 'EAN', 'Destaque'];
  const corpo = itens.map((i) => [i.erp_code, i.description, i.brand, i.line, i.unit, i.ean ?? '', i.is_campaign ? 'Sim' : 'Não']);
  return BOM_CSV + [cab, ...corpo].map((r) => r.map(celula).join(';')).join('\r\n') + '\r\n';
}

export type AbaBko = 'produtos' | 'sinonimos' | 'sem-resultado';
export interface FiltrosBko {
  aba: AbaBko;
  q: string;
  /** Nível da hierarquia aberto (RF-CAT-09): id do nível ou `sem-linha`; vazio = começo. */
  no: string;
}
const ABAS: readonly AbaBko[] = ['produtos', 'sinonimos', 'sem-resultado'];

/** Filtros na URL (`?aba=&q=&no=`; o filtro "Categoria" saiu: a hierarquia o substitui), para o link da tela abrir no mesmo lugar. */
export function lerFiltrosBko(busca: string): FiltrosBko {
  const p = new URLSearchParams(busca);
  const aba = p.get('aba') as AbaBko | null;
  return { aba: aba && ABAS.includes(aba) ? aba : 'produtos', q: p.get('q') ?? '', no: p.get('no') ?? '' };
}

export function buscaDosFiltros(f: FiltrosBko): string {
  const p = new URLSearchParams();
  if (f.aba !== 'produtos') p.set('aba', f.aba);
  if (f.q) p.set('q', f.q);
  if (f.no) p.set('no', f.no);
  const s = p.toString();
  return s ? `?${s}` : '';
}

/**
 * Mapa código ERP → id para o "Oferece junto" (T-0085): junta as páginas carregadas com os itens que a própria ficha já
 * oferece, para que um complementar existente fora da página carregada não trave o "Salvar catálogo".
 */
export function mapaIdsPorCodigo(produtos: readonly Pick<ItemVitrine, 'erp_code' | 'id'>[], ofereceJunto: readonly { erp_code: string; produto_id: string }[] = []): Map<string, string> {
  const mapa = new Map<string, string>();
  for (const o of ofereceJunto) mapa.set(o.erp_code, o.produto_id);
  for (const p of produtos) mapa.set(p.erp_code, p.id);
  return mapa;
}

/** RN-CAT-11: limite da Aplicação do tenant (`aplicacao_max_cadastro`, 100 a 2.000); sem o parâmetro vale o padrão 2.000. */
export function limiteAplicacao(parametros: Readonly<Record<string, unknown>>): number {
  const v = parametros['aplicacao_max_cadastro'];
  return typeof v === 'number' && Number.isInteger(v) && v >= 100 && v <= 2000 ? v : 2000;
}

/** UX B2: "1.234 / 2.000", em vermelho (`excede`) quando passa do limite. */
export function contadorAplicacao(tamanho: number, max: number): { texto: string; excede: boolean } {
  return { texto: `${tamanho.toLocaleString('pt-BR')} / ${max.toLocaleString('pt-BR')}`, excede: tamanho > max };
}

/** UX B4: o nome do produto embaixo de cada código achado em "Oferece junto" (`null` = código não achado ainda). */
export function nomesDoOfereceJunto(
  texto: string,
  produtos: readonly { erp_code: string; description: string }[],
  ofereceJunto: readonly { erp_code: string; description: string }[] = [],
): { codigo: string; rotulo: string | null }[] {
  const nomes = new Map<string, string>();
  for (const o of [...ofereceJunto, ...produtos]) nomes.set(o.erp_code.toLowerCase(), o.description);
  return texto
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((codigo) => {
      const nome = nomes.get(codigo.toLowerCase());
      return { codigo, rotulo: nome ? `${codigo} · ${nome}` : null };
    });
}

/** UX (T-0089 K3): texto do diálogo de remover a faixa escalonada. */
export function textoRemoverFaixa(quantidadeMinima: number, produto: string): { titulo: string; corpo: string } {
  return { titulo: `Remover a faixa de ${quantidadeMinima} para ${produto}?`, corpo: 'O vendedor deixa de ver esta faixa no pedido na próxima sincronização.' };
}

/** Editores do produto abertos (Conteúdo e Catálogo): cada um abre e fecha sem afetar o outro nem perder o texto não salvo. */
export interface EditoresAbertos<T> {
  conteudo: T | null;
  catalogo: T | null;
}
export const EDITORES_FECHADOS: EditoresAbertos<never> = { conteudo: null, catalogo: null };
export function abrirEditores<T>(item: T): EditoresAbertos<T> {
  return { conteudo: item, catalogo: item };
}
/** Quem não tem `produto.enriquecer` só olha a seção Catálogo (aplicação, oferece junto, referências, etiquetas), sem editar o conteúdo. */
export function abrirParaLeitura<T>(item: T): EditoresAbertos<T> {
  return { conteudo: null, catalogo: item };
}
export function fecharEditor<T>(atual: EditoresAbertos<T>, qual: keyof EditoresAbertos<T>): EditoresAbertos<T> {
  return { ...atual, [qual]: null };
}

/* ---- Seletor reordenável do "Oferece junto" (B6 de UX, T-0085): o texto do formulário segue com um código por linha ---- */

/** Códigos do "Oferece junto" na ordem em que o vendedor vê (sem linhas vazias). */
export function listaOfereceJunto(texto: string): string[] {
  return texto
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
}

function textoDaLista(codigos: readonly string[]): string {
  return codigos.join('\n');
}

/** Põe o código no fim da lista; repetido (sem diferenciar maiúsculas) ou acima do limite não entra e devolve o motivo em português. */
export function adicionarOfereceJunto(texto: string, codigo: string, max: number): { texto: string; erro: string | null } {
  const lista = listaOfereceJunto(texto);
  const novo = codigo.trim();
  if (novo === '') return { texto, erro: 'Escolha um produto da lista para adicionar.' };
  if (lista.some((c) => c.toLowerCase() === novo.toLowerCase())) return { texto, erro: `${novo} já está na lista.` };
  if (lista.length >= max) return { texto, erro: `Use até ${max} produtos. Tire um para colocar outro.` };
  return { texto: textoDaLista([...lista, novo]), erro: null };
}

export function removerOfereceJunto(texto: string, indice: number): string {
  return textoDaLista(listaOfereceJunto(texto).filter((_, i) => i !== indice));
}

/** Troca o item de lugar (`delta` -1 sobe, +1 desce); nos extremos não muda nada. */
export function moverOfereceJunto(texto: string, indice: number, delta: number): string {
  const lista = listaOfereceJunto(texto);
  const destino = indice + delta;
  if (indice < 0 || indice >= lista.length || destino < 0 || destino >= lista.length) return textoDaLista(lista);
  const item = lista[indice] as string;
  lista.splice(indice, 1);
  lista.splice(destino, 0, item);
  return textoDaLista(lista);
}

/** Teclado do item da lista: Alt+Seta sobe/desce, Home/End levam ao começo/fim com Alt, Delete remove. `null` = tecla não tratada. */
export function acaoTecladoOfereceJunto(tecla: { key: string; altKey?: boolean }, indice: number, total: number): { tipo: 'mover'; para: number } | { tipo: 'remover' } | null {
  if (tecla.key === 'Delete') return { tipo: 'remover' };
  if (!tecla.altKey) return null;
  const alvo = tecla.key === 'ArrowUp' ? indice - 1 : tecla.key === 'ArrowDown' ? indice + 1 : tecla.key === 'Home' ? 0 : tecla.key === 'End' ? total - 1 : null;
  if (alvo === null || alvo < 0 || alvo >= total || alvo === indice) return null;
  return { tipo: 'mover', para: alvo };
}

/** Texto para o leitor de tela (aria-live) depois de mexer na lista; posições contadas a partir de 1. */
export function anuncioOfereceJunto(acao: 'moveu' | 'removeu', rotulo: string, posicao: number, total: number): string {
  return acao === 'removeu' ? `${rotulo} removido. ${total} ${total === 1 ? 'produto' : 'produtos'} na lista.` : `${rotulo} na posição ${posicao} de ${total}.`;
}

/** Sugestões do seletor: por código ou nome, sem as já escolhidas e sem o próprio produto; no máximo `limite`. */
export function sugestoesOfereceJunto(
  produtos: readonly { erp_code: string; description: string }[],
  termo: string,
  escolhidos: readonly string[],
  proprio: string,
  limite = 8,
): { erp_code: string; description: string }[] {
  const t = termo.trim().toLowerCase();
  if (t === '') return [];
  const fora = new Set([...escolhidos, proprio].map((c) => c.toLowerCase()));
  return produtos.filter((p) => !fora.has(p.erp_code.toLowerCase()) && (p.erp_code.toLowerCase().includes(t) || p.description.toLowerCase().includes(t))).slice(0, limite);
}
