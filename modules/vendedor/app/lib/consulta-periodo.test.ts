/** T-0077 item 6: consulta ao servidor fora da janela de 90 dias do aparelho (RF-VEN-05). Funções puras. */
import { describe, expect, it } from 'vitest';
import type { Order } from '../../contracts';
import { caminhoDaConsultaPorPeriodo, estadoDaConsulta, mensagemForaDaJanela, pedidosDaConsulta } from './consulta-periodo';

describe('RF-VEN-05: consulta por período ao servidor', () => {
  it('monta o caminho com from/to, emitido OU mudou de status, pedidos e orçamentos', () => {
    expect(caminhoDaConsultaPorPeriodo({ tipo: 'mes', valor: '2026-02' }, null)).toBe('/vendedor/pedidos?from=2026-02-01&to=2026-02-28&por_status=1&tipo=todos&limite=200');
  });
  it('continua pela página seguinte com o cursor', () => {
    expect(caminhoDaConsultaPorPeriodo({ tipo: 'ano', valor: '2025' }, 'abc=')).toContain('&cursor=abc%3D');
  });
  it('a consulta do período fora da janela só roda com sinal; sem sinal a mensagem é "Disponível com conexão"', () => {
    expect(estadoDaConsulta({ fora: true, offline: true })).toBe('disponivel_com_conexao');
    expect(estadoDaConsulta({ fora: true, offline: false })).toBe('consultar');
    expect(estadoDaConsulta({ fora: false, offline: false })).toBe('local');
    expect(estadoDaConsulta({ fora: false, offline: true })).toBe('local');
  });
  it('mensagens em português com a próxima ação', () => {
    expect(mensagemForaDaJanela('disponivel_com_conexao')).toBe('Disponível com conexão');
    expect(mensagemForaDaJanela('carregando')).toBe('Buscando no servidor…');
    expect(mensagemForaDaJanela('erro')).toBe('Não foi possível consultar o servidor. Puxe para baixo para tentar de novo.');
  });
  it('pedidos do servidor entram na lista como pedidos já enviados (fora da fila)', () => {
    const o = { id: 'a', number: '000001' } as Order;
    expect(pedidosDaConsulta([o])).toEqual([{ id: 'a', number: '000001', local: false, local_error: '' }]);
  });
});
