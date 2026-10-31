/**
 * Fila offline de módulo desativado (RN-CORE-02, esclarecimento de 2026-10-30): antes de apagar os dados locais
 * o app tenta enviar a fila do módulo; a API rejeita com 403 MODULO_INATIVO; os itens aparecem na tela de sync
 * como "não enviado — módulo desativado"; os dados locais só são apagados depois que o usuário confirma que viu.
 */
import type { ModuloId } from '@macuxi/platform-sdk';

export type EstadoItemFila = 'pendente' | 'enviado' | 'rejeitado_modulo_inativo' | 'falhou';

export interface ItemFila {
  id: string;
  modulo: ModuloId;
  estado: EstadoItemFila;
}

export const ROTULO_NAO_ENVIADO = 'Não enviado — módulo desativado';

/** Aplica a resposta do push a um item: 403 MODULO_INATIVO vira rejeitado; o resto segue a regra normal do motor. */
export function estadoAposPush(resposta: { ok: true } | { ok: false; status: number; codigo?: string }): EstadoItemFila {
  if (resposta.ok) return 'enviado';
  if (resposta.status === 403 && resposta.codigo === 'MODULO_INATIVO') return 'rejeitado_modulo_inativo';
  return 'falhou';
}

/** Itens do módulo que ainda NÃO chegaram ao servidor (tudo que não está `enviado`). */
export function naoEnviadosDoModulo(fila: readonly ItemFila[], modulo: ModuloId): ItemFila[] {
  return fila.filter((i) => i.modulo === modulo && i.estado !== 'enviado');
}

/** Itens a listar na tela de sync com o rótulo "não enviado — módulo desativado". */
export function itensParaMostrarNaTelaDeSync(fila: readonly ItemFila[], removidos: readonly ModuloId[]): ItemFila[] {
  return fila.filter((i) => removidos.includes(i.modulo) && i.estado !== 'enviado');
}

/** Antes de apagar: o app tenta enviar os itens pendentes/falhos de módulos removidos (a API vai rejeitar). */
export function itensParaTentarEnviar(fila: readonly ItemFila[], removidos: readonly ModuloId[]): ItemFila[] {
  return fila.filter((i) => removidos.includes(i.modulo) && (i.estado === 'pendente' || i.estado === 'falhou'));
}

/**
 * Os dados locais do módulo podem ser apagados? Sem itens não enviados, sim. Com itens, só depois da
 * confirmação do usuário (nada some em silêncio) e nunca enquanto ainda há item `pendente` por tentar.
 */
export function podeApagarDadosLocais(fila: readonly ItemFila[], modulo: ModuloId, usuarioConfirmou: boolean): boolean {
  const abertos = naoEnviadosDoModulo(fila, modulo);
  if (abertos.length === 0) return true;
  if (abertos.some((i) => i.estado === 'pendente')) return false;
  return usuarioConfirmou;
}
