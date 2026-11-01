import { describe, expect, it } from 'vitest';
import { avancarCursor } from './cursor';
import { calcularResultadoLote } from './erros';
import { calcularInativacao, novaSessao, registrarParte } from './sessao';
import { criarPendencia, decidirPendencia, filtrarAtivosElegiveis, resultadoInativacaoDoLote, situacaoPendencia } from './inativacao';

const t0 = '2026-11-01T10:00:00.000Z';
const dias = (iso: string, d: number) => new Date(Date.parse(iso) + d * 86_400_000).toISOString();
const sessaoCompleta = () => registrarParte(novaSessao('s1', 'cliente', t0), { parte: 1, ultimo: true, status: 'concluido' });
const ativos = Array.from({ length: 10 }, (_, i) => `A${i}`);
const ADMIN = { usuario_id: '00000000-0000-4000-8000-0000000000ad', perfil: 'admin' } as const;
const ANALISTA = { usuario_id: '00000000-0000-4000-8000-0000000000a1', perfil: 'analista' } as const;

describe('RN-INT-06: quais ativos podem ser inativados pela carga completa', () => {
  it('RN-INT-06: registro visto (por delta) DEPOIS do início da sessão não é candidato — ele nasceu durante a carga', () => {
    const elegiveis = filtrarAtivosElegiveis(
      [
        { external_id: 'velho', visto_em: '2026-10-01T00:00:00.000Z' },
        { external_id: 'novo-durante-a-carga', visto_em: '2026-11-01T10:00:05.000Z' },
        { external_id: 'mesmo-instante', visto_em: t0 },
      ],
      t0,
    );
    expect(elegiveis).toEqual(['velho']);
  });
});

describe('RN-INT-06: trava de inativação em massa → pendência de confirmação no BKO', () => {
  const excede = () => calcularInativacao({ sessao: sessaoCompleta(), agora: t0, ativosNoMacuxi: ativos, recebidosNaSessao: ativos.slice(0, 5) });

  it('RN-INT-06: acima de 30% dos ativos a inativação não acontece e vira pendência aguardando, com o percentual', () => {
    const r = excede();
    expect(r).toMatchObject({ permitido: false, motivo: 'excede_limite_inativacao' });
    const p = criarPendencia(r, { id: 'p1', sessao_id: 's1', entidade: 'cliente', lote_id: 'L9', conector_id: 'matriz-01', agora: t0, totalAtivos: 10 });
    expect(p).toMatchObject({ estado: 'aguardando', candidatos: 5, total_ativos: 10, percentual: 50, limite_pct: 30, lote_id: 'L9' });
    expect(p.amostra).toEqual(['A5', 'A6', 'A7', 'A8', 'A9']);
    expect(p.expira_em).toBe(dias(t0, 7));
  });

  it('RN-INT-06: a amostra do BKO tem no máximo 50 external_id', () => {
    const muitos = Array.from({ length: 200 }, (_, i) => `X${i}`);
    const r = calcularInativacao({ sessao: sessaoCompleta(), agora: t0, ativosNoMacuxi: muitos, recebidosNaSessao: ['X0'] });
    const p = criarPendencia(r, { id: 'p', sessao_id: 's1', entidade: 'cliente', lote_id: 'L', conector_id: 'c', agora: t0, totalAtivos: 200 });
    expect(p.amostra).toHaveLength(50);
    expect(p.candidatos).toBe(199);
  });

  it('RN-INT-06: criar pendência para resultado que não excedeu é erro de programação (exceção clara)', () => {
    const ok = calcularInativacao({ sessao: sessaoCompleta(), agora: t0, ativosNoMacuxi: ativos, recebidosNaSessao: ativos });
    expect(() => criarPendencia(ok, { id: 'p', sessao_id: 's1', entidade: 'cliente', lote_id: 'L', conector_id: 'c', agora: t0, totalAtivos: 10 })).toThrow(/excede_limite_inativacao/);
  });

  it('RN-INT-06: confirmar pede reavaliação com confirmado=true; recusar encerra sem inativar', () => {
    const p = criarPendencia(excede(), { id: 'p1', sessao_id: 's1', entidade: 'cliente', lote_id: 'L9', conector_id: 'matriz-01', agora: t0, totalAtivos: 10 });
    const c = decidirPendencia(p, 'confirmar', dias(t0, 1), ADMIN);
    expect(c).toMatchObject({ ok: true, reavaliarComConfirmacao: true });
    if (c.ok) expect(c.pendencia).toMatchObject({ estado: 'confirmada', decidida_em: dias(t0, 1) });
    const r = decidirPendencia(p, 'recusar', dias(t0, 1), ADMIN);
    expect(r).toMatchObject({ ok: true, reavaliarComConfirmacao: false });
    if (r.ok) expect(r.pendencia.estado).toBe('recusada');
  });

  it('RN-INT-06: a confirmação reavaliada inativa só o que ainda está ausente (confirmado ignora o limite)', () => {
    const r = calcularInativacao({ sessao: sessaoCompleta(), agora: t0, ativosNoMacuxi: ativos, recebidosNaSessao: ativos.slice(0, 5), confirmado: true });
    expect(r).toMatchObject({ permitido: true });
    expect(r.inativar).toEqual(['A5', 'A6', 'A7', 'A8', 'A9']);
  });

  it('RN-INT-06: pendência expira em 7 dias; decidir depois disso é recusado (precisa de nova carga completa)', () => {
    const p = criarPendencia(excede(), { id: 'p1', sessao_id: 's1', entidade: 'cliente', lote_id: 'L9', conector_id: 'matriz-01', agora: t0, totalAtivos: 10 });
    expect(situacaoPendencia(p, dias(t0, 6))).toBe('aguardando');
    expect(situacaoPendencia(p, dias(t0, 7))).toBe('expirada');
    const r = decidirPendencia(p, 'confirmar', dias(t0, 8), ADMIN);
    expect(r).toMatchObject({ ok: false, codigo: 'pendencia_expirada' });
    if (!r.ok) expect(r.mensagem).toMatch(/carga completa/);
  });

  it('RN-INT-06: decidir duas vezes é recusado (já decidida), sem inativar de novo', () => {
    const p = criarPendencia(excede(), { id: 'p1', sessao_id: 's1', entidade: 'cliente', lote_id: 'L9', conector_id: 'matriz-01', agora: t0, totalAtivos: 10 });
    const c = decidirPendencia(p, 'confirmar', t0, ADMIN);
    if (!c.ok) throw new Error('esperado ok');
    expect(decidirPendencia(c.pendencia, 'confirmar', t0, ADMIN)).toMatchObject({ ok: false, codigo: 'pendencia_ja_decidida' });
    expect(decidirPendencia(c.pendencia, 'recusar', t0, ADMIN)).toMatchObject({ ok: false, codigo: 'pendencia_ja_decidida' });
  });
});

