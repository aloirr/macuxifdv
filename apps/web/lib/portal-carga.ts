/**
 * Resto da carga por arquivo do portal (v1.0.21; spec portal-config-enxuto §10 e §12: nenhum CSV fica no `config.`). Fica só o
 * nome de cada base, que `tela-empresa.tsx` e `aba-integracao.tsx` ainda importam; depois que saírem, apagar este arquivo.
 */
import type { Entidade } from '@macuxi/integracao/contracts';

/** Nome de cada base (T-0087 §3). */
export const CARTAO_DA_ENTIDADE: Record<Entidade, { titulo: string }> = {
  vendedor: { titulo: 'Vendedores do ERP' },
  catalogo_no: { titulo: 'Árvore do catálogo' },
  forma_pagamento: { titulo: 'Formas de pagamento' },
  prazo_pagamento: { titulo: 'Prazos de pagamento' },
  filial: { titulo: 'Filiais' },
  produto: { titulo: 'Produtos' },
  produto_unidade: { titulo: 'Unidades' },
  preco: { titulo: 'Tabelas de preço' },
  tabela_escalonada: { titulo: 'Tabela escalonada' },
  estoque: { titulo: 'Estoque' },
  cliente: { titulo: 'Clientes' },
  cliente_endereco: { titulo: 'Endereços' },
  transportadora: { titulo: 'Transportadoras' },
  rota: { titulo: 'Rotas e carteira' },
  titulo: { titulo: 'Títulos' },
  nota: { titulo: 'Notas e histórico' },
};
