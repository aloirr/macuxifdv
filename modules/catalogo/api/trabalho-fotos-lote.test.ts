/* eslint-disable @typescript-eslint/no-explicit-any -- banco falso por padrão de SQL: os valores dos parâmetros são de formato livre */
/**
 * RN-CAT-14: o trabalho `processar_foto_lote` (conferência, itens em fatias com checkpoint, fim) contra um banco falso em memória
 * (SQL reconhecido por trecho). O ponta a ponta com Postgres, RLS e o worker é do CI (`*.db.test.ts`).
 */
import type { ContextoTrabalho, EntradaZip, ZipAberto } from '@macuxi/platform-sdk';
import { describe, expect, it, vi } from 'vitest';
import { trabalhoProcessarFotoLote, itensDaConferencia, nomeBaseDoCaminho } from './trabalho-fotos-lote';
import { LIMITES_ZIP_TETO } from '@macuxi/platform-sdk';

const TENANT = '0ca00000-0000-4000-8000-0000000000a1';
const LOTE = '0ca00000-0000-4000-8000-0000000000d1';
const ZIP_ARQ = '0ca00000-0000-4000-8000-0000000000e1';
const USUARIO = '0ca00000-0000-4000-8000-0000000000f1';
const OUTRO_LOTE = '0ca00000-0000-4000-8000-0000000000d2';
const hexa = (c: string) => c.repeat(64);

interface Produto { id: string; sku: string; ean: string | null; ativo: boolean }
const prod = (n: number, sku: string, ean: string | null = null, ativo = true): Produto => ({ id: `0ca00000-0000-4000-8000-00000000010${n}`, sku, ean, ativo });

interface Item { indice: number; caminho: string; situacao: string; motivo: string | null; tipo_detectado: string | null; codigo: string | null; ordem: number | null; produto_id: string | null; produto_codigo: string | null; codigos_candidatos: string[] | null; arquivo_id: string; midia_id: string; sha256: string | null }
interface Midia { id: string; produto_id: string; ordem: number; principal: boolean; hash: string | null; arquivo_id: string | null; vivo: boolean }

function entrada(indice: number, caminho: string, o: Partial<EntradaZip> = {}): EntradaZip {
  return { indice, caminho, pasta: false, metodo: 8, criptografada: false, compactado: 1000, descompactado: 2000, crc32: 1, ...o };
}

interface Cenario {
  produtos?: Produto[];
  entradas: EntradaZip[];
  /** indice → resultado de `zip.ler` (padrão: JPEG com SHA derivado do índice). */
  leituras?: Record<number, { ok: false; motivo: string; tipo_detectado: string | null } | { ok: true; sha: string; tipo?: string }>;
  hashVivos?: { produtoId: string; hash: string }[];
  shaDoZip?: string;
  lotesComMesmoSha?: string[];
  abrir?: { ok: false; motivo: string };
  ilegiveis?: number[];
  falhaNaFoto?: number;
}

