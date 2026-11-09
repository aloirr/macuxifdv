import { describe, expect, it } from 'vitest';
import { CONSULTA_CADASTRO_RESUMO, CadastroResumoSaidaSchema } from './consultas';
import { InicioSchema, InicioQuerySchema, MetaDoDiaSchema, VisaoInicioSchema } from './inicio';
import { RecadoDoDiaCorpoSchema, RecadoEnviadoSchema } from './notificacao';
import { NotificacaoSyncSchema } from './sync';
import { PARADO_MIN_MAX, PARADO_MIN_MIN, PARADO_MIN_PADRAO, PARAMETRO_PARADO_MIN, paradoMinDasLinhas } from './inicio-parametros';
import type { CardInicio } from './extensoes';

const U = '0e800000-0000-4000-8000-000000000001';
const N = '0e800000-0000-4000-8000-0000000000a1';
const meta = { indicador: 'venda_cents', situacao: 'a_cumprir', meta_mes: 3_000_000, realizado_ate_ontem: 1_200_000, realizado_hoje: 0, meta_dia: 100_000, atingimento_hoje_pct: 0, dias_uteis_restantes: 18, membros: 1, membros_mes_batido: 0 };

describe('RN-CORE-26: contrato core.inicio@1', () => {
  const inicio = {
    dia: '2026-11-10', periodo: '2026-11', calculado_em: '2026-11-10T16:00:00.000Z', escopo: 'proprio',
    usuarios: [{ usuario_id: U, nome: 'Vera', perfil: 'vendedor', equipe_id: null, tipo_meta_venda: 'pedido', venda_cents: { ate_ontem: 1_200_000, hoje: 0 }, positivacao: { ate_ontem: 20, hoje: 1 } }],
    metas_do_dia: [meta],
  };
  it('RN-CORE-26: resposta válida; promotor sem meta de venda tem venda_cents e positivacao nulos', () => {
    expect(InicioSchema.parse(inicio).metas_do_dia[0]!.meta_dia).toBe(100_000);
    expect(InicioSchema.safeParse({ ...inicio, usuarios: [{ ...inicio.usuarios[0], perfil: 'promotor', venda_cents: null, positivacao: null }] }).success).toBe(true);
  });
  it('RN-CORE-26: rejeita campo extra, perfil fora de vendedor/promotor e dinheiro fracionado', () => {
    expect(InicioSchema.safeParse({ ...inicio, extra: 1 }).success).toBe(false);
    expect(InicioSchema.safeParse({ ...inicio, usuarios: [{ ...inicio.usuarios[0], perfil: 'gerente' }] }).success).toBe(false);
    expect(InicioSchema.safeParse({ ...inicio, usuarios: [{ ...inicio.usuarios[0], venda_cents: { ate_ontem: 1.5, hoje: 0 } }] }).success).toBe(false);
  });
  it('RN-CORE-26: meta do dia aceita meta_dia nula (dia não útil e do mês) e rejeita situação desconhecida', () => {
    expect(MetaDoDiaSchema.safeParse({ ...meta, situacao: 'dia_nao_util', meta_dia: null, atingimento_hoje_pct: null }).success).toBe(true);
    expect(MetaDoDiaSchema.safeParse({ ...meta, situacao: 'atrasada' }).success).toBe(false);
  });
  it('RN-CORE-26: a rota não tem parâmetros', () => {
    expect(InicioQuerySchema.safeParse({}).success).toBe(true);
    expect(InicioQuerySchema.safeParse({ usuario_id: U }).success).toBe(false);
  });
  it('RN-CORE-26: visão da tela (recado padrão, rota e equipe nulos conforme o escopo)', () => {
    const visao = {
      escopo: 'equipe', hoje: '2026-11-10', dia_util: true, dias_uteis_restantes: 18,
      metas: [meta], rota: null, equipe_agora: [],
      base: { dia: null, calculado_em: null, defasado: false },
      saudacao: 'Bom dia', recados_hoje: { novos: 0, total: 0, itens: [] }, meta_hoje: null, sem_realizado: [],
    };
    expect(VisaoInicioSchema.safeParse(visao).success).toBe(true);
    // RD-0012: os quatro campos da boas-vindas são obrigatórios
    expect(VisaoInicioSchema.safeParse({ ...visao, saudacao: undefined }).success).toBe(false);
    expect(VisaoInicioSchema.safeParse({ ...visao, meta_hoje: undefined }).success).toBe(false);
  });
});

