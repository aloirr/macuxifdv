/**
 * Apoio puro das telas do filtro de veículo (RN-CAT-22; spec `docs/design/filtro-veiculo/spec.md` §3 a §9): o veículo escolhido (um só,
 * em memória, para o Catálogo e a ficha), o texto da etiqueta, o vazio e a leitura do trecho com o modelo em negrito. A regra é do domain.
 */
import type { NivelVeiculo, PassoTrilha, VeiculoEscolhido, VeiculoParcial, VeiculosSaida } from '../../contracts';
import { rotulosDoVeiculo } from '../../domain/veiculo-filtro';

export const TEXTOS_VEICULO = {
  botao: 'Veículo',
  titulo: 'Veículo',
  fechar: 'Fechar',
  buscaPlaceholder: 'Modelo ou montadora',
  buscaLimpar: 'Limpar a busca',
  recentes: 'Recentes',
  verPecas: 'Ver peças',
  compativel: 'Compatível',
  tirar: 'Tirar o veículo',
  limparFiltros: 'Limpar filtros',
  semFiltros: 'Nenhum produto com esses filtros',
  placeholderBusca: 'Peça ou código…',
  /** Embaixo do campo de busca em foco e vazio, só com o botão Veículo visível (spec §3). */
  dicaBusca: 'Também acha por marca, aplicação e referência cruzada.',
  leveTambem: 'Leve também',
} as const;

export const ROTULO_DO_NIVEL: Record<NivelVeiculo, string> = { montadora: 'Montadora', modelo: 'Modelo', ano: 'Ano', motor: 'Motor', versao: 'Versão' };

export const nadaEncontradoPara = (texto: string): string => `Nada encontrado para "${texto}"`;
export const nenhumModeloCom = (texto: string): string => `Nenhum modelo com "${texto}".`;
export const leituraDoBotaoVeiculo = (v: VeiculoEscolhido | null): string => (v ? `Veículo: ${rotulosDoVeiculo(v)?.completo ?? ''}` : 'Veículo');
export const leituraDaEtiquetaVeiculo = (v: VeiculoEscolhido): string => `Remover veículo ${rotulosDoVeiculo(v)?.completo ?? ''}`;
export const textoDaEtiquetaVeiculo = (v: VeiculoEscolhido): string => rotulosDoVeiculo(v)?.curto ?? '';
export const textoDaFichaCompativel = (v: VeiculoEscolhido): string => `Compatível com ${rotulosDoVeiculo(v)?.curto ?? ''}`;

// ---------- o veículo escolhido (um só por vez; vale enquanto o app está aberto) ----------
let escolhido: VeiculoEscolhido | null = null;
/** O veículo do Catálogo aberto, que a ficha lê (a ficha não tem etiqueta própria). */
export const veiculoDaTela = (): VeiculoEscolhido | null => escolhido;
export const definirVeiculoDaTela = (v: VeiculoEscolhido | null): void => {
  escolhido = v;
};

/** A escolha da folha (só o que já tem) vira veículo quando há modelo. */
export function veiculoDaEscolha(p: VeiculoParcial): VeiculoEscolhido | null {
  if (!p.modelo) return null;
  return { montadora: p.montadora ?? null, modelo: p.modelo, ano: p.ano ?? null, motor: p.motor ?? null, versao: p.versao ?? null };
}

export const parcialDoVeiculo = (v: VeiculoEscolhido): VeiculoParcial => ({ ...v });

/** Voltar pela trilha: os passos ANTES do `indice` (os automáticos voltam sozinhos na consulta seguinte). */
export function escolhaAntesDoPasso(trilha: readonly PassoTrilha[], indice: number): VeiculoParcial {
  const escolha: VeiculoParcial = {};
  for (const p of trilha.slice(0, Math.max(0, indice))) {
    if (p.nivel === 'ano') escolha.ano = Number(p.valor);
    else escolha[p.nivel] = p.valor;
  }
  return escolha;
}

/** Escolhe a opção `valor` do `nivel` sobre a escolha de agora. */
export function escolherOpcao(escolha: VeiculoParcial, nivel: NivelVeiculo, valor: string): VeiculoParcial {
  return nivel === 'ano' ? { ...escolha, ano: Number(valor) } : { ...escolha, [nivel]: valor };
}

/** O que a busca da folha escolheu: montadora leva ao Modelo; modelo (com a montadora do apoio) leva ao Ano. */
export function escolhaDoResultadoDaBusca(r: NonNullable<VeiculosSaida['busca']>[number]): VeiculoParcial {
  return r.nivel === 'montadora' ? { montadora: r.valor } : { ...(r.apoio ? { montadora: r.apoio } : {}), modelo: r.valor };
}

/** O que a tela mostra quando o veículo não deixa nenhuma peça (spec §9): título, e a ação (`Limpar filtros` com chip marcado). */
export function vazioComVeiculo(e: { consulta: string; chipMarcado: boolean }): { titulo: string; acao: 'limpar_filtros' | 'tirar_veiculo' } {
  const titulo = e.consulta ? nadaEncontradoPara(e.consulta) : TEXTOS_VEICULO.semFiltros;
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