function montar(c: Cenario) {
  const lote = { id: LOTE, enviado_por: USUARIO, arquivo_id: ZIP_ARQ, nome_arquivo: 'fotos.zip', tamanho_bytes: 1000, sha256: null as string | null, situacao: 'enfileirado', motivo: null as string | null, duplicado_de: null as string | null, total: null as number | null, concluido_em: null as string | null, created_at: '2026-11-15T12:00:00.000Z' };
  const itens: Item[] = [];
  let midias: Midia[] = [];
  const eventos: { nome: string; payload: Record<string, any> }[] = [];
  const arquivosRegistrados: { id: string; tipo?: string; enviado_por: string }[] = [];
  let snapshot: { midias: Midia[]; eventos: number; arq: number } | null = null;
  const hashVivos = [...(c.hashVivos ?? [])];
  const guardadas: string[] = [];
  let chamadasGuardar = 0;

  const db = {
    query: vi.fn(async (sql: string, v: any[] = []) => {
      const s = sql.replace(/\s+/g, ' ').trim();
      if (s === 'savepoint item_foto' || s === 'savepoint foto_produto') { snapshot = { midias: midias.map((m) => ({ ...m })), eventos: eventos.length, arq: arquivosRegistrados.length }; return { rows: [], rowCount: 0 }; }
      if (s === 'release savepoint item_foto' || s === 'release savepoint foto_produto') return { rows: [], rowCount: 0 };
      if (s === 'rollback to savepoint item_foto' || s === 'rollback to savepoint foto_produto') { midias = snapshot!.midias; eventos.length = snapshot!.eventos; arquivosRegistrados.length = snapshot!.arq; return { rows: [], rowCount: 0 }; }
      if (s.startsWith('select id, enviado_por, arquivo_id')) return { rows: [lote], rowCount: 1 };
      if (s.includes("set situacao = 'conferindo'")) { if (lote.situacao === 'enfileirado') lote.situacao = 'conferindo'; return { rows: [], rowCount: 1 }; }
      if (s.startsWith('select id from catalogo.foto_lote where sha256')) return { rows: (c.lotesComMesmoSha ?? []).map((id) => ({ id })), rowCount: 0 };
      if (s.startsWith('update catalogo.foto_lote set sha256')) { lote.sha256 = v[1]; lote.total = v[2]; return { rows: [], rowCount: 1 }; }
      if (s.startsWith('insert into catalogo.foto_lote_item')) {
        const [, idx, cam, sit, mot, cod, arq, mid] = v as [string, number[], string[], string[], (string | null)[], (string | null)[], string[], string[]];
        idx.forEach((indice, i) => { if (!itens.some((x) => x.indice === indice)) itens.push({ indice, caminho: cam[i]!, situacao: sit[i]!, motivo: mot[i] ?? null, tipo_detectado: null, codigo: cod[i] ?? null, ordem: null, produto_id: null, produto_codigo: null, codigos_candidatos: null, arquivo_id: arq[i]!, midia_id: mid[i]!, sha256: null }); });
        return { rows: [], rowCount: idx.length };
      }
      if (s.includes("set situacao = 'processando'")) { if (lote.situacao === 'conferindo') lote.situacao = 'processando'; return { rows: [], rowCount: 1 }; }
      if (s.startsWith('select id, indice, caminho, arquivo_id, midia_id')) {
        const r = itens.filter((i) => i.situacao === 'pendente').sort((a, b) => a.indice - b.indice).slice(0, v[1]).map((i) => ({ id: String(i.indice), ...i }));
        return { rows: r, rowCount: r.length };
      }
      if (s.startsWith('select 1 from catalogo.produto_midia')) {
        const achou = hashVivos.some((h) => h.produtoId === v[0] && h.hash === v[1]) || midias.some((m) => m.vivo && m.produto_id === v[0] && m.hash === v[1]);
        return { rows: achou ? [{}] : [], rowCount: achou ? 1 : 0 };
      }
      if (s.startsWith('update catalogo.foto_lote_item')) {
        const it = itens.find((i) => String(i.indice) === v[0]);
        if (!it || it.situacao !== 'pendente') return { rows: [], rowCount: 0 };
        if (v[1] === 'ligado' && itens.some((o) => o !== it && o.situacao === 'ligado' && o.produto_id === v[6] && o.ordem === v[5])) throw Object.assign(new Error('dup'), { code: '23505', constraint: 'foto_lote_item_ordem_uk' });
        Object.assign(it, { situacao: v[1], motivo: v[2], tipo_detectado: v[3], codigo: v[4], ordem: v[5], produto_id: v[6], produto_codigo: v[7], codigos_candidatos: v[8], sha256: v[9] });
        return { rows: [], rowCount: 1 };
      }
      if (s.startsWith('update catalogo.produto_midia set deleted_at') && s.includes('ordem = $3::int and')) {
        const ant = midias.filter((m) => m.vivo && m.produto_id === v[1] && m.ordem === v[2]);
        ant.forEach((m) => (m.vivo = false));
        return { rows: ant.map((m) => ({ id: m.id })), rowCount: ant.length };
      }
      if (s.startsWith('select id from catalogo.produto_midia')) {
        const m = midias.find((x) => x.vivo && x.produto_id === v[1] && x.hash === v[2]);
        return { rows: m ? [{ id: m.id }] : [], rowCount: m ? 1 : 0 };
      }
      if (s.startsWith('insert into catalogo.produto_midia')) { midias.push({ id: v[0], produto_id: v[2], arquivo_id: v[3], ordem: v[6], principal: v[7], hash: v[8], vivo: true }); return { rows: [], rowCount: 1 }; }
      if (s.startsWith('insert into catalogo.produto_conteudo')) return { rows: [], rowCount: 1 };
      if (s.startsWith('select lote_id, situacao, count(*)')) {
        const por = new Map<string, number>();
        for (const i of itens) por.set(i.situacao, (por.get(i.situacao) ?? 0) + 1);
        return { rows: [...por].map(([situacao, n]) => ({ lote_id: LOTE, situacao, n })), rowCount: por.size };
      }
      if (s.startsWith('update catalogo.foto_lote set situacao = $2, motivo')) {
        if (['concluido', 'recusado', 'falhou', 'duplicado'].includes(lote.situacao)) return { rows: [], rowCount: 0 };
        Object.assign(lote, { situacao: v[1], motivo: v[2], duplicado_de: v[3], concluido_em: '2026-11-15T12:05:00.000Z' });
        return { rows: [], rowCount: 1 };
      }
      throw new Error(`SQL não previsto no teste: ${s.slice(0, 80)}`);
    }),
  };

  const produtos = c.produtos ?? [];
  const zip: ZipAberto = {
    sha256: c.shaDoZip ?? hexa('b'),
    tamanho_bytes: 1000,
    entradas: c.entradas,
    ler: vi.fn(async (indice: number) => {
      const l = c.leituras?.[indice];
      if (l && !l.ok) return { ok: false as const, motivo: l.motivo, tipo_detectado: l.tipo_detectado } as never;
      const sha = l && l.ok ? l.sha : hexa(String((indice % 9) + 1));
      return { ok: true as const, bytes: new Uint8Array([1, 2, 3]), sha256: sha, tipo: (l && l.ok && l.tipo) || 'image/jpeg', largura: 10, altura: 10 } as never;
    }),
    fechar: vi.fn(async () => undefined),
  };
  const descartar = vi.fn(async () => undefined);
  let parar = (): boolean => false;
  const logs: unknown[] = [];

  const tx = () => ({
    db,
    publicar: vi.fn(async (def: { nome: string }, payload: Record<string, any>) => { eventos.push({ nome: def.nome, payload }); return {}; }),
    consultar: vi.fn(async (_def: unknown, e: { codigos: string[] }) => ({
      produtos: produtos.filter((p) => e.codigos.some((k) => k === p.sku || k.toLowerCase() === p.sku.toLowerCase() || k === p.ean)),
    })),
    registrarArquivo: vi.fn(async (a: { id: string; tipo?: string; enviado_por: string }) => { arquivosRegistrados.push(a); return { criado: true }; }),
    infoArquivo: vi.fn(async () => null),
  });

  const ctx = {
    tenantId: TENANT,
    alvoId: LOTE,
    fatia: 0,
    tentativa: 0,
    emTransacao: async (fn: (t: unknown) => Promise<unknown>) => fn(tx()),
    arquivos: {
      abrirZip: vi.fn(async () => (c.abrir ? c.abrir : { ok: true as const, zip })),
      guardarImagem: vi.fn(async (e: { id: string; tipo: string }) => {
        chamadasGuardar++;
        if (c.falhaNaFoto === chamadasGuardar) throw new Error('disco cheio');
        const indice = itens.findIndex((i) => i.arquivo_id === e.id);
        if (c.ilegiveis?.includes(itens[indice]!.indice)) return { ok: false as const, motivo: 'foto_ilegivel' as const };
        guardadas.push(e.id);
        return { ok: true as const, recebido: { sha256: hexa('c'), tamanho_bytes: 3, largura_px: 10, altura_px: 10, tipo: e.tipo, chave: `k/${e.id}.jpg` } };
      }),
      descartar,
    },
    deveParar: () => parar(),
    parametros: () => ({}),
    fuso: () => 'America/Manaus',
    agora: () => new Date('2026-11-15T16:00:00.000Z'),
    log: { info: (o: unknown) => logs.push(o), warn: () => undefined, error: (o: unknown) => logs.push(o) },
  } as unknown as ContextoTrabalho;

  return { lote, itens, ctx, eventos, descartar, zip, guardadas, arquivosRegistrados, midias: () => midias, pararDepois: (n: number) => { let k = 0; parar = () => k++ >= n; }, naoParar: () => { parar = () => false; } };
}

