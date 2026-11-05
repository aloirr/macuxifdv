import { describe, expect, expectTypeOf, it } from 'vitest';
import { conferirEventosPublicados, lerPayloadTolerante } from '@macuxi/platform-sdk';
import manifest from '../manifest';
import * as contracts from './index';
import type { z } from 'zod';
import { type RegistroDe, ENTIDADES, EVENTOS_ATUALIZADO, EVENTOS_ENTIDADE_ATUALIZADO, EVENTO_LOTE_CONCLUIDO, EVENTO_LOTE_RECEBIDO, EVENTO_PEDIDO_RETORNO_ERP, EVENTO_RECONCILIACAO_DIVERGENTE, EVENTO_ERP_CLIENTE_ATUALIZADO } from './index';

const LOTE = '11111111-1111-4111-8111-111111111111';
const AGORA = '2026-11-05T10:00:00Z';

describe('T-0024: definições dos eventos integracao.* no contracts', () => {
  it('RN-INT-09: todo evento publicado no manifest tem definição exportada e nenhuma é de evento alheio', () => {
    expect(conferirEventosPublicados(manifest, contracts)).toEqual([]);
  });

  it('RN-INT-09: há uma definição integracao.<entidade>.atualizado@1 por entidade', () => {
    for (const e of ENTIDADES) expect(EVENTOS_ENTIDADE_ATUALIZADO[e].nome).toBe(`integracao.${e}.atualizado@1`);
  });

  it('RN-INT-09: exemplos válidos dos eventos de lote, retorno e reconciliação', () => {
    expect(EVENTO_LOTE_RECEBIDO.schema.safeParse({ lote_id: LOTE, conector_id: 'c1', entidade: 'cliente', modo: 'delta', recebidas: 3, recebido_em: AGORA }).success).toBe(true);
    expect(EVENTO_LOTE_CONCLUIDO.schema.safeParse({ lote_id: LOTE, entidade: 'cliente', modo: 'delta', status: 'concluido', recebidas: 3, com_erro: 0, concluido_em: AGORA }).success).toBe(true);
    expect(EVENTO_RECONCILIACAO_DIVERGENTE.schema.safeParse({ entidade: 'estoque', data_referencia: '2026-11-04', contagem_erp: 2, contagem_macuxi: 1, soma_erp: null, soma_macuxi: null, motivos: ['contagem'] }).success).toBe(true);
    expect(EVENTO_PEDIDO_RETORNO_ERP.schema.safeParse({ pedido_uuid: LOTE, status: 'integrado', numero_erp: '9', motivo: null, nota: null, ocorrido_em: AGORA }).success).toBe(true);
  });

  it('RN-INT-09: o consumidor lê tolerante (chave desconhecida some) o atualizado@1 com inativação sem registro', () => {
    const p = lerPayloadTolerante(EVENTO_ERP_CLIENTE_ATUALIZADO, { lote_id: LOTE, entidade: 'cliente', external_id: 'C1', acao: 'inativado', hash: 'h', ocorrido_em: AGORA, novo: 1 });
    expect(p).toEqual({ lote_id: LOTE, entidade: 'cliente', external_id: 'C1', acao: 'inativado', hash: 'h', ocorrido_em: AGORA });
  });

  it('RN-INT-09: o registro do evento por entidade tem o tipo da própria entidade (só tipo, continua @1)', () => {
    type Nota = z.infer<(typeof EVENTOS_ATUALIZADO)['nota']>['registro'];
    expectTypeOf<NonNullable<Nota>>().toMatchTypeOf<RegistroDe<'nota'>>();
    expectTypeOf<RegistroDe<'nota'>>().toMatchTypeOf<NonNullable<Nota>>();
    expectTypeOf<'tipo'>().toMatchTypeOf<keyof NonNullable<Nota>>(); // campo só da nota: a união das 12 entidades não o tem em comum
    expect(EVENTOS_ATUALIZADO.nota.shape.registro).toBeDefined();
  });
});
