import { describe, expect, it } from 'vitest';
import { montarResumo, type LinhaConector } from './bko-comum';

const conector = (extra: Partial<LinhaConector>): LinhaConector => ({
  id: '11111111-1111-4111-8111-111111111111',
  identificador: 'erp-teste',
  nome: 'ERP Teste',
  tipo: 'conector',
  ativo: true,
  recebe_pedidos: true,
  entidades: ['cliente'],
  ips_permitidos: [],
  versao_conector: '1.2.0',
  parado_por_versao: false,
  ultimo_sinal_em: new Date(0),
  created_at: new Date(0),
  ...extra,
});
const AGORA = '1970-01-01T00:10:00.000Z';

describe('RN-INT-11: o BKO mostra a política EFETIVA (a que o Hub aplica), não só a gravada', () => {
  it('RN-INT-11: Conector 1.2.0 que recebe pedidos, sem linha da empresa, aparece abaixo da mínima (o Hub devolve 426 para ele)', () => {
    expect(montarResumo(conector({}), undefined, null, AGORA).situacao_versao).toBe('abaixo_da_minima');
  });

  it('RN-INT-11: Conector 1.2.1 que recebe pedidos, sem linha da empresa, está em dia com o padrão do Hub', () => {
    expect(montarResumo(conector({ versao_conector: '1.2.1' }), undefined, null, AGORA).situacao_versao).toBe('em_dia');
  });

  it('RN-INT-11: Conector que NÃO recebe pedidos e sem linha fica sem política (nunca bloqueia)', () => {
    expect(montarResumo(conector({ recebe_pedidos: false }), undefined, null, AGORA).situacao_versao).toBe('sem_politica');
  });

  it('RN-INT-11: a linha gravada pela empresa manda, mesmo abaixo do piso (exceção gravada por SQL)', () => {
    const gravada = { versao_minima: '1.1.0', versao_recomendada: '1.2.0', mensagem: null, pacote: null };
    expect(montarResumo(conector({}), undefined, gravada, AGORA).situacao_versao).toBe('em_dia');
  });
});
