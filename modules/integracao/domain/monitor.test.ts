import { describe, expect, it } from 'vitest';
import { avaliarSaudeConector, montarAlertasMonitor } from './monitor';

const t0 = '2026-11-01T10:00:00.000Z';
const min = (iso: string, m: number) => new Date(Date.parse(iso) + m * 60_000).toISOString();
const conector = (extra = {}) => ({ conector_id: 'matriz-01', ativo: true, ultimo_sinal_em: t0, parado_por_versao: false, situacao_versao: 'em_dia' as const, ...extra });

describe('RF-INT-04/doc 06: saúde do Conector no monitor', () => {
  it('doc 06: sinal a cada 1 min — ok até 3 min; atrasado de 3 a 15 min; sem_sinal a partir de 15 min (alerta)', () => {
    expect(avaliarSaudeConector(conector(), min(t0, 2))).toBe('ok');
    expect(avaliarSaudeConector(conector(), min(t0, 3))).toBe('atrasado');
    expect(avaliarSaudeConector(conector(), min(t0, 14))).toBe('atrasado');
    expect(avaliarSaudeConector(conector(), min(t0, 15))).toBe('sem_sinal');
  });

  it('RN-INT-11 (proposta): parado por versão aparece quando o sinal está fresco; sem sinal vence (o Conector nem está no ar)', () => {
    expect(avaliarSaudeConector(conector({ parado_por_versao: true }), min(t0, 1))).toBe('parado_por_versao');
    expect(avaliarSaudeConector(conector({ parado_por_versao: true }), min(t0, 20))).toBe('sem_sinal');
  });

  it('RF-INT-04: nunca conectou e desativado têm estado próprio', () => {
    expect(avaliarSaudeConector(conector({ ultimo_sinal_em: null }), t0)).toBe('nunca_conectou');
    expect(avaliarSaudeConector(conector({ ativo: false }), t0)).toBe('desativado');
  });
});

