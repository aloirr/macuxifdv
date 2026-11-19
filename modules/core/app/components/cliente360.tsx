/**
 * Cabeçalho da ficha do cliente (RF-CORE-04; T-0186, Cliente 360 v2). As três abas ficam em `aba-resumo.tsx`, `aba-historico.tsx` e
 * `aba-documentacao.tsx`; as abas de módulos (`cliente.abas`) são montadas pela tela da ficha (`telas/cliente.tsx`).
 */
import type { Cliente360Local } from '../lib/cliente360-local';

export function nomeDoCliente(c: Cliente360Local['cliente']): string {
  return c.nome_fantasia?.trim() || c.razao_social;
}

/** "C5007 · Centro · Boa Vista/RR": código, bairro e cidade, sem a rua (o endereço fica na tabela Endereços do Resumo). */
export function subtituloDaFicha(c: Cliente360Local['cliente']): string {
  return [c.external_id, c.bairro, c.cidade && c.uf ? `${c.cidade}/${c.uf}` : c.cidade].filter(Boolean).join(' · ');
}