async function rodarTudo(m: ReturnType<typeof montar>): Promise<number> {
  let fatias = 0;
  for (;;) {
    fatias++;
    if ((await trabalhoProcessarFotoLote.executarFatia(LOTE, m.ctx)) === 'concluido' || fatias > 20) return fatias;
  }
}

describe('RN-CAT-14: conferência do ZIP', () => {
  it('RN-CAT-14: ignorados ficam fora; recusados nascem recusados com o motivo; o resto vira pendente com o código lido do nome', () => {
    const itens = itensDaConferencia(
      [entrada(0, 'A1.jpg'), entrada(1, '__MACOSX/._A1.jpg'), entrada(2, 'fotos/', { pasta: true }), entrada(3, '../x.jpg'), entrada(4, 'Thumbs.db'), entrada(5, 'grande.jpg', { descompactado: 9 * 1024 * 1024 }), entrada(6, '.jpg'), entrada(7, 'sub\\B2_2.png')],
      LIMITES_ZIP_TETO,
    );
    expect(itens.map((i) => [i.indice, i.situacao, i.motivo, i.codigo])).toEqual([
      [0, 'pendente', null, 'A1'],
      [3, 'recusado', 'caminho_invalido', null],
      [5, 'recusado', 'foto_grande', null],
      [7, 'pendente', null, 'B2_2'],
    ]);
  });
  it('RN-CAT-14: nome-base do caminho aceita as duas barras', () => {
    expect(nomeBaseDoCaminho('a/b\\c.jpg')).toBe('c.jpg');
  });
  it('RN-CAT-14: ZIP recusado pela plataforma (muitos arquivos) encerra o lote como recusado, sem itens, publica o fato e descarta as partes', async () => {
    const m = montar({ entradas: [], abrir: { ok: false, motivo: 'muitos_arquivos' } });
    expect(await trabalhoProcessarFotoLote.executarFatia(LOTE, m.ctx)).toBe('concluido');
    expect(m.lote).toMatchObject({ situacao: 'recusado', motivo: 'muitos_arquivos' });
    expect(m.itens).toEqual([]);
    expect(m.eventos.map((e) => [e.nome, e.payload.situacao, e.payload.motivo])).toEqual([['catalogo.foto_lote.concluido@1', 'recusado', 'muitos_arquivos']]);
    expect(m.descartar).toHaveBeenCalledWith(ZIP_ARQ);
  });
  it('RN-CAT-14: o mesmo ZIP já enviado vira duplicado do lote existente, sem itens nem mídia', async () => {
    const m = montar({ entradas: [entrada(0, 'A1.jpg')], lotesComMesmoSha: [OUTRO_LOTE], produtos: [prod(1, 'A1')] });
    expect(await trabalhoProcessarFotoLote.executarFatia(LOTE, m.ctx)).toBe('concluido');
    expect(m.lote).toMatchObject({ situacao: 'duplicado', duplicado_de: OUTRO_LOTE });
    expect(m.itens).toEqual([]);
    expect(m.midias()).toEqual([]);
    expect(m.eventos[0]!.payload).toMatchObject({ situacao: 'duplicado', duplicado_de: OUTRO_LOTE });
    expect(m.zip.fechar).toHaveBeenCalled();
  });
  it('RN-CAT-14: a conferência guarda SHA e total, cria os itens e passa o lote a processando', async () => {
    const m = montar({ entradas: [entrada(0, 'A1.jpg'), entrada(1, '../x.jpg')] });
    expect(await trabalhoProcessarFotoLote.executarFatia(LOTE, m.ctx)).toBe('continua');
    expect(m.lote).toMatchObject({ situacao: 'processando', sha256: hexa('b'), total: 2 });
    expect(m.itens.map((i) => i.situacao)).toEqual(['pendente', 'recusado']);
  });
});

