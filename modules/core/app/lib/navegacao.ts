/**
 * Navegação entre as telas do Core. As telas de módulo ficam em `/m/<caminho>` (shell, ADR 0003);
 * os parâmetros vão na query (`/m/cliente?id=…`).
 */
import { router } from 'expo-router';

export function abrirCliente(id: string, from: string, checkin = false): void {
  const q = new URLSearchParams({ id, from });
  if (checkin) q.set('checkin', '1');
  router.navigate(`/m/cliente?${q.toString()}` as never);
}

export function abrirRota(): void {
  router.navigate('/m/rota' as never);
}

/** Rota da lista de Clientes (fallback dos botões Voltar). */
export const ROTA_CLIENTES = '/m/clientes';
export function abrirClientes(filtro?: string): void {
  router.navigate((filtro ? `${ROTA_CLIENTES}?filter=${encodeURIComponent(filtro)}` : ROTA_CLIENTES) as never);
}

/** Página `novo-cliente` do Core (pré-cadastro, v1.0.28); com o parâmetro `clienteId` na query é "Corrigir e reenviar". */
export const ROTA_NOVO_CLIENTE = '/m/novo-cliente';
export const PARAM_CLIENTE_ID = 'clienteId' as const;
export function abrirNovoCliente(clienteId?: string): void {
  router.navigate((clienteId ? `${ROTA_NOVO_CLIENTE}?${PARAM_CLIENTE_ID}=${encodeURIComponent(clienteId)}` : ROTA_NOVO_CLIENTE) as never);
}
