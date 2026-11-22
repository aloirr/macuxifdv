import type { Entidade } from '@macuxi/integracao/contracts';

/** Nome de cada base do Hub, como a aba Integração do portal mostra nas Bases de um Conector e de uma credencial de API. */
export const NOME_DA_BASE: Record<Entidade, string> = {
  vendedor: 'Vendedores do ERP',
  catalogo_no: 'Árvore do catálogo',
  forma_pagamento: 'Formas de pagamento',
  prazo_pagamento: 'Prazos de pagamento',
  filial: 'Filiais',
  produto: 'Produtos',
  produto_unidade: 'Unidades',
  preco: 'Tabelas de preço',
  tabela_escalonada: 'Tabela escalonada',
  estoque: 'Estoque',
  cliente: 'Clientes',
  cliente_endereco: 'Endereços',
  transportadora: 'Transportadoras',
  rota: 'Rotas e carteira',
  titulo: 'Títulos',
  nota: 'Notas e histórico',
};
