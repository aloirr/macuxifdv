const q = new URLSearchParams(location.search);
const nome = q.get('nome') ?? 'MARIA EDUARDA SILVA';
const saud = q.get('saud') ?? 'Boa tarde';
const primeiro = (n: string) => n.trim().split(/\s+/)[0]!.split('-').map((p) => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase()).join('-');
export const useInicioCampo = () => ({
  data: 'Quinta, 12 de novembro · DU 9 de 20',
  saudacao: `${saud}, ${primeiro(nome)}`,
  frase: 'Cada cliente atendido é uma relação que cresce.',
  nome,
  metas: [
    { indicador: 'venda', titulo: 'Vendas', real: 'R$ 84,6 k', meta: '180 k', percentual: '47%', barra: 0.47, tom: 'abaixo', rodape: { rotulo: 'Meta/dia', valor: 'R$ 8,6 k' } },
    { indicador: 'positivacao', titulo: 'Positivação', real: '38', meta: '60', percentual: '63%', barra: 0.63, tom: 'abaixo', rodape: { rotulo: 'Meta/dia', valor: '3' } },
    { indicador: 'visitas', titulo: 'Visitas', real: '112', meta: '120', percentual: '93%', barra: 0.93, tom: 'abaixo', rodape: { rotulo: 'Meta/dia', valor: '1' } },
    { indicador: 'itens', titulo: 'Itens por pedido', real: '7,4', meta: '8', percentual: '100%', barra: 1, tom: 'batida', rodape: null },
  ],
  produtividade: [
    { indicador: 'jornada_liquida', titulo: 'Jornada líquida', valor: '7h12', ponto: 'dentro' },
    { indicador: 'primeiro_checkin', titulo: '1º check-in', valor: '08:41', ponto: 'dentro' },
    { indicador: 'almoco', titulo: 'Almoço', valor: '1h05', ponto: 'fora' },
    { indicador: 'ultimo_checkin', titulo: 'Último check-in', valor: '17:20', ponto: 'dentro' },
    { indicador: 'fora_rota', titulo: 'Fora de rota', valor: '2', ponto: 'fora' },
    { indicador: 'tma', titulo: 'TMA', valor: '18 min', ponto: null },
  ],
  sino: { recados: 1, tarefas: 1, total: 2 },
  ultimaSincronizacao: 'Últ. sincronização 14:32',
});