describe('RN-INT-06 / P-3: quem confirma a inativação em massa e a auditoria da decisão', () => {
  const pend = () =>
    criarPendencia(calcularInativacao({ sessao: sessaoCompleta(), agora: t0, ativosNoMacuxi: ativos, recebidosNaSessao: ativos.slice(0, 5) }), {
      id: 'p1', sessao_id: 's1', entidade: 'cliente', lote_id: 'L9', conector_id: 'matriz-01', agora: t0, totalAtivos: 10,
    });

  it('P-3: pendência nova nasce sem autor nem motivo da decisão', () => {
    expect(pend()).toMatchObject({ decidida_em: null, decidida_por: null, decidida_por_perfil: null, motivo_decisao: null });
  });

  it('P-3: admin confirma — a pendência guarda quem decidiu e sai a auditoria (quem, quando, lote, quantidade)', () => {
    const r = decidirPendencia(pend(), 'confirmar', dias(t0, 1), ADMIN, '  ERP limpou clientes inativos  ');
    expect(r).toMatchObject({ ok: true, reavaliarComConfirmacao: true });
    if (!r.ok) throw new Error('esperado ok');
    expect(r.pendencia).toMatchObject({ estado: 'confirmada', decidida_por: ADMIN.usuario_id, decidida_por_perfil: 'admin', motivo_decisao: 'ERP limpou clientes inativos' });
    expect(r.auditoria).toEqual({
      pendencia_id: 'p1', sessao_id: 's1', lote_id: 'L9', entidade: 'cliente', conector_id: 'matriz-01', acao: 'confirmar',
      decidida_por: ADMIN.usuario_id, perfil: 'admin', decidida_em: dias(t0, 1), quantidade: 5, total_ativos: 10, percentual: 50,
      motivo: 'ERP limpou clientes inativos',
    });
  });

  it('P-3: analista também pode confirmar e recusar (com auditoria)', () => {
    const c = decidirPendencia(pend(), 'confirmar', t0, ANALISTA);
    expect(c).toMatchObject({ ok: true, auditoria: { acao: 'confirmar', decidida_por: ANALISTA.usuario_id, perfil: 'analista', lote_id: 'L9', quantidade: 5, motivo: null } });
    const r = decidirPendencia(pend(), 'recusar', t0, ANALISTA, 'carga veio pela metade');
    expect(r).toMatchObject({ ok: true, reavaliarComConfirmacao: false, pendencia: { estado: 'recusada', decidida_por_perfil: 'analista' }, auditoria: { acao: 'recusar', motivo: 'carga veio pela metade' } });
  });

  it.each(['supervisor', 'vendedor', 'gerente', 'promotor', 'assistente'] as const)('P-3: %s não confirma nem recusa — 403 perfil_sem_acesso, pendência intacta', (perfil) => {
    const p = pend();
    for (const acao of ['confirmar', 'recusar'] as const) {
      const r = decidirPendencia(p, acao, t0, { usuario_id: 'u', perfil });
      expect(r).toMatchObject({ ok: false, status: 403, codigo: 'perfil_sem_acesso' });
      if (!r.ok) expect(r.mensagem).toMatch(/administrador ou analista/);
    }
    expect(p.estado).toBe('aguardando');
  });

  it('P-3: o perfil é conferido antes do estado — supervisor recebe 403 mesmo em pendência vencida ou já decidida', () => {
    const vencida = pend();
    expect(decidirPendencia(vencida, 'confirmar', dias(t0, 8), { usuario_id: 'u', perfil: 'supervisor' })).toMatchObject({ status: 403 });
    const decidida = decidirPendencia(pend(), 'recusar', t0, ADMIN);
    if (!decidida.ok) throw new Error('esperado ok');
    expect(decidirPendencia(decidida.pendencia, 'confirmar', t0, { usuario_id: 'u', perfil: 'vendedor' })).toMatchObject({ status: 403 });
  });

  it('P-3: motivo vazio vira null e motivo longo é cortado em 300 caracteres na auditoria', () => {
    const vazio = decidirPendencia(pend(), 'recusar', t0, ADMIN, '   ');
    expect(vazio.ok && vazio.auditoria.motivo).toBeNull();
    const longo = decidirPendencia(pend(), 'recusar', t0, ADMIN, 'x'.repeat(400));
    expect(longo.ok && longo.auditoria.motivo).toHaveLength(300);
  });
});