describe('RF-INT-04/06: alertas do monitor em português com a ação seguinte', () => {
  const vazio = { agora: t0, conectores: [], lotesFalhosUltimas24h: [], pendenciasInativacao: [], reconciliacoesDivergentes: [], pedidos: { presos: [], retidos: [] } };

  it('sem nada errado, sem alertas', () => {
    expect(montarAlertasMonitor({ ...vazio, conectores: [conector()] })).toEqual([]);
  });

  it('doc 06: Conector 15 min sem sinal → crítico, com a orientação de verificar o serviço', () => {
    const a = montarAlertasMonitor({ ...vazio, conectores: [conector({ ultimo_sinal_em: min(t0, -20) })] });
    expect(a).toEqual([expect.objectContaining({ codigo: 'conector_sem_sinal', severidade: 'critico', conector_id: 'matriz-01' })]);
    expect(a[0]?.mensagem).toMatch(/serviço/i);
  });

  it('RN-INT-11 (proposta): abaixo da mínima = crítico (parado); abaixo da recomendada = atenção', () => {
    const parado = montarAlertasMonitor({ ...vazio, conectores: [conector({ parado_por_versao: true, situacao_versao: 'abaixo_da_minima' })] });
    expect(parado[0]).toMatchObject({ codigo: 'conector_parado_por_versao', severidade: 'critico' });
    const desat = montarAlertasMonitor({ ...vazio, conectores: [conector({ situacao_versao: 'desatualizado' })] });
    expect(desat[0]).toMatchObject({ codigo: 'conector_desatualizado', severidade: 'atencao' });
  });

  it('RF-INT-04: nunca conectou → atenção; desativado não alerta', () => {
    expect(montarAlertasMonitor({ ...vazio, conectores: [conector({ ultimo_sinal_em: null })] })[0]).toMatchObject({ codigo: 'conector_nunca_conectou', severidade: 'atencao' });
    expect(montarAlertasMonitor({ ...vazio, conectores: [conector({ ativo: false, ultimo_sinal_em: null })] })).toEqual([]);
  });

  it('RN-INT-06: inativação aguardando confirmação → atenção, citando a entidade e o percentual', () => {
    const a = montarAlertasMonitor({ ...vazio, pendenciasInativacao: [{ entidade: 'cliente', conector_id: 'matriz-01', candidatos: 40, percentual: 40, estado: 'aguardando' }] });
    expect(a[0]).toMatchObject({ codigo: 'inativacao_aguardando_confirmacao', severidade: 'atencao', entidade: 'cliente' });
    expect(a[0]?.mensagem).toMatch(/40/);
  });

  it('RN-INT-07: reconciliação divergente → crítico', () => {
    const a = montarAlertasMonitor({ ...vazio, reconciliacoesDivergentes: [{ entidade: 'preco', data_referencia: '2026-11-01', motivos: ['soma_divergente'] }] });
    expect(a[0]).toMatchObject({ codigo: 'reconciliacao_divergente', severidade: 'critico', entidade: 'preco' });
  });

  it('RN-INT-03: lotes que falharam nas últimas 24 h → atenção, um alerta por entidade', () => {
    const a = montarAlertasMonitor({ ...vazio, lotesFalhosUltimas24h: [{ entidade: 'estoque', conector_id: 'matriz-01' }, { entidade: 'estoque', conector_id: 'matriz-01' }] });
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({ codigo: 'lotes_falhos', entidade: 'estoque' });
    expect(a[0]?.mensagem).toMatch(/2/);
  });

  it('RN-INT-08: pedido preso (5+ tentativas sem confirmação) e retido sem mapeamento viram alertas', () => {
    const a = montarAlertasMonitor({ ...vazio, pedidos: { presos: ['p1', 'p2'], retidos: ['p3'] } });
    expect(a.map((x) => x.codigo)).toEqual(['pedido_preso', 'pedido_retido_sem_mapeamento']);
    expect(a[0]?.mensagem).toMatch(/2 pedido/);
    expect(a[1]?.mensagem).toMatch(/Mapeamento/);
  });

  it('RN-INT-08 (T-0032): pedido retido por falta das chaves do ERP tem alerta próprio na mensagem (completar o cadastro e reaprovar), sem mandar para o Mapeamento', () => {
    const a = montarAlertasMonitor({ ...vazio, pedidos: { presos: [], retidos: ['p1', 'p2'], retidosPorChaveErp: ['p1', 'p2'] } });
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({ codigo: 'pedido_retido_sem_mapeamento' });
    expect(a[0]?.mensagem).toMatch(/2 pedidos/);
    expect(a[0]?.mensagem).toMatch(/chaves do ERP/);
    expect(a[0]?.mensagem).toMatch(/reaprove/i);
    expect(a[0]?.mensagem).not.toMatch(/Mapeamento/);
  });

  it('RN-INT-08 (T-0032): retidos por mapeamento e por chave juntos: o alerta cita os dois motivos, cada um com sua ação', () => {
    const a = montarAlertasMonitor({ ...vazio, pedidos: { presos: [], retidos: ['p1', 'p2', 'p3'], retidosPorChaveErp: ['p3'] } });
    expect(a).toHaveLength(1);
    expect(a[0]?.mensagem).toMatch(/Mapeamento/);
    expect(a[0]?.mensagem).toMatch(/chaves do ERP/);
  });

  it('P-4: itens faturados descartados nas últimas 24 h viram um alerta de atenção com itens, pedidos e a ação seguinte', () => {
    expect(montarAlertasMonitor({ ...vazio, retornosComItensDescartados24h: [] })).toEqual([]);
    const a = montarAlertasMonitor({
      ...vazio,
      retornosComItensDescartados24h: [
        { pedido_uuid: 'p1', produto_external_id: 'SKU9' },
        { pedido_uuid: 'p1', produto_external_id: 'X' },
        { pedido_uuid: 'p2', produto_external_id: 'SKU1' },
      ],
    });
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({ codigo: 'retorno_com_itens_descartados', severidade: 'atencao', conector_id: null, entidade: null });
    expect(a[0]?.mensagem).toMatch(/3 itens faturados de 2 pedidos ficaram de fora/);
    expect(a[0]?.mensagem).toMatch(/status dos pedidos foi atualizado/);
    expect(a[0]?.mensagem).not.toMatch(/SKU9/); // o detalhe (external_id) fica na lista de erros, não no alerta
    const um = montarAlertasMonitor({ ...vazio, retornosComItensDescartados24h: [{ pedido_uuid: 'p1', produto_external_id: 'X' }] });
    expect(um[0]?.mensagem).toMatch(/^1 item faturado de 1 pedido ficou de fora/);
  });

  it('RN-INT-10 (proposta): chave anterior ainda em uso depois da rotação → info, para o operador revogar', () => {
    const a = montarAlertasMonitor({ ...vazio, conectores: [conector({ chave_anterior_em_uso: true })] });
    expect(a[0]).toMatchObject({ codigo: 'chave_em_convivencia', severidade: 'info' });
  });

  it('os alertas saem do mais grave ao menos grave', () => {
    const a = montarAlertasMonitor({
      ...vazio,
      conectores: [conector({ situacao_versao: 'desatualizado', chave_anterior_em_uso: true }), conector({ conector_id: 'b', ultimo_sinal_em: min(t0, -30) })],
    });
    expect(a.map((x) => x.severidade)).toEqual(['critico', 'atencao', 'info']);
  });
});
