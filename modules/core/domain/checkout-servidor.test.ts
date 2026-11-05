import { describe, expect, it } from 'vitest';
import { avaliarCheckoutNoServidor, type EntradaCheckoutNoServidor, type VerificacaoEtapaServidor } from './checkout-servidor';

const base: EntradaCheckoutNoServidor = {
  resultadoInformado: 'sem_pedido',
  vendedorEfetivo: true,
  motivoId: 'm1',
  motivoTexto: null,
  motivo: { tipo: 'nao_venda', ativo: true },
  fotoFachada: false,
  temPedido: false,
  verificacoes: [],
};
const pesquisa = (concluida: boolean): VerificacaoEtapaServidor => ({ modulo: 'pesquisa', etapa: 'pesquisa.preco', rotulo: 'Pesquisa de preço', obrigatoria: true, concluida });
const fechado = { tipo: 'cliente_fechado', ativo: true } as const;

describe('RN-CORE-12: checkout validado na API', () => {
  it('RN-CORE-12: motivo da lista do tenant, sem etapas pendentes, passa', () => {
    expect(avaliarCheckoutNoServidor(base)).toMatchObject({ pode: true, codigo: null });
  });

  it('RN-CORE-12: motivo_id fora da lista do tenant (inexistente ou de outro tenant) é recusado como MOTIVO_INVALIDO', () => {
    expect(avaliarCheckoutNoServidor({ ...base, motivo: null })).toMatchObject({ pode: false, codigo: 'MOTIVO_INVALIDO' });
  });

  it('RN-CORE-12: motivo desativado depois do checkout offline é aceito', () => {
    const r = avaliarCheckoutNoServidor({ ...base, checkoutEm: '2026-11-04T10:00:00Z', motivo: { tipo: 'nao_venda', ativo: false, desativadoEm: '2026-11-04T12:00:00Z' } });
    expect(r.pode).toBe(true);
  });
  it('RN-CORE-12: motivo desativado antes do checkout é recusado', () => {
    const r = avaliarCheckoutNoServidor({ ...base, checkoutEm: '2026-11-04T13:00:00Z', motivo: { tipo: 'nao_venda', ativo: false, desativadoEm: '2026-11-04T12:00:00Z' } });
    expect(r).toMatchObject({ pode: false, codigo: 'MOTIVO_INVALIDO' });
  });
  it('RN-CORE-12: motivo desativado do tenant sem data de desativação é aceito', () => {
    expect(avaliarCheckoutNoServidor({ ...base, motivo: { tipo: 'nao_venda', ativo: false } }).pode).toBe(true);
  });

  it('RN-CORE-12: sem_pedido sem motivo nenhum pede o motivo; texto livre continua valendo como motivo', () => {
    const sem = avaliarCheckoutNoServidor({ ...base, motivoId: null, motivo: null });
    expect(sem).toMatchObject({ pode: false, codigo: 'RN-CORE-12', pendencias: ['motivo'] });
    expect(avaliarCheckoutNoServidor({ ...base, motivoId: null, motivo: null, motivoTexto: 'Sem necessidade' }).pode).toBe(true);
  });

  it('RN-CORE-12: etapa obrigatória de outro módulo pendente na verificação do servidor bloqueia', () => {
    const r = avaliarCheckoutNoServidor({ ...base, verificacoes: [pesquisa(false)] });
    expect(r).toMatchObject({ pode: false, codigo: 'RN-CORE-12', pendencias: ['Pesquisa de preço'] });
  });

  it('RN-CORE-12: etapa obrigatória cumprida libera e vira registro concluído', () => {
    const r = avaliarCheckoutNoServidor({ ...base, verificacoes: [pesquisa(true)] });
    expect(r.pode).toBe(true);
    expect(r.etapasRegistro).toEqual([{ modulo: 'pesquisa', etapa: 'pesquisa.preco', situacao: 'concluida' }]);
  });

  it('RN-CORE-14: cliente fechado dispensa a etapa obrigatória e a registra como dispensada', () => {
    const r = avaliarCheckoutNoServidor({ ...base, resultadoInformado: 'cliente_fechado', motivo: fechado, fotoFachada: true, verificacoes: [pesquisa(false)] });
    expect(r).toMatchObject({ pode: true, codigo: null });
    expect(r.etapasRegistro).toEqual([{ modulo: 'pesquisa', etapa: 'pesquisa.preco', situacao: 'dispensada' }]);
  });

  it('RN-CORE-14: cliente fechado sem foto da fachada é recusado com o código da RN-CORE-14', () => {
    const r = avaliarCheckoutNoServidor({ ...base, resultadoInformado: 'cliente_fechado', motivo: fechado });
    expect(r).toMatchObject({ pode: false, codigo: 'RN-CORE-14', pendencias: ['foto_fachada'] });
  });

  it('RN-CORE-14: motivo de cliente fechado com outro resultado informado (aparelho adulterado) é recusado', () => {
    const r = avaliarCheckoutNoServidor({ ...base, motivo: fechado, fotoFachada: true, verificacoes: [pesquisa(false)] });
    expect(r).toMatchObject({ pode: false, codigo: 'RN-CORE-12', pendencias: ['resultado'] });
  });

  it('RN-CORE-12: resultado pedido exige o pedido da visita', () => {
    expect(avaliarCheckoutNoServidor({ ...base, resultadoInformado: 'pedido', motivoId: null, motivo: null })).toMatchObject({ pode: false, pendencias: ['pedido'] });
  });

  it('RN-CORE-12: sem Vendedor efetivo o resultado é atendido; sem_pedido é recusado', () => {
    expect(avaliarCheckoutNoServidor({ ...base, vendedorEfetivo: false, resultadoInformado: 'atendido', motivoId: null, motivo: null }).pode).toBe(true);
    expect(avaliarCheckoutNoServidor({ ...base, vendedorEfetivo: false }).pode).toBe(false);
  });
});
