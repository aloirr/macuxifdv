/** Dados fictícios para testes e demonstração da exportação. */
import type { DadosExportacao } from './formato';

export const MARCAS_EXEMPLO = [
  { id: 'm1', nome: 'Marca Alfa' },
  { id: 'm2', nome: 'Marca Beta' },
];

export const DADOS_EXEMPLO: DadosExportacao = {
  marcas: MARCAS_EXEMPLO,
  truncado: false,
  produtos: [
    { id: 'p1', codigo: 'CB 3401', descricao: 'Cabo', aplicacao: 'Dianteiro\nLado esquerdo', hierarquia: { sistema: 'Freios', grupo: 'Discos', linha: 'Linha Leve' }, referencias: [{ marca_id: 'm1', marca_nome: 'Marca Alfa', codigo: 'A-100' }, { marca_id: 'x9', marca_nome: null, codigo: 'Z-9' }], oferece_junto: ['p2', 'p1', 'nao-existe'] },
    { id: 'p2', codigo: 'AB 1000', descricao: 'Pastilha', aplicacao: null, hierarquia: { sistema: 'Freios', grupo: 'Discos', linha: 'Linha Leve' }, referencias: [], oferece_junto: [] },
    { id: 'p3', codigo: 'EL 5', descricao: 'Vela', aplicacao: 'Motor 1.0', hierarquia: { sistema: 'Elétrico', grupo: 'Ignição', linha: 'Linha Pesada' }, referencias: [{ marca_id: 'm2', marca_nome: 'Marca Beta', codigo: 'B-7' }], oferece_junto: ['p1'] },
    { id: 'p4', codigo: 'SS 1', descricao: 'Avulso', aplicacao: '<script>alert(1)</script>', hierarquia: { sistema: null, grupo: null, linha: null }, referencias: [], oferece_junto: [] },
  ],
};
