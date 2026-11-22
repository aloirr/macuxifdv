/**
 * Apoio puro das telas do filtro de veículo (RN-CAT-22; spec `docs/design/filtro-veiculo/spec.md` §3 a §9): o veículo escolhido (um só,
 * em memória, para o Catálogo e a ficha), o texto da etiqueta, o vazio e a leitura do trecho com o modelo em negrito. A regra é do domain; os apoios
 * da folha (compartilhados com o Vendedor) estão em `contracts/veiculo.ts`.
 */
import { TEXTOS_VEICULO, type VeiculoEscolhido } from '../../contracts';
import { rotulosDoVeiculo } from '../../domain/veiculo-filtro';

/** Os textos só das telas do Catálogo e da ficha; os da folha Veículo (`TEXTOS_VEICULO`) vêm de `contracts`. */
export const TEXTOS_VEICULO_CATALOGO = {
  limparFiltros: 'Limpar filtros',
  leveTambem: 'Leve também',
} as const;

export const textoDaFichaCompativel = (v: VeiculoEscolhido): string => `Compatível com ${rotulosDoVeiculo(v)?.curto ?? ''}`;

// ---------- o veículo escolhido (um só por vez; vale enquanto o app está aberto) ----------
let escolhido: VeiculoEscolhido | null = null;
/** O veículo do Catálogo aberto, que a ficha lê (a ficha não tem etiqueta própria). */
export const veiculoDaTela = (): VeiculoEscolhido | null => escolhido;
export const definirVeiculoDaTela = (v: VeiculoEscolhido | null): void => {
  escolhido = v;
};

/** O que a tela mostra quando o veículo não deixa nenhuma peça (spec §9): título, e a ação (`Limpar filtros` com chip marcado). */
export function vazioComVeiculo(e: { consulta: string; chipMarcado: boolean }): { titulo: string; acao: 'limpar_filtros' | 'tirar_veiculo' } {
  const titulo = e.consulta ? TEXTOS_VEICULO.nadaEncontradoPara(e.consulta) : TEXTOS_VEICULO.semFiltros;
  return { titulo, acao: e.chipMarcado ? 'limpar_filtros' : 'tirar_veiculo' };
}

/** Parte o trecho nas marcas ([início, fim) sobre o texto): o que é marcado vai em negrito. */
export function partirTrecho(texto: string, marcas: readonly (readonly [number, number])[]): { texto: string; marcado: boolean }[] {
  const saida: { texto: string; marcado: boolean }[] = [];
  let pos = 0;
  for (const [a, b] of [...marcas].sort((x, y) => x[0] - y[0])) {
    if (a < pos || b > texto.length || a >= b) continue;
    if (a > pos) saida.push({ texto: texto.slice(pos, a), marcado: false });
    saida.push({ texto: texto.slice(a, b), marcado: true });
    pos = b;
  }
  if (pos < texto.length) saida.push({ texto: texto.slice(pos), marcado: false });
  return saida;
}