describe('RN-CAT-14: itens do lote', () => {
  it('RN-CAT-14: A1.jpg, A1_2.jpg e a1_3.jpg com só A1 ligam 3 fotos na ordem 1, 2, 3; só a 1 é principal; o lote conclui com os totais', async () => {
    const A1 = prod(1, 'A1');
    const m = montar({ produtos: [A1], entradas: [entrada(0, 'A1.jpg'), entrada(1, 'A1_2.jpg'), entrada(2, 'a1_3.jpg')] });
    await rodarTudo(m);
    expect(m.itens.map((i) => [i.situacao, i.ordem, i.produto_id, i.produto_codigo])).toEqual([['ligado', 1, A1.id, 'A1'], ['ligado', 2, A1.id, 'A1'], ['ligado', 3, A1.id, 'A1']]);
    expect(m.midias().map((x) => [x.ordem, x.principal, x.vivo])).toEqual([[1, true, true], [2, false, true], [3, false, true]]);
    expect(m.midias().map((x) => x.id)).toEqual(m.itens.map((i) => i.midia_id));
    expect(m.eventos.filter((e) => e.nome === 'catalogo.foto.definida@1')).toHaveLength(3);
    const fim = m.eventos.at(-1)!;
    expect(fim.nome).toBe('catalogo.foto_lote.concluido@1');
    expect(fim.payload).toMatchObject({ situacao: 'concluido', totais: { ligado: 3, sem_produto: 0, ambiguo: 0, recusado: 0, repetido: 0 } });
    expect(m.lote).toMatchObject({ situacao: 'concluido' });
    expect(m.descartar).toHaveBeenCalledWith(ZIP_ARQ);
    // cada foto vira arquivo do produto, de quem enviou o lote
    expect(m.arquivosRegistrados.map((a) => a.enviado_por)).toEqual([USUARIO, USUARIO, USUARIO]);
  });
  it('RN-CAT-14: Ab.jpg com ab e AB existindo é ambíguo, com os dois códigos, e nada é ligado', async () => {
    const m = montar({ produtos: [prod(1, 'ab'), prod(2, 'AB')], entradas: [entrada(0, 'Ab.jpg')] });
    await rodarTudo(m);
    expect(m.itens[0]).toMatchObject({ situacao: 'ambiguo', codigos_candidatos: ['ab', 'AB'], produto_id: null });
    expect(m.midias()).toEqual([]);
    expect(m.guardadas).toEqual([]);
  });
  it('RN-CAT-14: nome com o EAN liga ao produto; arquivo sem produto fica sem produto', async () => {
    const A2 = prod(2, 'A2', '7891234567895');
    const m = montar({ produtos: [A2], entradas: [entrada(0, '7891234567895.png'), entrada(1, 'ZZZ.jpg')], leituras: { 0: { ok: true, sha: hexa('d'), tipo: 'image/png' } } });
    await rodarTudo(m);
    expect(m.itens.map((i) => [i.situacao, i.produto_codigo, i.tipo_detectado])).toEqual([['ligado', 'A2', 'image/png'], ['sem_produto', null, null]]);
  });
  it('RN-CAT-14: formato que não é foto (GIF renomeado) é recusado com o tipo detectado e nada é gravado', async () => {
    const m = montar({ produtos: [prod(1, 'A1')], entradas: [entrada(0, 'A1.jpg')], leituras: { 0: { ok: false, motivo: 'tipo_nao_aceito', tipo_detectado: null } } });
    await rodarTudo(m);
    expect(m.itens[0]).toMatchObject({ situacao: 'recusado', motivo: 'tipo_nao_aceito' });
    expect(m.midias()).toEqual([]);
    expect(m.guardadas).toEqual([]);
    expect(m.arquivosRegistrados).toEqual([]);
  });
  it('RN-CAT-14: foto que não decodifica é recusada como ilegível e nenhuma mídia nasce', async () => {
    const m = montar({ produtos: [prod(1, 'A1')], entradas: [entrada(0, 'A1.jpg')], ilegiveis: [0] });
    await rodarTudo(m);
    expect(m.itens[0]).toMatchObject({ situacao: 'recusado', motivo: 'foto_ilegivel' });
    expect(m.midias()).toEqual([]);
  });
  it('RN-CAT-14: a mesma foto já viva no produto é repetida: sem bytes gravados e sem mídia nova', async () => {
    const A1 = prod(1, 'A1');
    const m = montar({ produtos: [A1], entradas: [entrada(0, 'A1.jpg')], leituras: { 0: { ok: true, sha: hexa('e') } }, hashVivos: [{ produtoId: A1.id, hash: hexa('e') }] });
    await rodarTudo(m);
    expect(m.itens[0]).toMatchObject({ situacao: 'repetido', ordem: 1, produto_id: A1.id });
    expect(m.guardadas).toEqual([]);
    expect(m.midias()).toEqual([]);
    expect(m.eventos.at(-1)!.payload.totais.repetido).toBe(1);
  });
  it('RN-CAT-14: SKU.jpg e SKU_1.jpg no mesmo ZIP disputam a ordem 1: o segundo é recusado e a primeira foto continua viva', async () => {
    const A1 = prod(1, 'A1');
    const m = montar({ produtos: [A1], entradas: [entrada(0, 'A1.jpg'), entrada(1, 'A1_1.jpg')], leituras: { 0: { ok: true, sha: hexa('1') }, 1: { ok: true, sha: hexa('2') } } });
    await rodarTudo(m);
    expect(m.itens.map((i) => [i.situacao, i.motivo])).toEqual([['ligado', null], ['recusado', 'ordem_repetida_no_lote']]);
    expect(m.midias().filter((x) => x.vivo).map((x) => x.id)).toEqual([m.itens[0]!.midia_id]);
    expect(m.arquivosRegistrados).toHaveLength(1);
  });
  it('RN-CAT-14: foto nova na mesma ordem substitui a anterior (foto.removida substituida antes de foto.definida)', async () => {
    const A1 = prod(1, 'A1');
    const m = montar({ produtos: [A1], entradas: [entrada(0, 'A1.jpg')] });
    // foto antiga viva na ordem 1 (da ficha)
    await m.ctx.emTransacao((t) => t.db.query('insert into catalogo.produto_midia', ['antiga', 'tenant', A1.id, null, null, null, 1, true, null]));
    await rodarTudo(m);
    expect(m.midias().map((x) => [x.id === 'antiga', x.vivo])).toEqual([[true, false], [false, true]]);
    expect(m.eventos.filter((e) => e.nome.startsWith('catalogo.foto.')).map((e) => e.nome)).toEqual(['catalogo.foto.removida@1', 'catalogo.foto.definida@1']);
  });
});

