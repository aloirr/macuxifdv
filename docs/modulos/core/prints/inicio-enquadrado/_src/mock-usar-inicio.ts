import { linhaDaData, saudacaoComNome, textoUltimaSincronizacao } from '@core/app/telas/inicio/inicio-campo';

const q = new URLSearchParams(location.search);
const nome = q.get('nome') ?? 'MARIA EDUARDA SILVA';
const saud = q.get('saud') ?? 'Boa tarde';
export const useInicioCampo = () => ({
  // Textos pelas funções reais (DU e "Últ. sincronização" sem quebra no meio)
  data: linhaDaData('2026-11-12', { du_hoje: 9, du_total: 20 }),
  saudacao: saudacaoComNome(saud, nome),
  frase: 'Cada cliente atendido é uma relação que cresce.',
  nome,
  metas: [
    { indicador: 'venda', titulo: 'Vendas', real: 'R$ 84,6 k', meta: '180 k', percentual: '47%', barra: 0.47, tom: 'abaixo', rodape: { rotulo: 'Meta/dia', valor: 'R$ 8,7 k' } },
    { indicador: 'positivacao', titulo: 'Positivação', real: '38', meta: '60', percentual: '63%', barra: 0.63, tom: 'abaixo', rodape: { rotulo: 'Meta/dia', valor: '2' } },
    { indicador: 'visitas', titulo: 'Visitas', real: '112', meta: '120', percentual: '93%', barra: 0.93, tom: 'abaixo', rodape: { rotulo: 'Meta/dia', valor: '1' } },
    { indicador: 'itens', titulo: 'Itens/pedido', real: '7,4', meta: '8', percentual: '93%', barra: 0.93, tom: 'abaixo', rodape: { rotulo: 'Meta/pedido', valor: '8,5' } },
  ],
  produtividade: [
    { indicador: 'jornada_liquida', titulo: 'Jornada', valor: '7h12', ponto: 'dentro' },
    { indicador: 'primeiro_checkin', titulo: '1º check-in', valor: '08:41', ponto: 'dentro' },
    { indicador: 'almoco', titulo: 'Almoço', valor: '1h05', ponto: 'fora' },
    { indicador: 'ultimo_checkin', titulo: 'Últ. check-in', valor: '17:20', ponto: 'dentro' },
    { indicador: 'fora_rota', titulo: 'Fora de rota', valor: '2', ponto: 'fora' },
    { indicador: 'tma', titulo: 'TMA', valor: '18 min', ponto: null },
  ],
  sino: { recados: 1, tarefas: 1, total: 2 },
  ultimaSincronizacao: textoUltimaSincronizacao('2026-11-12T18:32:00Z', 'America/Sao_Paulo'),
});
