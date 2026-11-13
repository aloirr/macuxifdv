import { tolerante } from '@macuxi/platform-sdk';
import { describe, expect, it } from 'vitest';
import { NotificacaoSyncSchema, TIPOS_NOTIFICACAO } from '../../contracts/sync';
import { SUBTIPO_NOTIFICACAO_TAREFA, TIPO_NOTIFICACAO_TAREFA } from '../../contracts/tarefa';
import { avisoDaTarefa } from './aviso';

const id = (n: number) => `0a100000-0000-4000-8000-${String(n).padStart(12, '0')}`;
/** Vocabulário de `tipo` da notificação que o APK v1.0.5 conhece (congelado aqui de propósito; ele mostra `sistema` como "Aviso do sistema"). */
const TIPOS_NOTIFICACAO_V105 = ['recado', 'sistema', 'pedido', 'treinamento', 'trade'];

describe('RN-CORE-TAR-07 (teste de contrato): o aviso da tarefa não muda o tipo da notificação (APK antigo)', () => {
  const aviso = avisoDaTarefa({ id: id(1), titulo: 'Fotografar a gôndola de bebidas', prazo: '2026-11-14' });
  const linha = {
    id: id(2),
    updated_at: '2026-11-13T12:00:00.000000Z',
    deleted_at: null,
    external_id: null,
    usuario_id: id(3),
    origem_modulo: 'core',
    autor_id: id(4),
    lida_em: null,
    expira_em: null,
    ...aviso,
  };

  it('RN-CORE-TAR-07: tipo = "sistema" e subtipo = "tarefa", com o id da tarefa', () => {
    expect(aviso).toMatchObject({ tipo: 'sistema', subtipo: 'tarefa', tarefa_id: id(1) });
    expect(TIPO_NOTIFICACAO_TAREFA).toBe('sistema');
    expect(SUBTIPO_NOTIFICACAO_TAREFA).toBe('tarefa');
  });
  it('RN-CORE-TAR-07: o tipo está no vocabulário da v1.0.5 e o enum de hoje não ganhou "tarefa"', () => {
    expect(TIPOS_NOTIFICACAO_V105).toContain(aviso.tipo);
    expect([...TIPOS_NOTIFICACAO]).toEqual(TIPOS_NOTIFICACAO_V105);
  });
  it('RN-CORE-TAR-07: a linha do aviso passa no contrato de hoje lido de forma tolerante (o `tarefa_id` novo é ignorado)', () => {
    const r = tolerante(NotificacaoSyncSchema).safeParse(linha);
    expect(r.success).toBe(true);
    expect(r.success && r.data.tipo).toBe('sistema');
    expect(r.success && r.data.subtipo).toBe('tarefa');
  });
  it('RN-CORE-TAR-07: o APK antigo mostra "Aviso do sistema · Nova tarefa: …", com o prazo no corpo', () => {
    expect(aviso.titulo).toBe('Nova tarefa: Fotografar a gôndola de bebidas');
    expect(aviso.corpo).toBe('Prazo: 14/11/2026');
  });
  it('RN-CORE-TAR-07: com tipo "tarefa", a mesma linha seria recusada pelo contrato de hoje', () => {
    expect(tolerante(NotificacaoSyncSchema).safeParse({ ...linha, tipo: 'tarefa' }).success).toBe(false);
  });
  it('RN-CORE-TAR-07: título longo é cortado no limite de 120 da notificação', () => {
    const longo = avisoDaTarefa({ id: id(1), titulo: 'x'.repeat(120), prazo: '2026-11-14' });
    expect(longo.titulo).toHaveLength(120);
    expect(longo.titulo.endsWith('…')).toBe(true);
    expect(tolerante(NotificacaoSyncSchema).safeParse({ ...linha, ...longo }).success).toBe(true);
  });
});
