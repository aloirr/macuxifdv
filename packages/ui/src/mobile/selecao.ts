/**
 * Parte PURA dos campos de escolha do Novo pedido (T-0089, fatia U1; referência
 * docs/produto/referencias/R-20261106-0703-alexandre-novo-pedido-itens-v2.png):
 * - lista suspensa (Forma de pagamento, Prazo, tipo do ajuste): motivo e leitura da opção desabilitada, altura e posição do
 *   menu ancorado;
 * - campo de ajuste (Desc %, Desc R$, Acrésc %, Acrésc R$): leitura e saneamento do decimal digitado;
 * - passo compacto (− n +): medidas e o passo a partir do texto em edição (o "+" com o teclado aberto);
 * - textos dos cartões "Crédito do cliente" e "Leve mais e pague menos" (aprovados na spec docs/design/novo-pedido-itens.md).
 * Sem react-native: roda em Node (Vitest) e é reexportado por `@macuxi/ui/mobile/puro`. Sem regra de negócio: quem decide se
 * o prazo é permitido, o limite do desconto ou a próxima faixa é o domain do módulo; aqui só se mostra e se lê.
 */
import { formatBRL, type Cents } from '@macuxi/comum/money';
import { dateTimeLabel } from '@macuxi/comum/fuso';

import { ALVO_TOQUE, lerQuantidade, proximoPasso } from './componentes';
import { plural } from './text';
import { colors } from './tokens';

// ---------- lista suspensa ----------

/**
 * Opção de lista suspensa. A opção desabilitada mostra o `motivo` na tela, numa linha secundária abaixo do rótulo, e o leitor de
 * tela lê os dois (T-0129). O rótulo continua só o valor ("30/60/90 dias", RN-VEN-25): o motivo nunca entra no rótulo.
 */
export interface OpcaoLista<T extends string = string> {
  id: T;
  rotulo: string;
  desabilitada?: boolean;
  /** Por que está desabilitada (ex.: "Acima do prazo médio do cliente"). Aparece abaixo do rótulo, só na opção desabilitada. */
  motivo?: string | null;
  /** Leitura completa quando o rótulo é abreviado ("Desc %" → "Desconto em porcentagem"). */
  rotuloAcessivel?: string;
  testID?: string;
}

/** Motivo que a opção mostra na tela: só na desabilitada e com texto; senão, null (a opção fica numa linha só). */
export function motivoVisivel(o: Pick<OpcaoLista, 'desabilitada' | 'motivo'>): string | null {
  const m = o.desabilitada ? (o.motivo ?? '').trim() : '';
  return m || null;
}

/** Leitura da opção no TalkBack: o rótulo e, se desabilitada com motivo, o motivo ("30/60/90 dias. Acima do prazo médio do cliente"). */
export function leituraDaOpcao(o: Pick<OpcaoLista, 'rotulo' | 'rotuloAcessivel' | 'desabilitada' | 'motivo'>): string {
  const base = (o.rotuloAcessivel ?? o.rotulo).trim();
  const motivo = motivoVisivel(o);
  return motivo ? `${base}. ${motivo}` : base;
}

/** Texto do campo fechado: o rótulo da opção marcada; sem marcada (ou id que não está na lista), o placeholder. */
export function textoDaSelecao<T extends string>(opcoes: ReadonlyArray<OpcaoLista<T>>, valor: T | null | undefined, placeholder: string): { texto: string; vazio: boolean } {
  const o = valor === null || valor === undefined ? undefined : opcoes.find((x) => x.id === valor);
  return o ? { texto: o.rotulo, vazio: false } : { texto: placeholder, vazio: true };
}

/** Altura de cada opção do menu (alvo de toque). */
export const ALTURA_OPCAO_MENU = ALVO_TOQUE;
/** Opções visíveis sem rolar; mais que isso, o menu rola. */
export const MAX_OPCOES_VISIVEIS = 5;

/**
 * Linha do motivo na opção desabilitada (T-0129): 12/16, até 2 linhas, no tom neutro `ink2` sobre o fundo da opção desabilitada
 * (`ground`), 6,87:1 (AA). O rótulo da opção fica em `inkDisabled` com cadeado; o motivo não fica apagado, porque é o que a pessoa
 * precisa ler para resolver.
 */
