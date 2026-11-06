/**
 * Parte PURA dos campos de escolha do Novo pedido (T-0089, fatia U1; referência
 * docs/produto/referencias/R-20261106-0703-alexandre-novo-pedido-itens-v2.png):
 * - lista suspensa (Forma de pagamento, Prazo, tipo do ajuste): leitura da opção desabilitada e posição do menu ancorado;
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

// ---------- lista suspensa ----------

/** Opção de lista suspensa. `motivo` só é lido pelo leitor de tela (a lista mostra só o rótulo, RN-VEN-25). */
export interface OpcaoLista<T extends string = string> {
  id: T;
  rotulo: string;
  desabilitada?: boolean;
  /** Por que está desabilitada (ex.: "Acima do prazo médio do cliente"). Não aparece na tela. */
  motivo?: string | null;
  /** Leitura completa quando o rótulo é abreviado ("Desc %" → "Desconto em porcentagem"). */
  rotuloAcessivel?: string;
  testID?: string;
}

/** Leitura da opção no TalkBack: o rótulo e, se desabilitada com motivo, o motivo ("30/60/90 dias. Acima do prazo médio do cliente"). */
export function leituraDaOpcao(o: Pick<OpcaoLista, 'rotulo' | 'rotuloAcessivel' | 'desabilitada' | 'motivo'>): string {
  const base = (o.rotuloAcessivel ?? o.rotulo).trim();
  const motivo = o.desabilitada ? (o.motivo ?? '').trim() : '';
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
}: {
  campo: Retangulo;
  janela: { largura: number; altura: number };
  quantidade: number;
  larguraMinima?: number;
  alturaOpcao?: number;
  maxVisiveis?: number;
}): PosicaoMenu {
  const desejada = Math.max(1, Math.min(Math.max(0, quantidade), maxVisiveis)) * alturaOpcao + 2;
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
 * Medidas do passo compacto da linha 3 do item (R-20261106-064754/064756): o − e o + têm visual de 32 × 36 dp dentro de uma
 * caixa só; o alvo chega a 44 × 48 dp com folga para fora (o lado de dentro encosta no número e não tem folga).
 */
export const PASSO_COMPACTO = { botao: 32, altura: 36, valor: 40, folgaFora: 12, folgaVertical: 6 } as const;

/** Alvo efetivo do botão do passo compacto (largura × altura em dp). */
export function alvoDoPassoCompacto(): { largura: number; altura: number } {
  return { largura: PASSO_COMPACTO.botao + PASSO_COMPACTO.folgaFora, altura: PASSO_COMPACTO.altura + 2 * PASSO_COMPACTO.folgaVertical };
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

/** Consequência da RN-VEN-13 no alerta (texto aprovado). */
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