describe('RN-CAT-14: retomada e falha (critério 7)', () => {
  it('RN-CAT-14: fatia interrompida no meio retoma do checkpoint: mesmas chaves, nenhuma mídia duplicada', async () => {
    const A1 = prod(1, 'A1');
    const m = montar({ produtos: [A1], entradas: [entrada(0, 'A1.jpg'), entrada(1, 'A1_2.jpg'), entrada(2, 'A1_3.jpg')], falhaNaFoto: 2 });
    expect(await trabalhoProcessarFotoLote.executarFatia(LOTE, m.ctx)).toBe('continua'); // conferência
    const chaves = m.itens.map((i) => [i.arquivo_id, i.midia_id]);
    await expect(trabalhoProcessarFotoLote.executarFatia(LOTE, m.ctx)).rejects.toThrow('disco cheio');
    expect(m.itens.map((i) => i.situacao)).toEqual(['ligado', 'pendente', 'pendente']);
    await rodarTudo(m);
    expect(m.itens.map((i) => i.situacao)).toEqual(['ligado', 'ligado', 'ligado']);
    expect(m.itens.map((i) => [i.arquivo_id, i.midia_id])).toEqual(chaves);
    expect(m.midias()).toHaveLength(3);
    expect(new Set(m.midias().map((x) => x.id)).size).toBe(3);
  });
  it('RN-CAT-14: com o prazo da fatia vencido ela termina o item atual e devolve continua; a seguinte segue dali', async () => {
    const A1 = prod(1, 'A1');
    const m = montar({ produtos: [A1], entradas: [entrada(0, 'A1.jpg'), entrada(1, 'A1_2.jpg'), entrada(2, 'A1_3.jpg')] });
    await trabalhoProcessarFotoLote.executarFatia(LOTE, m.ctx);
    m.pararDepois(1);
    expect(await trabalhoProcessarFotoLote.executarFatia(LOTE, m.ctx)).toBe('continua');
    expect(m.itens.map((i) => i.situacao)).toEqual(['ligado', 'pendente', 'pendente']);
    m.naoParar();
    await rodarTudo(m);
    expect(m.itens.every((i) => i.situacao === 'ligado')).toBe(true);
  });
  it('RN-CAT-14: lote já terminado não faz nada (alvo repetido pelo worker)', async () => {
    const m = montar({ entradas: [] });
    m.lote.situacao = 'concluido';
    expect(await trabalhoProcessarFotoLote.executarFatia(LOTE, m.ctx)).toBe('concluido');
    expect(m.zip.fechar).not.toHaveBeenCalled();
    expect(m.eventos).toEqual([]);
  });
  it('RN-CAT-14: esgotadas as tentativas o lote vira falhou, publica o fato e descarta o ZIP (só o código no log)', async () => {
    const m = montar({ entradas: [entrada(0, 'A1.jpg')] });
    m.lote.situacao = 'processando';
    await trabalhoProcessarFotoLote.aoFalhar(LOTE, m.ctx, { codigo: 'ERRO_X' });
    expect(m.lote.situacao).toBe('falhou');
    expect(m.eventos[0]!.payload).toMatchObject({ situacao: 'falhou', motivo: null });
    expect(m.descartar).toHaveBeenCalledWith(ZIP_ARQ);
  });
  it('RN-CAT-14: o trabalho é disparado por catalogo.foto_lote.enfileirado@1 e o alvo é o lote', () => {
    expect(trabalhoProcessarFotoLote.nome).toBe('processar_foto_lote');
    expect(trabalhoProcessarFotoLote.disparadoPor.nome).toBe('catalogo.foto_lote.enfileirado@1');
    expect(trabalhoProcessarFotoLote.alvo({ lote_id: LOTE, arquivo_id: ZIP_ARQ, enviado_por: USUARIO, ocorrido_em: '2026-11-15T12:00:00.000Z' })).toBe(LOTE);
  });
});