describe('RN-INT-06: o que o Conector lê no resultado do último lote da sessão', () => {
  it('RN-INT-06: excede → aguardando_confirmacao com candidatos e percentual', () => {
    const r = calcularInativacao({ sessao: sessaoCompleta(), agora: t0, ativosNoMacuxi: ativos, recebidosNaSessao: ativos.slice(0, 5) });
    expect(resultadoInativacaoDoLote(r, 10)).toEqual({ situacao: 'aguardando_confirmacao', motivo: 'excede_limite_inativacao', candidatos: 5, percentual: 50 });
  });

  it('RN-INT-06: permitido → aplicada com a quantidade inativada', () => {
    const r = calcularInativacao({ sessao: sessaoCompleta(), agora: t0, ativosNoMacuxi: ativos, recebidosNaSessao: ativos.slice(0, 8) });
    expect(resultadoInativacaoDoLote(r, 10)).toEqual({ situacao: 'aplicada', motivo: null, candidatos: 2, percentual: 20 });
  });

  it('RN-INT-06: qualquer outro motivo (sessão incompleta, carga vazia, linhas sem id) → nao_aplicavel com o motivo', () => {
    const aberta = calcularInativacao({ sessao: novaSessao('s', 'cliente', t0), agora: t0, ativosNoMacuxi: ativos, recebidosNaSessao: ['A0'] });
    expect(resultadoInativacaoDoLote(aberta, 10)).toMatchObject({ situacao: 'nao_aplicavel', motivo: 'sessao_incompleta', candidatos: 0 });
    const omitidas = calcularInativacao({ sessao: sessaoCompleta(), agora: t0, ativosNoMacuxi: ativos, recebidosNaSessao: ['A0'], linhasInvalidasOmitidas: 1 });
    expect(resultadoInativacaoDoLote(omitidas, 10)).toMatchObject({ situacao: 'nao_aplicavel', motivo: 'linhas_invalidas_omitidas' });
  });

  it('RN-INT-06: lote delta ou parte que não fecha a sessão → nao_aplicavel sem motivo', () => {
    expect(resultadoInativacaoDoLote(null, 10)).toEqual({ situacao: 'nao_aplicavel', motivo: null, candidatos: 0, percentual: 0 });
  });
});

describe('RN-INT-06 (P-2, T-0027): "lote parado" = lote APLICADO, só as inativações aguardam confirmação', () => {
  it('RN-INT-06 (P-2): o último lote da sessão termina concluido, o cursor avança e o resultado traz inativacao aguardando_confirmacao', () => {
    const res = calcularResultadoLote({ recebidas: 5, duplicadas_no_lote: 0, erros: [], novas: 0, atualizadas: 0, inalteradas: 5 });
    expect(res.status).toBe('concluido');
    const candidato = { alterado_em: '2026-11-01T09:59:00.000Z', external_id: 'A4' };
    expect(avancarCursor({ alterado_em: '2026-10-01T00:00:00.000Z', external_id: 'A0' }, candidato, res.status)).toEqual({ cursor: candidato, avancou: true });
    const sessao = registrarParte(novaSessao('s1', 'cliente', t0), { parte: 1, ultimo: true, status: res.status });
    const r = calcularInativacao({ sessao, agora: t0, ativosNoMacuxi: ativos, recebidosNaSessao: ativos.slice(0, 5) });
    expect(resultadoInativacaoDoLote(r, 10)).toEqual({ situacao: 'aguardando_confirmacao', motivo: 'excede_limite_inativacao', candidatos: 5, percentual: 50 });
    // nada foi inativado: só a pendência espera o operador (admin ou analista, P-3) no BKO
    expect(r.inativar).toEqual([]);
  });
});
