import { describe, expect, it } from 'vitest';
import { avaliarCheckoutTolerante, baixarPendenciasPorEvento, pendenciaViraAlerta, prazoAlertaPendenciaH, textoAlertaPendencia } from './checkout-tolerancia';
import type { EntradaCheckoutNoServidor, VerificacaoEtapaServidor } from './checkout-servidor';

const base: EntradaCheckoutNoServidor = {
  resultadoInformado: 'sem_pedido', vendedorEfetivo: true, motivoId: 'm1', motivoTexto: null,
  motivo: { tipo: 'nao_venda', ativo: true }, fotoFachada: false, temPedido: false, verificacoes: [],
};
const pesq = (concluida: boolean, obrigatoria = true): VerificacaoEtapaServidor => ({ modulo: 'pesquisa', etapa: 'pesquisa.preco', rotulo: 'Pesquisa de preço', obrigatoria, concluida });

describe('RN-CORE-12: tolerância no checkout', () => {
  it('RN-CORE-12: sem etapas pendentes aceita sem pendência', () => {
    expect(avaliarCheckoutTolerante({ ...base, verificacoes: [pesq(true)] })).toMatchObject({ decisao: 'aceitar', etapasPendentes: 0 });
  });
  it('RN-CORE-12: etapa obrigatória de outro módulo não concluída aceita com pendência (não recusa)', () => {
    const r = avaliarCheckoutTolerante({ ...base, verificacoes: [pesq(false)] });
    expect(r).toMatchObject({ decisao: 'aceitar_com_pendencias', etapasPendentes: 1 });
    expect(r.etapasRegistro).toEqual([{ modulo: 'pesquisa', etapa: 'pesquisa.preco', rotulo: 'Pesquisa de preço', situacao: 'pendente' }]);
  });
  it('RN-CORE-12: etapa não obrigatória não concluída não gera pendência nem registro', () => {
    expect(avaliarCheckoutTolerante({ ...base, verificacoes: [pesq(false, false)] })).toMatchObject({ decisao: 'aceitar', etapasRegistro: [] });
  });
  it('RN-CORE-12: motivo de sem pedido fora da lista do tenant continua recusado', () => {
    expect(avaliarCheckoutTolerante({ ...base, motivo: null, verificacoes: [pesq(false)] })).toMatchObject({ decisao: 'recusar', codigo: 'MOTIVO_INVALIDO' });
  });
  it('RN-CORE-12: sem motivo algum recusa pelas regras do Core, mesmo com etapa pendente', () => {
    expect(avaliarCheckoutTolerante({ ...base, motivoId: null, motivo: null, verificacoes: [pesq(false)] })).toMatchObject({ decisao: 'recusar', codigo: 'RN-CORE-12', pendencias: ['motivo'] });
  });
  it('RN-CORE-14: cliente fechado dispensa a etapa, sem pendência', () => {
    const r = avaliarCheckoutTolerante({ ...base, resultadoInformado: 'cliente_fechado', motivo: { tipo: 'cliente_fechado', ativo: true }, fotoFachada: true, verificacoes: [pesq(false)] });
    expect(r).toMatchObject({ decisao: 'aceitar', etapasPendentes: 0 });
    expect(r.etapasRegistro[0]?.situacao).toBe('dispensada');
  });
  it('RN-CORE-14: cliente fechado sem foto da fachada continua recusado', () => {
    expect(avaliarCheckoutTolerante({ ...base, resultadoInformado: 'cliente_fechado', motivo: { tipo: 'cliente_fechado', ativo: true }, verificacoes: [pesq(false)] })).toMatchObject({ decisao: 'recusar', codigo: 'RN-CORE-14' });
  });
});

