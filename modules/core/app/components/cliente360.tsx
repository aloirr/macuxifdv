/**
 * Cabeçalho da ficha do cliente (RF-CORE-04; T-0186, Cliente 360 v2). As três abas ficam em `aba-resumo.tsx`, `aba-historico.tsx` e
 * `aba-documentacao.tsx`; as abas de módulos (`cliente.abas`) são montadas pela tela da ficha (`telas/cliente.tsx`).
 */
import type { Cliente360Local } from '../lib/cliente360-local';
import type { CodigosDoCliente } from '@macuxi/ui/mobile/puro';

export function nomeDoCliente(c: Cliente360Local['cliente']): string {
  return c.nome_fantasia?.trim() || c.razao_social;
}

/** "Centro · Boa Vista/RR": bairro e cidade, sem a rua (o endereço fica na tabela Endereços do Resumo). Os códigos vão no `codigos` do cabeçalho. */
export function subtituloDaFicha(c: Cliente360Local['cliente']): string {
  return [c.bairro, c.cidade && c.uf ? `${c.cidade}/${c.uf}` : c.cidade].filter(Boolean).join(' · ');
}

/** Códigos do cliente para o `codigos` do `CabecalhoTela` (o kit monta `ERP C5007 · FDV 00012 · <subtítulo>`, codigos-do-cliente.md §3.1). */
export function codigosDaFicha(c: Cliente360Local['cliente']): CodigosDoCliente {
  return { erp: c.external_id, fdv: c.codigo_fdv };
}
