// Dados da história, os mesmos em todas as telas: quinta, 19/11/2026, Boa Vista (RR), fuso de Manaus.
export const EMPRESA = 'Distribuidora Norte';
export const VENDEDORA = { nome: 'Carla Lima', primeiro: 'Carla' };
export const SUPERVISOR = { nome: 'Marcos Dias', primeiro: 'Marcos' };
export const GERENTE = 'Rui Matos';

export const CLIENTE = {
  fantasia: 'Mercado Bom Preço',
  codigo: 'C5007',
  razao: 'Mercado Bom Preço Comércio de Alimentos Ltda',
  cnpj: '14.382.906/0001-27',
  rua: 'Av. Ville Roy, 1200',
  bairro: 'Centro',
  cidade: 'Boa Vista/RR',
  cep: '69301-000',
  limite: 'R$ 8.000,00',
  disponivel: 'R$ 1.880,00',
};
export const ENDERECO_UMA_LINHA = `${CLIENTE.rua} · ${CLIENTE.bairro} · ${CLIENTE.cidade}`;

// Pedido 000021: 4 itens, R$ 2.480,00; passa do crédito disponível (R$ 1.880,00) e o cliente tem título vencido há 12 dias.
export const PEDIDO = {
  numero: '000021',
  forma: 'Boleto',
  prazo: '28/56 dias',
  itens: [
    // código, nome, marca, emb., fator, qtd, valor de tabela, ajuste, total, estoque
    { cod: '10231', nome: 'Arroz tipo 1 5 kg', marca: 'Tio Nortista', emb: 'CX', fator: 'c/ 6', qtd: '10', tabela: '1.290,00', ajuste: '0,0%', total: '1.290,00', est: '84' },
    { cod: '10418', nome: 'Feijão carioca 1 kg', marca: 'Kicaldo', emb: 'FD', fator: 'c/ 10', qtd: '8', tabela: '742,00', ajuste: '0,0%', total: '742,00', est: '57' },
    { cod: '30507', nome: 'Café torrado 500 g', marca: 'Serra Alta', emb: 'CX', fator: 'c/ 10', qtd: '2', tabela: '320,00', ajuste: '−5,0%', total: '304,00', est: '31' },
    { cod: '41020', nome: 'Açúcar cristal 2 kg', marca: 'Doce Norte', emb: 'FD', fator: 'c/ 10', qtd: '2', tabela: '144,00', ajuste: '0,0%', total: '144,00', est: '120' },
  ],
  valorTabela: 'R$ 2.496,00',
  descontoPct: '0,6%',
  descontoRs: '− R$ 16,00',
  total: 'R$ 2.480,00',
  observacao: 'Entregar pela manhã, até as 11h.',
  obsEntrega: 'Descarga pela lateral, na Rua Floriano Peixoto.',
};
