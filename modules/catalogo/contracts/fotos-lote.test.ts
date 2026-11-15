import { conferirEventosPublicados } from '@macuxi/platform-sdk';
import { describe, expect, it } from 'vitest';
import { manifest } from '../manifest';
import * as contracts from './index';
import {
  EVENTO_FOTO_DEFINIDA,
  EVENTO_FOTO_LOTE_CONCLUIDO,
  EVENTO_FOTO_LOTE_ENFILEIRADO,
  EVENTO_FOTO_REMOVIDA,
  FotoDefinidaSchema,
  FotoLoteConcluidoSchema,
  FotoLoteEnfileiradoSchema,
  FotoLoteItemSchema,
  FotoLoteSchema,
  FotoRemovidaSchema,
  MotivoItem,
  MotivoLote,
  ROTULO_MOTIVO_ITEM,
  ROTULO_MOTIVO_LOTE,
  ROTULO_SITUACAO_ITEM,
  SituacaoItem,
} from './fotos-lote';

const U = (n: number) => `0ca00000-0000-4000-8000-00000000000${n}`;
const AGORA = '2026-11-15T12:00:00.000Z';

describe('RN-CAT-14: estados do lote e do item', () => {
  it('RN-CAT-14: todo estado e motivo tem rótulo em português', () => {
    for (const s of SituacaoItem.options) expect(ROTULO_SITUACAO_ITEM[s], s).toBeTruthy();
    for (const m of MotivoItem.options) expect(ROTULO_MOTIVO_ITEM[m], m).toBeTruthy();
    for (const m of MotivoLote.options) expect(ROTULO_MOTIVO_LOTE[m], m).toBeTruthy();
  });
  it('RN-CAT-14: o item aceita os estados ligado, sem produto, ambíguo, recusado com motivo e repetido', () => {
    const base = { indice: 0, arquivo: 'A1.jpg', tipo_detectado: null, codigo: 'A1', ordem: 1, produto_id: U(1), produto_codigo: 'A1', codigos_candidatos: null };
    for (const [situacao, motivo] of [['ligado', null], ['sem_produto', null], ['ambiguo', null], ['recusado', 'tipo_nao_aceito'], ['repetido', null]] as const) {
      expect(FotoLoteItemSchema.safeParse({ ...base, situacao, motivo }).success, situacao).toBe(true);
    }
    expect(FotoLoteItemSchema.safeParse({ ...base, situacao: 'ligado', motivo: 'outro' }).success).toBe(false);
    expect(FotoLoteItemSchema.safeParse({ ...base, situacao: 'ambiguo', motivo: null, codigos_candidatos: ['1', '2', '3', '4', '5', '6'] }).success).toBe(false);
  });
  it('RN-CAT-14: o lote é saída estrita (campo a mais é recusado)', () => {
    const lote = { id: U(1), situacao: 'concluido', motivo: null, nome_arquivo: 'a.zip', tamanho_bytes: 1, total: 2, totais: { pendente: 0, ligado: 1, sem_produto: 0, ambiguo: 0, recusado: 1, repetido: 0 }, duplicado_de: null, criado_em: AGORA, concluido_em: AGORA };
    expect(FotoLoteSchema.safeParse(lote).success).toBe(true);
    expect(FotoLoteSchema.safeParse({ ...lote, enviado_por: U(2) }).success).toBe(false);
  });
});

describe('RN-CAT-14: eventos do lote de fotos @1', () => {
  it('RN-CAT-14: os 4 eventos estão em publica e têm definição exportada; o enfileirado também é consumido', () => {
    expect(conferirEventosPublicados(manifest, contracts)).toEqual([]);
    for (const e of [EVENTO_FOTO_LOTE_ENFILEIRADO, EVENTO_FOTO_LOTE_CONCLUIDO, EVENTO_FOTO_DEFINIDA, EVENTO_FOTO_REMOVIDA]) expect(manifest.publica, e.nome).toContain(e.nome);
    expect(manifest.consome).toContain('catalogo.foto_lote.enfileirado@1');
    expect(EVENTO_FOTO_DEFINIDA.nome).toBe('catalogo.foto.definida@1');
    expect(EVENTO_FOTO_REMOVIDA.nome).toBe('catalogo.foto.removida@1');
  });
  it('RN-CAT-14: catalogo.foto_lote.enfileirado@1 e concluido@1 validam o payload e recusam chave a mais', () => {
    const enf = { lote_id: U(1), arquivo_id: U(2), enviado_por: U(3), ocorrido_em: AGORA };
    expect(FotoLoteEnfileiradoSchema.safeParse(enf).success).toBe(true);
    expect(FotoLoteEnfileiradoSchema.safeParse({ ...enf, nome_arquivo: 'x.zip' }).success).toBe(false);
    const fim = { lote_id: U(1), enviado_por: U(3), situacao: 'concluido', motivo: null, duplicado_de: null, totais: { ligado: 1, sem_produto: 0, ambiguo: 0, recusado: 0, repetido: 0 }, ocorrido_em: AGORA };
    expect(FotoLoteConcluidoSchema.safeParse(fim).success).toBe(true);
    expect(FotoLoteConcluidoSchema.safeParse({ ...fim, situacao: 'processando' }).success).toBe(false);
    expect(FotoLoteConcluidoSchema.safeParse({ ...fim, situacao: 'recusado', motivo: 'zip_grande' }).success).toBe(true);
  });
  it('RN-CAT-14: catalogo.foto.definida@1 e removida@1 validam a ordem, a origem e o motivo', () => {
    const def = { midia_id: U(1), produto_id: U(2), arquivo_id: U(3), ordem: 1, principal: true, origem: 'lote', lote_id: U(4), substituiu_midia_id: null, ocorrido_em: AGORA };
    expect(FotoDefinidaSchema.safeParse(def).success).toBe(true);
    expect(FotoDefinidaSchema.safeParse({ ...def, origem: 'ficha', lote_id: null, arquivo_id: null }).success).toBe(true);
    expect(FotoDefinidaSchema.safeParse({ ...def, ordem: 0 }).success).toBe(false);
    expect(FotoDefinidaSchema.safeParse({ ...def, origem: 'app' }).success).toBe(false);
    const rem = { midia_id: U(1), produto_id: U(2), ordem: 2, motivo: 'substituida', ocorrido_em: AGORA };
    expect(FotoRemovidaSchema.safeParse(rem).success).toBe(true);
    expect(FotoRemovidaSchema.safeParse({ ...rem, motivo: 'apagada' }).success).toBe(false);
  });
});

describe('RN-CAT-14: filtro de itens por uma ou mais situações', () => {
  it('RN-CAT-14: situacao aceita lista separada por vírgula e recusa valor desconhecido', async () => {
    const { FotoLoteItensQuery } = await import('./fotos-lote');
    expect(FotoLoteItensQuery.parse({}).situacao).toBeUndefined();
    expect(FotoLoteItensQuery.parse({ situacao: 'ligado' }).situacao).toEqual(['ligado']);
    expect(FotoLoteItensQuery.parse({ situacao: 'sem_produto,ambiguo' }).situacao).toEqual(['sem_produto', 'ambiguo']);
    expect(FotoLoteItensQuery.safeParse({ situacao: 'sem_produto,xpto' }).success).toBe(false);
    expect(FotoLoteItensQuery.safeParse({ situacao: '' }).success).toBe(false);
  });
});
