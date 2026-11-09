/**
 * Parte PURA dos componentes genéricos de formulário e resumo (T-0071, fatia 4): contador da aba, limites do passo,
 * leitura da quantidade digitada e folga de toque. Sem react-native: roda em Node (Vitest) e é reexportada por
 * `@macuxi/ui/mobile/puro`. Nenhum texto de tela mora aqui: rótulos chegam por props.
 */

/** Alvo de toque mínimo dos componentes (48 dp, Material). */
export const ALVO_TOQUE = 48;

/** "Itens" + 3 → "Itens (3)". Sem contador (undefined/null) devolve só o rótulo. */
export function rotuloComContador(rotulo: string, contador?: number | null): string {
  if (contador === undefined || contador === null || !Number.isFinite(contador)) return rotulo;
  return `${rotulo} (${Math.trunc(contador)})`;
}

/** Limita o valor do passo (stepper) a inteiro entre `min` e `max` (sem `max`, sem teto). */
export function limitarPasso(valor: number, min = 0, max?: number): number {
  if (!Number.isFinite(valor)) return min;
  const n = Math.trunc(valor);
  const comTeto = max === undefined ? n : Math.min(max, n);
  return Math.max(min, comTeto);
}

/** Próximo valor do passo ao tocar − (`-1`) ou + (`+1`), já limitado. */
export function proximoPasso(valor: number, direcao: -1 | 1, passo = 1, min = 0, max?: number): number {
  return limitarPasso(valor + direcao * passo, min, max);
}

/** Lê a quantidade digitada ("12", " 3 ", "1.000"). Texto sem dígito → null (a tela mantém o valor anterior). */
export function lerQuantidade(texto: string): number | null {
  const digitos = texto.replace(/\D/g, '');
  if (digitos === '') return null;
  return Number.parseInt(digitos, 10);
}

/** Folga de toque (hitSlop) de cada lado para um elemento visual de `visual` dp alcançar o alvo de 48 dp. */
export function folgaDeToque(visual: number, alvo = ALVO_TOQUE): number {
  return Math.max(0, Math.ceil((alvo - visual) / 2));
}

/** Altura mínima do carregando dentro de cartão (ranking, lista de trilhas): o cartão não colapsa enquanto busca. */
export const ALTURA_CARREGANDO_EMBUTIDO = 96;

/** Layout do carregando (sem cor). Tela cheia ocupa o espaço que sobra; embutido (dentro de cartão) não estica:
 * altura mínima fixa, centralizado, e o fundo fica com o cartão (sem faixa cinza). */
export function layoutCarregando(embutido: boolean): {
  flex?: number;
  minHeight?: number;
  alignSelf?: 'stretch';
  alignItems: 'center';
  justifyContent: 'center';
} {
  if (embutido) return { minHeight: ALTURA_CARREGANDO_EMBUTIDO, alignSelf: 'stretch', alignItems: 'center', justifyContent: 'center' };
  return { flex: 1, alignItems: 'center', justifyContent: 'center' };
}

// ---------- voltar (T-0072, R-20261105-132419) ----------

/** O que o shell informa ao `BackLink` pelo `ProvedorVoltar`: o rótulo de para onde o voltar leva ("Início", "Mais"). */
export interface VoltarDaTela {
  readonly rotulo: string;
}

/**
 * Rótulo visível e lido do `BackLink`. Com o valor do shell (raiz de uma pilha aberta de fora), vale o rótulo do shell; sem ele
 * (null, undefined ou rótulo em branco), vale o `label` do módulo, como antes.
 */
export function rotuloDoVoltar(label: string, voltar: VoltarDaTela | null | undefined): { visivel: string; acessivel: string } {
  const doShell = voltar?.rotulo?.trim();
  const visivel = doShell ? doShell : label;
  return { visivel, acessivel: `Voltar para ${visivel}` };
}

/** T-0128: o bloqueio de saída do shell, visto pelo `BackLink` (`ProvedorSaidaDaTela`). Mesmo formato do `bloqueioDoShell`. */
export interface SaidaDaTela {
  /** Segura a saída se houver formulário alterado (`seguir` roda depois, se a pessoa confirmar) e devolve `true`; senão chama `seguir` na hora. */
  tentarSair(seguir: () => void): boolean;
}

/**
 * Toque no `BackLink` (T-0128, RN-VEN-38): a tela que passa `aoVoltar` decide sozinha; sem ela, o toque passa pelo bloqueio do
 * shell (`saida.tentarSair(seguir)`), que pergunta "Sair…?" com o formulário alterado; sem provedor, volta direto (`seguir`).
 */
export function tocarNoVoltar(op: { aoVoltar?: (() => void) | undefined; saida: SaidaDaTela | null | undefined; seguir: () => void }): void {
  if (op.aoVoltar) op.aoVoltar();
  else if (op.saida) op.saida.tentarSair(op.seguir);
  else op.seguir();
}