export const MOTIVO_OPCAO = { cor: colors.ink2, fundo: colors.ground, tamanhoFonte: 12, alturaLinha: 16, linhas: 2 } as const;
/** Respiro em cima e embaixo da opção com motivo (a de uma linha só centraliza nos 48 dp). */
export const RESPIRO_OPCAO_COM_MOTIVO = 8;
/** Altura do rótulo da opção (15/20) e espaço entre o rótulo e o motivo. */
const ALTURA_ROTULO_OPCAO = 20;
const ESPACO_ROTULO_MOTIVO = 2;
/** Altura máxima da opção com motivo (motivo em 2 linhas): 8 + 20 + 2 + 32 + 8 = 70 dp. */
export const ALTURA_OPCAO_COM_MOTIVO = Math.max(
  ALVO_TOQUE,
  2 * RESPIRO_OPCAO_COM_MOTIVO + ALTURA_ROTULO_OPCAO + ESPACO_ROTULO_MOTIVO + MOTIVO_OPCAO.linhas * MOTIVO_OPCAO.alturaLinha,
);

/**
 * Altura do conteúdo do menu sem rolar: as primeiras `maxVisiveis` opções (a com motivo conta 70 dp, as outras 48) mais a borda.
 * É um teto: a opção com motivo curto ocupa menos, e o menu encolhe ao conteúdo.
 */
export function alturaDoMenu(opcoes: ReadonlyArray<Pick<OpcaoLista, 'desabilitada' | 'motivo'>>, maxVisiveis = MAX_OPCOES_VISIVEIS): number {
  const visiveis = opcoes.slice(0, Math.max(1, maxVisiveis));
  const soma = visiveis.reduce((t, o) => t + (motivoVisivel(o) ? ALTURA_OPCAO_COM_MOTIVO : ALTURA_OPCAO_MENU), 0);
  return Math.max(ALTURA_OPCAO_MENU, soma) + 2;
}
/** Distância mínima do menu até a borda da janela. */
export const MARGEM_MENU = 8;
/** Espaço entre o campo e o menu. */
export const FOLGA_MENU = 4;

export interface Retangulo {
  x: number;
  y: number;
  largura: number;
  altura: number;
}

export interface PosicaoMenu {
  left: number;
  width: number;
  /** Menu abaixo do campo: distância do topo da janela. */
  top?: number;
  /** Menu acima do campo (sem espaço embaixo): distância da base da janela. */
  bottom?: number;
  maxHeight: number;
  acima: boolean;
}

/**
 * Onde abrir o menu da lista suspensa, em coordenadas da janela: logo abaixo do campo, com a largura dele (ou `larguraMinima`,
 * para o tipo do ajuste, que é estreito); sem espaço embaixo e com mais espaço em cima, abre acima. Nunca sai da janela.
 */
export function posicaoDoMenu({
  campo,
  janela,
  quantidade,
  larguraMinima = 0,
  alturaOpcao = ALTURA_OPCAO_MENU,
  maxVisiveis = MAX_OPCOES_VISIVEIS,
  alturaConteudo,
}: {
  campo: Retangulo;
  janela: { largura: number; altura: number };
  quantidade: number;
  larguraMinima?: number;
  alturaOpcao?: number;
  maxVisiveis?: number;
  /** Altura do conteúdo sem rolar (use `alturaDoMenu(opcoes)` quando alguma opção mostra motivo); sem ela, quantidade × alturaOpcao. */
  alturaConteudo?: number;
}): PosicaoMenu {
  const desejada = alturaConteudo ?? Math.max(1, Math.min(Math.max(0, quantidade), maxVisiveis)) * alturaOpcao + 2;
  const espacoAbaixo = janela.altura - (campo.y + campo.altura) - FOLGA_MENU - MARGEM_MENU;
  const espacoAcima = campo.y - FOLGA_MENU - MARGEM_MENU;
  const largura = Math.min(Math.max(campo.largura, larguraMinima), Math.max(0, janela.largura - 2 * MARGEM_MENU));
  const left = Math.round(Math.min(Math.max(campo.x, MARGEM_MENU), Math.max(MARGEM_MENU, janela.largura - MARGEM_MENU - largura)));
  const abaixo = espacoAbaixo >= desejada || espacoAbaixo >= espacoAcima;
  if (abaixo) {
    return { left, width: Math.round(largura), top: Math.round(campo.y + campo.altura + FOLGA_MENU), maxHeight: Math.max(alturaOpcao, Math.round(Math.min(desejada, espacoAbaixo))), acima: false };
  }
  return { left, width: Math.round(largura), bottom: Math.round(janela.altura - campo.y + FOLGA_MENU), maxHeight: Math.max(alturaOpcao, Math.round(Math.min(desejada, espacoAcima))), acima: true };
}

// ---------- campo de ajuste (desconto ou acréscimo) ----------

/** Os 4 tipos do ajuste do item (R-20261106-064756): o módulo usa estes ids e rótulos, ou passa os seus. */
export type TipoAjuste = 'desc_pct' | 'desc_reais' | 'acresc_pct' | 'acresc_reais';

