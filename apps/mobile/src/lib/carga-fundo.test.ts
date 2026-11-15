/**
 * ADR 0054 (solução 5, R-20261115-070200): entrar enquanto o catálogo carrega. Liberação da entrada pelo motor (com fallback
 * para o motor sem `liberado_em`), retomada da carga com o app reaberto e as props do indicador discreto
 * (docs/design/carga-em-segundo-plano.md).
 */
import type { EtapaEntrada, ProgressoEntrada } from '@macuxi/core/contracts';
import { CARGA_VAZIA, type EstadoMotorSync } from '@macuxi/platform-sdk';
import { describe, expect, it } from 'vitest';

import { cargaEmFundo, deveRetomarCarga, entradaLiberadaPeloMotor, indicadorDaCargaFundo } from './carga-fundo';

type Estado = Pick<EstadoMotorSync, 'pendentes' | 'sincronizando' | 'erro' | 'sincronizado_em' | 'progresso' | 'carga' | 'liberado_em'>;
const LIBERADO = '2026-11-15T11:00:00.000Z';
const BASE: Estado = { sincronizando: true, erro: null, sincronizado_em: null, progresso: 0.6, carga: CARGA_VAZIA, liberado_em: LIBERADO, pendentes: ['produto', 'tabela_preco'] };

const CAMPO: EtapaEntrada[] = [
  { id: 'envio', nome: 'Envio do que ficou no aparelho', numero: 1, situacao: 'feita' },
  { id: 'clientes_rota', nome: 'Clientes e rota', numero: 2, situacao: 'feita' },
  { id: 'pedidos_metas', nome: 'Pedidos e metas', numero: 3, situacao: 'feita' },
  { id: 'fotos_materiais', nome: 'Fotos e materiais', numero: 4, situacao: 'feita' },
  { id: 'catalogo_precos', nome: 'Catálogo e preços', numero: 5, situacao: 'atual' },
];
const progresso = (atual: number, etapas: EtapaEntrada[] = CAMPO): Pick<ProgressoEntrada, 'atual' | 'etapas'> => ({ etapas, atual: etapas[atual]! });

describe('entrada liberada pelo motor (ADR 0054)', () => {
  it('carga completa ou essenciais feitos liberam; motor sem `liberado_em` = só a carga completa (como antes)', () => {
    expect(entradaLiberadaPeloMotor({ sincronizado_em: null, liberado_em: null })).toBe(false);
    expect(entradaLiberadaPeloMotor({ sincronizado_em: null })).toBe(false);
    expect(entradaLiberadaPeloMotor({ sincronizado_em: null, liberado_em: LIBERADO })).toBe(true);
    expect(entradaLiberadaPeloMotor({ sincronizado_em: LIBERADO })).toBe(true);
  });

  it('carga em fundo só com `pendentes` não vazio (ausente = motor sem a peça)', () => {
    expect(cargaEmFundo({})).toBe(false);
    expect(cargaEmFundo({ pendentes: [] })).toBe(false);
    expect(cargaEmFundo({ pendentes: ['produto'] })).toBe(true);
  });

  it('retoma a carga com o app reaberto: liberado, sem carga completa e nada rodando', () => {
    expect(deveRetomarCarga({ liberado_em: LIBERADO, sincronizado_em: null, sincronizando: false })).toBe(true);
    expect(deveRetomarCarga({ liberado_em: LIBERADO, sincronizado_em: null, sincronizando: true })).toBe(false);
    expect(deveRetomarCarga({ liberado_em: LIBERADO, sincronizado_em: '2026-11-15T12:00:00.000Z', sincronizando: false })).toBe(false);
    expect(deveRetomarCarga({ sincronizado_em: null, sincronizando: false })).toBe(false);
  });
});

describe('indicador da carga em fundo (docs/design/carga-em-segundo-plano.md)', () => {
  it('sem pendentes não monta', () => {
    expect(indicadorDaCargaFundo({ ...BASE, pendentes: [] }, progresso(4), false)).toBeNull();
    expect(indicadorDaCargaFundo({ ...BASE, pendentes: undefined }, progresso(4), false)).toBeNull();
  });

  it('Campo: "Catálogo" com o percentual da carga (o mesmo da tela de carga)', () => {
    expect(indicadorDaCargaFundo(BASE, progresso(4), false)).toEqual({ etapa: 'Catálogo', percentual: 60, semSinal: false });
  });

  it('etapa em curso depois da liberação aparece pelo nome; a de liberação (ou o envio, parado) dá a última etapa', () => {
    expect(indicadorDaCargaFundo(BASE, progresso(2), false)?.etapa).toBe('Pedidos e metas');
    expect(indicadorDaCargaFundo(BASE, progresso(1), false)?.etapa).toBe('Catálogo');
    expect(indicadorDaCargaFundo({ ...BASE, sincronizando: false }, progresso(0), false)?.etapa).toBe('Catálogo');
  });

  it('Gestão: "Aprovações"', () => {
    const gestao: EtapaEntrada[] = [
      { id: 'envio', nome: 'Envio do que ficou no aparelho', numero: 1, situacao: 'feita' },
      { id: 'equipe', nome: 'Equipe', numero: 2, situacao: 'feita' },
      { id: 'metas', nome: 'Metas', numero: 3, situacao: 'feita' },
      { id: 'alertas', nome: 'Alertas', numero: 4, situacao: 'feita' },
      { id: 'aprovacoes', nome: 'Aprovações', numero: 5, situacao: 'atual' },
    ];
    expect(indicadorDaCargaFundo(BASE, progresso(1, gestao), false)?.etapa).toBe('Aprovações');
    expect(indicadorDaCargaFundo(BASE, progresso(4, gestao), false)?.etapa).toBe('Aprovações');
  });

  it('percentual no máximo 99 enquanto há pendentes', () => {
    expect(indicadorDaCargaFundo({ ...BASE, progresso: 1 }, progresso(4), false)?.percentual).toBe(99);
  });

  it('sem sinal: modo sem sinal ligado ou a passada parou por falta de conexão', () => {
    expect(indicadorDaCargaFundo(BASE, progresso(4), true)?.semSinal).toBe(true);
    expect(indicadorDaCargaFundo({ ...BASE, sincronizando: false, erro: 'Sem conexão com https://api.exemplo.' }, progresso(4), false)?.semSinal).toBe(true);
    expect(indicadorDaCargaFundo({ ...BASE, sincronizando: false, erro: 'HTTP 500' }, progresso(4), false)?.semSinal).toBe(false);
  });
});