// ---------- folha com altura máxima e teclado (T-0072) ----------

/** Faixa do fundo escurecido que fica sempre à vista acima da folha alta (dá para tocar fora e fechar). */
export const FOLGA_TOPO_FOLHA = 24;

/** Distância entre o campo com foco e a borda de baixo da área visível da folha. */
export const FOLGA_CAMPO_FOLHA = 8;

/**
 * Altura máxima da folha `rolavel`: a altura da camada da folha menos a área segura do topo, a faixa de fundo
 * (`FOLGA_TOPO_FOLHA`) e o que o teclado cobre. Nunca menos que 0.
 */
export function alturaMaximaDaFolha({ alturaCamada, topoSeguro = 0, teclado = 0 }: { alturaCamada: number; topoSeguro?: number; teclado?: number }): number {
  if (!Number.isFinite(alturaCamada) || alturaCamada <= 0) return 0;
  const t = Number.isFinite(teclado) ? Math.max(0, teclado) : 0;
  const topo = Number.isFinite(topoSeguro) ? Math.max(0, topoSeguro) : 0;
  return Math.max(0, Math.round(alturaCamada - topo - FOLGA_TOPO_FOLHA - t));
}

/**
 * Quanto o teclado cobre da camada da folha, medido em coordenadas da janela: base da camada (y + altura) menos o topo
 * do teclado (`endCoordinates.screenY`). Teclado fechado ou abaixo da camada → 0.
 */
export function coberturaDoTeclado(baseDaCamada: number, topoDoTeclado: number | null | undefined): number {
  if (topoDoTeclado === null || topoDoTeclado === undefined || !Number.isFinite(topoDoTeclado) || !Number.isFinite(baseDaCamada)) return 0;
  return Math.max(0, Math.round(baseDaCamada - topoDoTeclado));
}

/**
 * Quanto rolar a área da folha para o campo com foco ficar inteiro à vista (com `FOLGA_CAMPO_FOLHA` embaixo). Positivo
 * rola para baixo; negativo, para cima (campo escondido em cima); 0 quando já está à vista.
 */
export function rolagemAteCampo({ campoTopo, campoBaixo, areaTopo, areaBaixo, folga = FOLGA_CAMPO_FOLHA }: { campoTopo: number; campoBaixo: number; areaTopo: number; areaBaixo: number; folga?: number }): number {
  if (![campoTopo, campoBaixo, areaTopo, areaBaixo].every(Number.isFinite)) return 0;
  const abaixo = campoBaixo + folga - areaBaixo;
  if (abaixo > 0) return Math.ceil(abaixo);
  const acima = campoTopo - folga - areaTopo;
  if (acima < 0) return Math.floor(acima);
  return 0;
}

/**
 * Leitura do `LinhaAtalho` no leitor de tela (T-0085): "Ver por linha" + "Sistema › grupo › linha" →
 * "Ver por linha. Sistema, grupo, linha". O "›" vira vírgula (o TalkBack lê o sinal como "maior que" ou o pula).
 */
export function leituraDoAtalho(rotulo: string, apoio?: string | null): string {
  const r = rotulo.trim();
  const a = (apoio ?? '').replace(/\s*›\s*/g, ', ').trim();
  return a ? `${r}. ${a}` : r;
}

/** Valor sem dado na `TabelaValores` (T-0141, crédito do cliente): travessão, nunca um "R$ 0,00" falso. */
export const VALOR_SEM_DADO = '—';

/** Vazio ou travessão: a `TabelaValores` desenha em `ink3` e o leitor de tela lê "sem dado". */
export function ehSemDado(valor: string | null | undefined): boolean {
  const v = (valor ?? '').trim();
  return v === '' || v === VALOR_SEM_DADO;
}

/** Leitura de uma linha da `TabelaValores`: "Limite: R$ 20.000,00"; sem dado: "Limite: sem dado". */
export function leituraDaLinhaDeValor(rotulo: string, valor: string | null | undefined): string {
  return `${rotulo.trim()}: ${ehSemDado(valor) ? 'sem dado' : (valor ?? '').trim()}`;
}

/** Contagem da `ListaNiveis` (T-0142): inteiro com ponto no milhar ("1.240"); negativo ou inválido vira "0". */
export function textoDaContagem(n: number): string {
  const v = Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  return String(v).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

/** Leitura de uma linha da `ListaNiveis`: "Alimentos, 16 produtos" / "Freios, 1 produto". */
export function leituraDoNivel(nome: string, contagem: number, singular = 'produto', plural = 'produtos'): string {
  const n = Number.isFinite(contagem) && contagem > 0 ? Math.floor(contagem) : 0;
  return `${nome.trim()}, ${textoDaContagem(n)} ${n === 1 ? singular : plural}`;
}
