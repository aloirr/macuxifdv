import { estadoAoAbrirFolha, eventoDaFolha, type EventoFolhaPeriodo } from '@macuxi/ui/mobile/puro';
import { describe, expect, it } from 'vitest';

import { periodoForaDaJanela, type Periodo } from '../../domain/busca-periodo';
import { ATALHO_PADRAO, ATALHOS_DE_PERIODO, contarFiltros, ehAtalhoDePeriodo, escolhaEmVigor, periodoDaEscolha, periodoDoAtalho, textoDaEtiquetaDoPeriodo } from '../../domain/filtro-periodo';
import { estadoDaConsulta } from './consulta-periodo';

const TZ = 'America/Manaus';
const AGORA = new Date('2026-11-06T14:00:00Z');
const HOJE = '2026-11-06';

/** Simula a tela: o período em vigor muda só pelos callbacks que a folha dispara (o mesmo caminho de orders-screen.tsx). */
function tela() {
  const estado = { periodo: periodoDoAtalho(ATALHO_PADRAO, AGORA, TZ) as Periodo, aberta: true };
  let folha = estadoAoAbrirFolha(escolhaEmVigor(estado.periodo, AGORA, TZ), HOJE);
  const tocar = (evento: EventoFolhaPeriodo) => {
    const r = eventoDaFolha(folha, evento, HOJE);
    folha = r.estado;
    if (r.atalho !== undefined) estado.periodo = periodoDoAtalho(ehAtalhoDePeriodo(r.atalho) ? r.atalho : ATALHO_PADRAO, AGORA, TZ);
    if (r.escolha) estado.periodo = periodoDaEscolha(r.escolha);
    if (r.limpar) estado.periodo = periodoDoAtalho(ATALHO_PADRAO, AGORA, TZ);
    if (r.fechar) estado.aberta = false;
  };
  return { estado, tocar, folha: () => folha };
}

describe('Pedidos: folha Período (T-0090, RF-VEN-05)', () => {
  it('RF-VEN-05: tocar num atalho aplica o período e fecha a folha', () => {
    const t = tela();
    expect(ATALHOS_DE_PERIODO.map((a) => a.rotulo)).toEqual(['Hoje', 'Ontem', 'Esta semana', 'Este mês', 'Mês passado', 'Este ano']);
    t.tocar({ tipo: 'atalho', id: 'ontem' });
    expect(t.estado.periodo).toEqual({ tipo: 'dia', valor: '2026-11-05' });
    expect(t.estado.aberta).toBe(false);
  });

  it('RF-VEN-05: o ✕ da etiqueta limpa o período e volta para Este mês, sem selo', () => {
    const t = tela();
    t.tocar({ tipo: 'atalho', id: 'hoje' });
    expect(contarFiltros({ periodo: t.estado.periodo, agora: AGORA, tz: TZ, vendedorEscolhido: false })).toBe(1);
    expect(textoDaEtiquetaDoPeriodo(t.estado.periodo, AGORA, TZ)).toBe('Hoje');
    // o ✕ da etiqueta chama removerPeriodo = aplicar o atalho padrão (a tela passa o id)
    const apos = eventoDaFolha(t.folha(), { tipo: 'atalho', id: ATALHO_PADRAO }, HOJE);
    expect(apos.atalho).toBe('este_mes');
    expect(periodoDoAtalho('este_mes', AGORA, TZ)).toEqual({ tipo: 'mes', valor: '2026-11' });
    expect(contarFiltros({ periodo: periodoDoAtalho('este_mes', AGORA, TZ), agora: AGORA, tz: TZ, vendedorEscolhido: false })).toBe(0);
  });

  it('RF-VEN-05: Limpar volta para Este mês e a folha fica aberta, nos atalhos', () => {
    const t = tela();
    t.tocar({ tipo: 'abrirEscolha' });
    t.tocar({ tipo: 'celula', escolha: { tipo: 'mes', valor: '2026-09' } });
    expect(t.estado.periodo).toEqual({ tipo: 'mes', valor: '2026-09' });
    t.estado.aberta = true;
    t.tocar({ tipo: 'limpar' });
    expect(t.estado.periodo).toEqual({ tipo: 'mes', valor: '2026-11' });
    expect(t.estado.aberta).toBe(true);
    expect(t.folha().modo).toBe('atalhos');
  });

  it('RF-VEN-05: "Escolher dia, mês ou ano" abre as abas Dia, Mês e Ano e o toque num dia aplica e fecha', () => {
    const t = tela();
    expect(t.folha().modo).toBe('atalhos');
    t.tocar({ tipo: 'abrirEscolha' });
    expect(t.folha().modo).toBe('escolher');
    for (const aba of ['dia', 'mes', 'ano'] as const) {
      t.tocar({ tipo: 'aba', aba });
      expect(t.folha().aba).toBe(aba);
    }
    t.tocar({ tipo: 'aba', aba: 'dia' });
    t.tocar({ tipo: 'celula', escolha: { tipo: 'dia', valor: '2026-11-02' } });
    expect(t.estado.periodo).toEqual({ tipo: 'dia', valor: '2026-11-02' });
    expect(t.estado.aberta).toBe(false);
    // com um dia em vigor, a folha reabre direto na aba Dia
    expect(estadoAoAbrirFolha(escolhaEmVigor(t.estado.periodo, AGORA, TZ), HOJE)).toMatchObject({ modo: 'escolher', aba: 'dia' });
  });

  it('RF-VEN-05: dia depois de hoje não aplica nem fecha', () => {
    const t = tela();
    t.tocar({ tipo: 'abrirEscolha' });
    t.tocar({ tipo: 'celula', escolha: { tipo: 'dia', valor: '2026-11-20' } });
    expect(t.estado.periodo).toEqual({ tipo: 'mes', valor: '2026-11' });
    expect(t.estado.aberta).toBe(true);
  });

  it('RF-VEN-05: período fora da janela do aparelho pede o servidor (com sinal); sem sinal, "Disponível com conexão"', () => {
    const t = tela();
    t.tocar({ tipo: 'abrirEscolha' });
    t.tocar({ tipo: 'celula', escolha: { tipo: 'mes', valor: '2026-05' } });
    const fora = periodoForaDaJanela(t.estado.periodo, AGORA, TZ);
    expect(fora).toBe(true);
    expect(estadoDaConsulta({ fora, offline: false })).toBe('consultar');
    expect(estadoDaConsulta({ fora, offline: true })).toBe('disponivel_com_conexao');
    // dentro da janela, a lista vem do aparelho
    expect(estadoDaConsulta({ fora: periodoForaDaJanela(periodoDoAtalho('hoje', AGORA, TZ), AGORA, TZ), offline: false })).toBe('local');
  });
});