describe('RN-CORE-26: campos novos da notificação são aditivos no @1', () => {
  const antiga = { id: N, updated_at: '2026-11-10T10:00:00Z', deleted_at: null, external_id: null, usuario_id: U, tipo: 'recado', titulo: 'x', corpo: 'y', origem_modulo: 'core', prioridade: 'normal' };
  it('RN-CORE-26: o pull antigo (sem recado_do_dia, autor_nome, autor_perfil) continua válido', () => {
    expect(NotificacaoSyncSchema.safeParse(antiga).success).toBe(true);
  });
  it('RN-CORE-26: o pull novo traz recado_do_dia, autor_nome e autor_perfil (aceita nulos)', () => {
    const nova = NotificacaoSyncSchema.parse({ ...antiga, recado_do_dia: '2026-11-10', autor_nome: 'Sueli', autor_perfil: 'supervisor' });
    expect(nova.recado_do_dia).toBe('2026-11-10');
    expect(NotificacaoSyncSchema.safeParse({ ...antiga, recado_do_dia: null, autor_nome: null, autor_perfil: null }).success).toBe(true);
    expect(NotificacaoSyncSchema.safeParse({ ...antiga, recado_do_dia: '10/11/2026' }).success).toBe(false);
    expect(NotificacaoSyncSchema.safeParse({ ...antiga, autor_perfil: 'rei' }).success).toBe(false);
  });
  it('RN-CORE-26: RecadoEnviado aceita a entrada antiga e a marcação de hoje', () => {
    const e = { id: N, envio_id: N, titulo: 't', prioridade: 'normal', autor_id: null, destinatario_id: U, destinatario_nome: 'Vera', enviada_em: '2026-11-10T10:00:00Z', lida_em: null };
    expect(RecadoEnviadoSchema.safeParse(e).success).toBe(true);
    expect(RecadoEnviadoSchema.parse({ ...e, recado_do_dia: '2026-11-10' }).recado_do_dia).toBe('2026-11-10');
  });
  it('RN-CORE-26: o corpo de marcar o recado do dia é vazio (o dia é decidido pelo servidor)', () => {
    expect(RecadoDoDiaCorpoSchema.safeParse({}).success).toBe(true);
    expect(RecadoDoDiaCorpoSchema.safeParse({ dia: '2026-11-11' }).success).toBe(false);
  });
  it('RN-CORE-26: CardInicio aceita ordem opcional (o card antigo, sem ordem, continua válido)', () => {
    const velho: CardInicio = { testID: 'a', componente: null };
    const novo: CardInicio = { testID: 'b', componente: null, ordem: 10 };
    expect([velho.ordem, novo.ordem]).toEqual([undefined, 10]);
  });
});

describe('RN-VEN-13 e RN-CORE-16: core.cadastro_resumo@1 informa o cliente bloqueado (aditivo)', () => {
  const cliente = { id: U, razao_social: 'X', nome_fantasia: null, documento: null, logradouro: null, numero: null, bairro: null, cidade: null, uf: null, ativo: true, external_id: null };
  const saida = (c: Record<string, unknown>) => ({ clientes: [c], produtos: [], usuarios: [], enderecos: [] });
  it('RN-VEN-13: bloqueado é opcional; a saída antiga continua válida e a nova leva ao lado de cadastro_incompleto', () => {
    expect(CONSULTA_CADASTRO_RESUMO.nome).toBe('core.cadastro_resumo@1');
    expect(CadastroResumoSaidaSchema.safeParse(saida(cliente)).success).toBe(true);
    const r = CadastroResumoSaidaSchema.parse(saida({ ...cliente, bloqueado: true, cadastro_incompleto: true, cadastro_campos_faltantes: ['cep'] }));
    expect(r.clientes[0]).toMatchObject({ bloqueado: true, cadastro_incompleto: true });
  });
  it('RN-CORE-16: bloqueado só aceita booleano', () => {
    expect(CadastroResumoSaidaSchema.safeParse(saida({ ...cliente, bloqueado: 'sim' })).success).toBe(false);
  });
});

describe('RN-CORE-26: inicio.parado_min nos contracts (Gestão lê sem copiar a faixa)', () => {
  const linha = (valor: unknown, extra: object = {}) => ({ modulo: 'core', chave: PARAMETRO_PARADO_MIN, valor, ...extra });
  it('RN-CORE-26: faixa 15..480 e padrão 60', () => {
    expect([PARADO_MIN_MIN, PARADO_MIN_MAX, PARADO_MIN_PADRAO]).toEqual([15, 480, 60]);
  });
  it('RN-CORE-26: paradoMinDasLinhas devolve o valor válido; ausente, removido, de outro módulo ou fora da faixa cai no padrão', () => {
    expect(paradoMinDasLinhas([linha(90)])).toBe(90);
    expect(paradoMinDasLinhas([linha(15)])).toBe(15);
    expect(paradoMinDasLinhas([linha(480)])).toBe(480);
    expect(paradoMinDasLinhas([])).toBe(60);
    expect(paradoMinDasLinhas([linha(90, { deleted_at: '2026-11-01T00:00:00Z' })])).toBe(60);
    expect(paradoMinDasLinhas([linha(90, { modulo: 'vendedor' })])).toBe(60);
    for (const v of [14, 481, 30.5, '90', null]) expect(paradoMinDasLinhas([linha(v)])).toBe(60);
  });
});