export const TIPOS_AJUSTE: ReadonlyArray<OpcaoLista<TipoAjuste>> = [
  { id: 'desc_pct', rotulo: 'Desc %', rotuloAcessivel: 'Desconto em porcentagem' },
  { id: 'desc_reais', rotulo: 'Desc R$', rotuloAcessivel: 'Desconto em reais' },
  { id: 'acresc_pct', rotulo: 'Acrésc %', rotuloAcessivel: 'Acréscimo em porcentagem' },
  { id: 'acresc_reais', rotulo: 'Acrésc R$', rotuloAcessivel: 'Acréscimo em reais' },
];

/**
 * Saneia o texto digitado no campo decimal: só dígitos e uma vírgula (o ponto vira vírgula), no máximo `casas` depois dela.
 * "3.5" → "3,5"; "3,456" (2 casas) → "3,45"; "a1" → "1"; "," → "0,".
 */
export function sanearDecimal(texto: string, casas = 2): string {
  const t = texto.replace(/\./g, ',').replace(/[^\d,]/g, '');
  const i = t.indexOf(',');
  if (i < 0) return t;
  const inteiro = t.slice(0, i) || '0';
  if (casas <= 0) return inteiro;
  const fracao = t.slice(i + 1).replace(/,/g, '').slice(0, casas);
  return `${inteiro},${fracao}`;
}

/** Lê o decimal digitado ("3,0", "3.5", "1.234,56"). Sem dígito → null (a tela mantém o valor anterior). */
export function lerDecimal(texto: string): number | null {
  const t = texto.trim().replace(/\s/g, '');
  if (!/\d/.test(t)) return null;
  const normal = t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t;
  const n = Number.parseFloat(normal.replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) ? n : null;
}

/** "3" → "3,0" (1 casa); 12.5 com 2 casas → "12,50". */
export function textoDecimal(valor: number, casas = 1): string {
  if (!Number.isFinite(valor)) return '';
  return valor.toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas, useGrouping: false });
}

// ---------- passo compacto (− n +) do item ----------

/**
 * Medidas do passo compacto da linha 3 do item (R-20261106-064754/064756): a caixa "− n +" tem 30 dp de altura e botões de
 * 32 dp de largura (visual próximo do `.qty` da referência), mas cada botão é um alvo de 44 × 44 dp DENTRO do contêiner
 * (no Android o `hitSlop` não passa da borda do pai, então o alvo não pode depender de folga). O alvo de cada botão passa
 * `recuo` dp para fora da caixa desenhada, do lado de fora; o lado de dentro encosta no número.
 */
export const PASSO_COMPACTO = { botao: 32, altura: 30, valor: 36, alvo: 44, recuo: 12, largura: 44 + 36 + 44 } as const;

/**
 * Segmentado compacto (UN | CX na linha 3 do item): visual de 30 dp, cada opção com alvo de 44 × 44 dp do próprio botão e
 * `vao` dp entre as opções (o `gap` do `.seg`). A largura mínima sai daqui para a tela não repetir a conta.
 */
export const SEGMENTADO_COMPACTO = { altura: PASSO_COMPACTO.altura, alvo: PASSO_COMPACTO.alvo, vao: 6 } as const;

/** Largura do Segmentado compacto com `n` opções sem transbordar nem encolher o alvo: 2 → 94 dp, 3 → 144 dp. */
export function larguraSegmentadoCompacto(n: number): number {
  const k = Math.max(1, Math.trunc(n));
  return k * SEGMENTADO_COMPACTO.alvo + (k - 1) * SEGMENTADO_COMPACTO.vao;
}

/** Alvo efetivo do botão do passo compacto (largura × altura em dp), sem folga: é o tamanho do próprio botão. */
export function alvoDoPassoCompacto(): { largura: number; altura: number } {
  return { largura: PASSO_COMPACTO.alvo, altura: PASSO_COMPACTO.alvo };
}

/**
 * Próximo valor ao tocar − ou + com o número possivelmente em edição: com o campo focado e um número digitado, o passo parte
 * do digitado (digitar 5 e tocar + dá 6); senão, do valor confirmado. Corrige o "+" que não respondia com o teclado aberto.
 */
export function passoComTexto(
  estado: { texto: string; focado: boolean; valor: number },
  direcao: -1 | 1,
  passo = 1,
  min = 0,
  max?: number,
): number {
  const digitado = estado.focado ? lerQuantidade(estado.texto) : null;
  return proximoPasso(digitado ?? estado.valor, direcao, passo, min, max);
}

// ---------- textos dos cartões do Detalhes (spec docs/design/novo-pedido-itens.md) ----------

/**
 * Alerta de inadimplência do cartão "Crédito do cliente" (RN-VEN-13):
 * "Cliente inadimplente: 2 títulos vencidos · R$ 480,00 · há 12 dias. Só à vista ou com aprovação."
 * `dias` é o atraso do título mais antigo. `consequencia` vem do módulo (null = sem a frase final).
 */