describe('RN-CORE-12: baixa da pendência por pesquisa.resposta.registrada@1', () => {
  const linhas = [
    { visitaId: 'v1', modulo: 'pesquisa', etapa: 'pesquisa.preco', situacao: 'pendente' as const },
    { visitaId: 'v1', modulo: 'pesquisa', etapa: 'pesquisa.ruptura', situacao: 'pendente' as const },
    { visitaId: 'v2', modulo: 'pesquisa', etapa: 'pesquisa.preco', situacao: 'pendente' as const },
  ];
  const ent = { linhas, visitaId: 'v1', modulo: 'pesquisa', referenciaId: 'r1', agora: '2026-11-05T10:00:00Z' };
  it('RN-CORE-12: baixa só a etapa que a reconsulta dá como concluída, na mesma visita', () => {
    const r = baixarPendenciasPorEvento({ ...ent, reconsulta: [{ etapa: 'pesquisa.preco', concluida: true }, { etapa: 'pesquisa.ruptura', concluida: false }] });
    expect(r.baixar).toEqual([{ etapa: 'pesquisa.preco', referenciaId: 'r1', resolvidaEm: '2026-11-05T10:00:00Z' }]);
    expect(r.etapasPendentes).toBe(1);
  });
  it('RN-CORE-12: resposta sem visita ou sem linha pendente não faz nada (idempotente)', () => {
    expect(baixarPendenciasPorEvento({ ...ent, visitaId: null, reconsulta: [{ etapa: 'pesquisa.preco', concluida: true }] }).baixar).toEqual([]);
    const ja = linhas.map((l) => ({ ...l, situacao: 'concluida' as const }));
    expect(baixarPendenciasPorEvento({ ...ent, linhas: ja, reconsulta: [{ etapa: 'pesquisa.preco', concluida: true }] })).toEqual({ baixar: [], etapasPendentes: 0 });
  });
  it('RN-CORE-12: resposta de outro módulo não baixa pendência da pesquisa', () => {
    expect(baixarPendenciasPorEvento({ ...ent, modulo: 'promotor', reconsulta: [{ etapa: 'pesquisa.preco', concluida: true }] }).baixar).toEqual([]);
  });
});

describe('RN-CORE-12: pendência vira alerta após checkout_pendencia_alerta_h', () => {
  const p = { situacao: 'pendente' as const, pendenteDesde: '2026-11-04T10:00:00Z', alertadaEm: null };
  it('RN-CORE-12: padrão 24 h; antes do prazo não alerta, no prazo alerta', () => {
    expect(pendenciaViraAlerta({ ...p, agora: '2026-11-05T09:59:00Z' })).toBe(false);
    expect(pendenciaViraAlerta({ ...p, agora: '2026-11-05T10:00:00Z' })).toBe(true);
  });
  it('RN-CORE-12: prazo configurado vale; inválido cai em 24; limites 1..168', () => {
    expect(pendenciaViraAlerta({ ...p, agora: '2026-11-04T12:00:00Z', prazoH: 2 })).toBe(true);
    expect(prazoAlertaPendenciaH(0)).toBe(24);
    expect(prazoAlertaPendenciaH(169)).toBe(24);
    expect(prazoAlertaPendenciaH(1.5)).toBe(24);
    expect(prazoAlertaPendenciaH(168)).toBe(168);
  });
  it('RN-CORE-12: já alertada, baixada ou dispensada não alerta de novo', () => {
    const agora = '2026-11-06T10:00:00Z';
    expect(pendenciaViraAlerta({ ...p, agora, alertadaEm: '2026-11-05T11:00:00Z' })).toBe(false);
    expect(pendenciaViraAlerta({ ...p, agora, situacao: 'concluida' })).toBe(false);
  });
  const rot = 'Pesquisa obrigatória: "Gôndola do mês"';
  it('RN-CORE-12: texto do alerta do vendedor, data dd/mm no fuso do tenant, sem repetir obrigatória nem ponto final', () => {
    const t = textoAlertaPendencia({ destinatario: 'vendedor', rotulo: rot, clienteNome: 'Mercado X', visitaEm: '2026-11-05T02:00:00Z', fusoTenant: 'America/Manaus' });
    expect(t.titulo).toBe('Etapa pendente na visita a Mercado X');
    expect(t.corpo).toBe('Pesquisa obrigatória: "Gôndola do mês" · visita de 04/11 · confira a fila do aparelho ou fale com seu supervisor');
    expect(`${t.titulo} ${t.corpo}`).not.toMatch(/servidor/);
    expect(t.corpo).not.toMatch(/\.$/);
    expect(t.corpo.match(/obrigatória/g)).toHaveLength(1);
  });
  it('RN-CORE-12: texto do alerta do supervisor usa o primeiro nome do vendedor e o prazo', () => {
    const t = textoAlertaPendencia({ destinatario: 'supervisor', rotulo: rot, clienteNome: 'Mercado X', visitaEm: '2026-11-05T02:00:00Z', fusoTenant: 'America/Manaus', vendedorNome: 'Maria da Silva', prazoH: 24 });
    expect(t.titulo).toBe('Etapa pendente na visita de Maria a Mercado X');
    expect(t.corpo).toBe('Pesquisa obrigatória: "Gôndola do mês" · visita de 04/11 · não chegou em 24 h');
  });
  it('RN-CORE-12: prazo inválido no texto do supervisor cai no padrão de 24 h', () => {
    const t = textoAlertaPendencia({ destinatario: 'supervisor', rotulo: rot, clienteNome: 'X', visitaEm: '2026-11-05T12:00:00Z', fusoTenant: 'America/Manaus', vendedorNome: 'Ana', prazoH: 999 });
    expect(t.corpo).toMatch(/não chegou em 24 h$/);
  });
});
