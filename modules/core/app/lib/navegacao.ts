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

export function abrirClientes(filtro?: string): void {
  router.navigate((filtro ? `/m/clientes?filter=${encodeURIComponent(filtro)}` : '/m/clientes') as never);
}
