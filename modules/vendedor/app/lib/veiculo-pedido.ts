/**
 * Apoio puro do filtro de veículo na aba Itens do Novo pedido (RN-CAT-22; spec `docs/design/filtro-veiculo/spec.md` §3, §5 e §8; sem linha 3). A regra
 * (cascata e filtro) é do domain do Catálogo e chega pelas consultas `catalogo.veiculos@1` e `catalogo.busca_produtos@1`;
 * aqui só se decide a lista e se montam os textos. O veículo é estado da tela: não entra no rascunho, no pedido, no PDF nem no ERP (P5).
 */
import type { NivelVeiculo, PassoTrilha, RotulosVeiculo, VeiculoEscolhido, VeiculoParcial, VeiculosSaida } from '@macuxi/catalogo/contracts';

import { buscaPodeComecar } from '../../domain/busca-seletor';

/** O veículo aplicado e os rótulos que a consulta devolveu junto (a tela não monta rótulo). */
export interface VeiculoDoPedido {
  veiculo: VeiculoEscolhido;
  rotulos: RotulosVeiculo;
}

export const TEXTOS_VEICULO_PEDIDO = {
  botao: 'Veículo',
  titulo: 'Veículo',
  fechar: 'Fechar',
  buscaPlaceholder: 'Modelo ou montadora',
  buscaLimpar: 'Limpar a busca',
  recentes: 'Recentes',
  verPecas: 'Ver peças',
} as const;

export const ROTULO_DO_NIVEL: Record<NivelVeiculo, string> = { montadora: 'Montadora', modelo: 'Modelo', ano: 'Ano', motor: 'Motor', versao: 'Versão' };

export const nenhumModeloCom = (texto: string): string => `Nenhum modelo com "${texto}".`;
export const leituraDoBotaoVeiculo = (v: VeiculoDoPedido | null): string => (v ? `Veículo: ${v.rotulos.completo}` : 'Veículo');
export const leituraDaEtiquetaVeiculo = (v: VeiculoDoPedido): string => `Remover veículo ${v.rotulos.completo}`;

/** O que a lista da aba mostra: os itens do pedido, as peças do veículo (sem texto) ou o resultado da busca. */
export function modoDaListaDoPedido(e: { veiculo: boolean; texto: string }): 'itens' | 'veiculo' | 'busca' {
  if (buscaPodeComecar(e.texto)) return 'busca';
  return e.veiculo ? 'veiculo' : 'itens';
}

/** Com veículo, texto de menos de 3 letras conta como sem texto (o Catálogo faz o mesmo; aqui nem vai). */
export function textoDaBuscaComVeiculo(texto: string, comVeiculo: boolean): string {
  const t = texto.trim();
  return comVeiculo && !buscaPodeComecar(t) ? '' : t;
}

/** RN-CAT-22 e RN-CAT-06: o escopo de venda do cliente, o MESMO na busca de itens e na cascata (botão, opções, busca da folha e lista). */
export function escopoDoCliente(clienteId: string | undefined, produtoIds: string[] | null): { cliente_id?: string; produto_ids?: string[] } {
  return clienteId ? { cliente_id: clienteId } : produtoIds ? { produto_ids: produtoIds } : {};
}

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

/** Chave estável do veículo, para a busca descartar resposta de outro veículo. */
export const chaveDoVeiculo = (v: VeiculoEscolhido | null): string => (v ? [v.montadora, v.modelo, v.ano, v.motor, v.versao].join('|') : '');