export function textoInadimplencia({ titulos, valorCents, dias, consequencia }: { titulos: number; valorCents: Cents; dias: number; consequencia?: string | null }): string {
  const qtd = plural(Math.max(0, Math.trunc(titulos)), 'título vencido', 'títulos vencidos');
  const d = Math.max(0, Math.trunc(dias));
  const quando = d === 0 ? 'vence hoje' : d === 1 ? 'há 1 dia' : `há ${d} dias`;
  const fim = (consequencia ?? '').trim();
  return `Cliente inadimplente: ${qtd} · ${formatBRL(valorCents)} · ${quando}.${fim ? ` ${fim.endsWith('.') ? fim : `${fim}.`}` : ''}`;
}

/**
 * Alerta de inadimplência da caixa Alertas da aba Venda (T-0133, desenho do dono do produto de 08/11 tarde), em 2 linhas
 * para a `Faixa` (`texto` + `apoio`): "Cliente inadimplente · 1 título vencido · R$ 3.400,00 · 12 dias" e
 * "Só à vista ou com aprovação". `dias` é o atraso do título mais antigo; `consequencia` vem do módulo (null = sem 2ª linha).
 */
export function alertaInadimplencia({ titulos, valorCents, dias, consequencia }: { titulos: number; valorCents: Cents; dias: number; consequencia?: string | null }): { texto: string; apoio: string | null } {
  const qtd = plural(Math.max(0, Math.trunc(titulos)), 'título vencido', 'títulos vencidos');
  const d = Math.max(0, Math.trunc(dias));
  const quando = d === 0 ? 'vence hoje' : d === 1 ? '1 dia' : `${d} dias`;
  const fim = (consequencia ?? '').trim().replace(/\.$/, '');
  return { texto: `Cliente inadimplente · ${qtd} · ${formatBRL(valorCents)} · ${quando}`, apoio: fim || null };
}

/** A linha única da caixa Alertas quando não há alerta (RF-VEN-11, aba Venda). */
export const TEXTO_CLIENTE_LIBERADO = 'Cliente liberado · sem título vencido';

/**
 * Consequência da RN-VEN-13 no alerta: só o texto aprovado. A regra é do Vendedor; é o módulo que decide se o passa em
 * `consequencia` (se a RN-VEN-13 mudar, o módulo deixa de passar ou passa outro texto, e este é revisto aqui).
 */
export const CONSEQUENCIA_VENCIDO = 'Só à vista ou com aprovação.';

/** "Atualizado hoje às 06:20" · "Atualizado em 05/11 às 18:02" · null → "Ainda não sincronizado". No fuso do tenant. */
export function textoAtualizacao(em: string | null | undefined, agora: string | Date | number, tz: string): string {
  if (!em) return 'Ainda não sincronizado';
  const quando = dateTimeLabel(em, agora, tz);
  return /^(hoje|ontem)/.test(quando) ? `Atualizado ${quando}` : `Atualizado em ${quando}`;
}

/**
 * Linha do cartão "Leve mais e pague menos" (RN-VEN-23), a partir da `proximaFaixa` do domain do Vendedor:
 * título "Água mineral 1,5 L · leve 10 FD", apoio "R$ 19,90/FD (hoje R$ 20,31) · faltam 7 FD" e as leituras do TalkBack.
 */
export function textosLeveMais({
  produto,
  quantidadeMinima,
  medida,
  precoMedidaCents,
  precoHojeCents,
  faltam,
}: {
  produto: string;
  quantidadeMinima: number;
  /** Sigla da medida ("FD", "CX", "UN"). */
  medida: string;
  /** Preço por medida na faixa. */
  precoMedidaCents: Cents;
  /** Preço por medida hoje (sem a faixa); null esconde o "(hoje …)". */
  precoHojeCents?: Cents | null;
  faltam: number;
}): { titulo: string; apoio: string; leitura: string; rotuloAjustar: string } {
  const preco = `${formatBRL(precoMedidaCents)}/${medida}`;
  const hoje = precoHojeCents === null || precoHojeCents === undefined ? '' : ` (hoje ${formatBRL(precoHojeCents)})`;
  const titulo = `${produto} · leve ${quantidadeMinima} ${medida}`;
  const apoio = `${preco}${hoje} · faltam ${faltam} ${medida}`;
  const leituraHoje = hoje ? `, hoje ${formatBRL(precoHojeCents as Cents)}` : '';
  return {
    titulo,
    apoio,
    leitura: `${produto}: levando ${quantidadeMinima} ${medida}, ${formatBRL(precoMedidaCents)} por ${medida}${leituraHoje}. Faltam ${faltam} ${medida}.`,
    rotuloAjustar: `Ajustar para ${quantidadeMinima} ${medida}`,
  };
}
