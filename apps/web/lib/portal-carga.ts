import type { Entidade } from '@macuxi/integracao/contracts';

/** Nome de cada base do Hub, como a aba Integração do portal mostra nas Bases de um Conector e de uma credencial de API. */
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
