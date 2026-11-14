/** T-0077 item 6: consulta ao servidor fora da janela de 90 dias do aparelho (RF-VEN-05). Funções puras. */
import { describe, expect, it } from 'vitest';
import type { Order } from '../../contracts';
import { caminhoDaConsultaPorPeriodo, estadoDaConsulta, juntarServidorComAparelho, mensagemForaDaJanela, pedidosDaConsulta, resumoDaBusca, rotuloRemoverVendedor, situacaoAoEscolherPeriodo, textoDoVazio } from './consulta-periodo';

const SEM_SINAL_VAZIO = 'Sem sinal: este período não está no aparelho. Os pedidos aparecem quando o sinal voltar.';

describe('RF-VEN-05: consulta por período ao servidor', () => {
  it('monta o caminho com from/to, emitido OU mudou de status, pedidos e orçamentos', () => {
    expect(caminhoDaConsultaPorPeriodo({ tipo: 'mes', valor: '2026-02' }, null)).toBe('/vendedor/pedidos?from=2026-02-01&to=2026-02-28&por_status=1&tipo=todos&limite=200');
  });
  it('continua pela página seguinte com o cursor', () => {
    expect(caminhoDaConsultaPorPeriodo({ tipo: 'ano', valor: '2025' }, 'abc=')).toContain('&cursor=abc%3D');
  });
  it('a consulta do período fora da janela só roda com sinal; sem sinal a mensagem é a do vazio sem sinal', () => {
    expect(estadoDaConsulta({ fora: true, offline: true })).toBe('disponivel_com_conexao');
    expect(estadoDaConsulta({ fora: true, offline: false })).toBe('consultar');
    expect(estadoDaConsulta({ fora: false, offline: false })).toBe('local');
    expect(estadoDaConsulta({ fora: false, offline: true })).toBe('local');
  });
  it('mensagens em português com a próxima ação', () => {
    expect(mensagemForaDaJanela('disponivel_com_conexao')).toBe(SEM_SINAL_VAZIO);
    expect(mensagemForaDaJanela('carregando')).toBe('Buscando no servidor…');
    expect(mensagemForaDaJanela('erro')).toBe('Não foi possível consultar o servidor. Puxe para baixo para tentar de novo.');
  });
  it('pedidos do servidor entram na lista como pedidos já enviados (fora da fila)', () => {
    const o = { id: 'a', number: '000001' } as Order;
    expect(pedidosDaConsulta([o])).toEqual([{ id: 'a', number: '000001', local: false, local_error: '' }]);
  });
});

describe('textoDoVazio (T-0077)', () => {
  const b = { fora: false, modoConsulta: null, estadoDoServidor: null, buscando: false, situacao: 'todos', gestao: false };
  it('T-0090 UX4: fora da janela sem sinal, o vazio explica e promete', () => {
    expect(textoDoVazio({ ...b, fora: true, modoConsulta: 'disponivel_com_conexao' })).toBe(SEM_SINAL_VAZIO);
  });
  it('fora da janela: carregando, erro e ok', () => {
    expect(textoDoVazio({ ...b, fora: true })).toBe('Buscando no servidor…');
    expect(textoDoVazio({ ...b, fora: true, estadoDoServidor: 'erro' })).toMatch(/Puxe para baixo/);
    expect(textoDoVazio({ ...b, fora: true, estadoDoServidor: 'ok' })).toBe('Nenhum pedido neste período.');
  });
  it('com busca: orienta a conferir ou limpar', () => {
    expect(textoDoVazio({ ...b, buscando: true })).toMatch(/limpe a busca/);
  });
  it('por situação e perfil', () => {
    expect(textoDoVazio({ ...b, situacao: 'orcamentos' })).toBe('Nenhum orçamento neste período.');
    expect(textoDoVazio({ ...b, situacao: 'decide' })).toBe('Nada para aprovar agora.');
    expect(textoDoVazio({ ...b, gestao: true })).toBe('Nenhum pedido da equipe neste período.');
    expect(textoDoVazio(b)).toMatch(/Toque em Novo/);
    expect(textoDoVazio({ ...b, situacao: 'queued' })).toBe('Nenhum pedido com esta situação neste período.');
  });
});

describe('RN-CORE-23 / T-0090: junção do servidor com o aparelho no período parcial', () => {
  const p = (id: string, local: boolean, status = 'sent') => ({ id, number: id, status, local, local_error: '' }) as never as import('./pedidos').PedidoDaLista;
  it('pedido na fila do aparelho aparece mesmo sem estar no servidor', () => {
    const r = juntarServidorComAparelho([p('a', false)], [p('f', true)]);
    expect(r.map((x) => x.id).sort()).toEqual(['a', 'f']);
    expect(r.filter((x) => x.local)).toHaveLength(1);
  });
  it('a edição local tem prioridade sobre o item do servidor, sem duplicar por id', () => {
    const r = juntarServidorComAparelho([p('a', false, 'sent')], [p('a', true, 'draft')]);
    expect(r).toHaveLength(1);
    expect(r[0]!.status).toBe('draft');
  });
  it('item já enviado vem do servidor; o que só o aparelho tem entra', () => {
    const r = juntarServidorComAparelho([p('a', false, 'invoiced')], [p('a', false, 'sent'), p('b', false)]);
    expect(r.find((x) => x.id === 'a')!.status).toBe('invoiced');
    expect(r.map((x) => x.id).sort()).toEqual(['a', 'b']);
  });
  it('500 pedidos juntam em menos de 100 ms', () => {
    const s = Array.from({ length: 500 }, (_, i) => p(`s${i}`, false));
    const a = Array.from({ length: 500 }, (_, i) => p(`s${i}`, i % 10 === 0));
    const t0 = performance.now();
    juntarServidorComAparelho(s, a);
    expect(performance.now() - t0).toBeLessThan(100);
  });
});

describe('T-0090 revisão de UX (🟡1, 🟡2, 🟡5)', () => {
  it('UX1: com busca e vendedor escolhido, o resumo diz N resultados · vendedor · últimos 90 dias', () => {
    expect(resumoDaBusca(3, null)).toBe('3 resultados · últimos 90 dias');
    expect(resumoDaBusca(1, 'Ana Souza')).toBe('1 resultado · Ana Souza · últimos 90 dias');
    expect(resumoDaBusca(0, 'Ana Souza')).toBe('0 resultados · Ana Souza · últimos 90 dias');
  });
  it('UX2: escolher um período sai do chip A faturar (volta para Todos); os demais ficam', () => {
    expect(situacaoAoEscolherPeriodo('a_faturar')).toBe('todos');
    expect(situacaoAoEscolherPeriodo('decide')).toBe('decide');
    expect(situacaoAoEscolherPeriodo(null)).toBeNull();
  });
  it('UX5: a leitura da etiqueta do vendedor é "Remover filtro <nome>"', () => {
    expect(rotuloRemoverVendedor('Ana Souza')).toBe('Remover filtro Ana Souza');
  });
});
