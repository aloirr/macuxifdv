/**
 * T-0059 (R-20261102-090919 item 1): sair do app no meio da carga e voltar CONTINUA de onde parou. A interrupção é simulada
 * pelo transporte lançando um erro na N-ésima chamada (o processo "morre"); a volta é um motor NOVO sobre o MESMO
 * armazenamento (o estado em memória se perde, só o gravado fica), como o Android faz ao encerrar o app em segundo plano.
 * Roda nos 3 armazenamentos (chave→JSON, linhas, SQLite real).
 */
import { z } from 'zod';
import { describe, expect, it } from 'vitest';
import { defineModule } from './manifesto';
import { criarMotorSync, VALIDADE_RETOMADA_MS, type ArmazenamentoSync, type EtapaSync, type TransporteSync } from './motor-sync';
import { FABRICAS_ARMAZENAMENTO } from './motor-sync.fabricas';
import { codificarCursor, criarRegistroSync, decodificarCursor, definirEntidadeSync, type LinhaSync, type PaginaSync } from './sync';

const manifestos = [
  defineModule({ id: 'core', versao: '1.0.0', perfis: ['vendedor'], sync: ['cliente', 'produto'] }),
  defineModule({ id: 'vendedor', versao: '1.0.0', depende: ['core'], perfis: ['vendedor'], sync: ['cliente_condicao'] }),
];

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const BASE = Date.parse('2026-11-02T12:00:00Z'); // hora-fixa-ok: relógio injetado do motor, nunca comparado ao relógio real
const POR_PAGINA = 2;

interface Fonte {
  linhas: LinhaSync[];
  /** `versao_escopo` das páginas (escopo carteira); ausente = escopo tenant. */
  versao?: string;
}

/**
 * Servidor de pull em memória com o cursor real `(updated_at, id)`: páginas de 2 linhas na ordem do cursor. Registra cada
 * chamada com `de` = posição da 1ª linha devolvida (0 = do início), para o teste ver de onde cada página partiu.
 */
function servidor(fontes: Record<string, Fonte>) {
  const chamadas: { entidade: string; de: number }[] = [];
  let falharNa: number | null = null;
  const ordem = (a: LinhaSync, b: LinhaSync) => a.updated_at.localeCompare(b.updated_at) || a.id.localeCompare(b.id);
  const transporte: TransporteSync = {
    async push() {
      return [];
    },
    async pull(entidade: string, cursor: string | null): Promise<PaginaSync<LinhaSync>> {
      const f = fontes[entidade] ?? { linhas: [] };
      const todas = [...f.linhas].sort(ordem);
      const c = decodificarCursor(cursor);
      const de = c === null ? 0 : todas.filter((l) => ordem(l, { ...l, updated_at: c.updated_at, id: c.id }) <= 0).length;
      chamadas.push({ entidade, de });
      if (falharNa !== null && chamadas.length === falharNa) throw new Error('processo encerrado (simulado)');
      const itens = todas.slice(de, de + POR_PAGINA);
      const fim = de + POR_PAGINA >= todas.length;
      const ultimo = itens[itens.length - 1];
      return {
        itens,
        proximo_cursor: fim || !ultimo ? null : codificarCursor(ultimo),
        ...(f.versao ? { versao_escopo: f.versao } : {}),
      };
    },
  };
  return {
    transporte,
    chamadas,
    /** A chamada número `n` (1 = a primeira, contando as já feitas) lança: o app "morre" ali. */
    interromperNaChamada(n: number | null) {
      falharNa = n;
    },
  };
}

const linhas = (prefixo: number, n: number, campos: (i: number) => Record<string, unknown>): LinhaSync[] =>
  Array.from({ length: n }, (_, i) => ({
    id: uuid(prefixo + i),
    updated_at: new Date(BASE + i * 1000).toISOString(),
    deleted_at: null,
    external_id: null,
    ...campos(i),
  }));

function registro() {
  const r = criarRegistroSync(manifestos);
  r.registrar(definirEntidadeSync({ nome: 'cliente', modulo: 'core', direcao: 'pull', conflito: 'servidor_vence', schema: z.object({ nome: z.string() }) }));
  r.registrar(definirEntidadeSync({ nome: 'produto', modulo: 'core', direcao: 'pull', conflito: 'servidor_vence', schema: z.object({ sku: z.string() }) }));
  r.registrar(
    definirEntidadeSync({ nome: 'cliente_condicao', modulo: 'vendedor', direcao: 'pull', conflito: 'servidor_vence', schema: z.object({ cliente_id: z.string() }) }),
  );
  return r;
}

describe.each(FABRICAS_ARMAZENAMENTO)('T-0059: carga retoma de onde parou [%s]', (_nome, fabrica) => {
  let relogio = BASE;
  async function abrirApp(armazenamento: ArmazenamentoSync, transporte: TransporteSync, etapas: EtapaSync[] = []) {
    const motor = criarMotorSync({ registro: registro(), armazenamento, transporte, agora: () => new Date(relogio), etapas });
    await motor.carregar();
    if (motor.estado().modulosAtivos.length === 0) await motor.aplicarModulosAtivos(['core', 'vendedor']);
    return motor;
  }

  function cenario() {
    relogio = BASE;
    const fontes: Record<string, Fonte> = {
      cliente: { linhas: linhas(100, 5, (i) => ({ nome: `Cliente ${i}` })), versao: 'v1' },
      produto: { linhas: linhas(200, 3, (i) => ({ sku: `SKU-${i}` })) },
      cliente_condicao: { linhas: linhas(300, 6, (i) => ({ cliente_id: uuid(100 + (i % 5)) })), versao: 'c1' },
    };
    return { fontes, srv: servidor(fontes), armazenamento: fabrica() };
  }

  // ordem das entidades no motor: cliente (3 páginas: chamadas 1-3), cliente_condicao (3: 4-6), produto (2: 7-8)
  it('interrompida no meio de uma entidade com versão de escopo (carga inicial): continua da página seguinte, sem baixar de novo', async () => {
    const { srv, armazenamento } = cenario();
    srv.interromperNaChamada(5); // 2ª página de cliente_condicao
    const m1 = await abrirApp(armazenamento, srv.transporte);
    expect(await m1.sincronizar()).toBe(false);
    expect(srv.chamadas.at(-1)).toEqual({ entidade: 'cliente_condicao', de: 2 });
    expect((await m1.linhas('cliente_condicao')).length).toBe(2); // a 1ª página ficou gravada

    // o Android encerra o processo; o usuário volta: motor novo, mesmo armazenamento
    srv.interromperNaChamada(null);
    const antes = srv.chamadas.length;
    const m2 = await abrirApp(armazenamento, srv.transporte);
    const estados: number[] = [];
    m2.assinar((e) => estados.push(e.progresso));
    expect(await m2.sincronizar()).toBe(true);
    // cliente já estava concluído: não é pedido de novo; cliente_condicao continua da página gravada (de 2)
    expect(srv.chamadas.slice(antes)).toEqual([
      { entidade: 'cliente_condicao', de: 2 },
      { entidade: 'cliente_condicao', de: 4 },
      { entidade: 'produto', de: 0 },
      { entidade: 'produto', de: 2 },
    ]);
    expect((await m2.linhas('cliente_condicao')).length).toBe(6);
    expect((await m2.linhas('cliente')).length).toBe(5);
    expect(m2.estado().carga).toMatchObject({ retomada: true, concluidas: 4, total: 4 });
    // o progresso mostrado parte do ponto salvo (1 entidade de 4 passos), nunca do zero
    expect(estados[0]).toBeCloseTo(1 / 4);
    expect(Math.min(...estados)).toBeGreaterThanOrEqual(1 / 4);
    expect(m2.estado().sincronizado_em).not.toBeNull();
    expect(await armazenamento.ler('sync:carga')).toBeNull();
    expect(await armazenamento.ler('sync:ressinc:cliente_condicao')).toBeNull();
  });

  it('interrompida no meio da ENTIDADE (página) sem versão de escopo: retoma do cursor gravado', async () => {
    const { srv, armazenamento } = cenario();
    srv.interromperNaChamada(8); // 2ª página de produto (de 2)
    const m1 = await abrirApp(armazenamento, srv.transporte);
    expect(await m1.sincronizar()).toBe(false);
    expect(srv.chamadas.at(-1)).toEqual({ entidade: 'produto', de: 2 });

    srv.interromperNaChamada(null);
    const antes = srv.chamadas.length;
    const m2 = await abrirApp(armazenamento, srv.transporte);
    expect(await m2.sincronizar()).toBe(true);
    expect(srv.chamadas.slice(antes)).toEqual([{ entidade: 'produto', de: 2 }]);
    expect((await m2.linhas('produto')).map((l) => (l as unknown as { sku: string }).sku).sort()).toEqual(['SKU-0', 'SKU-1', 'SKU-2']);
  });

  it('interrompida entre entidades: a seguinte começa do início e as concluídas não repetem', async () => {
    const { srv, armazenamento } = cenario();
    srv.interromperNaChamada(4); // 1ª página de cliente_condicao: cliente (3 páginas) já concluído
    const m1 = await abrirApp(armazenamento, srv.transporte);
    expect(await m1.sincronizar()).toBe(false);
    srv.interromperNaChamada(null);
    const antes = srv.chamadas.length;
    const m2 = await abrirApp(armazenamento, srv.transporte);
    expect(await m2.sincronizar()).toBe(true);
    expect(srv.chamadas.slice(antes).map((c) => c.entidade)).toEqual(['cliente_condicao', 'cliente_condicao', 'cliente_condicao', 'produto', 'produto']);
    expect(srv.chamadas.slice(antes)[0]).toEqual({ entidade: 'cliente_condicao', de: 0 });
  });

  it('depois da carga inicial, uma sincronização interrompida não pula entidades na próxima (cada uma continua do cursor)', async () => {
    const { fontes, srv, armazenamento } = cenario();
    const m0 = await abrirApp(armazenamento, srv.transporte);
    expect(await m0.sincronizar()).toBe(true);
    const novo = { ...linhas(210, 1, () => ({ sku: 'SKU-NOVO' }))[0]!, updated_at: new Date(BASE + 60_000).toISOString() };
    fontes.produto = { linhas: [...fontes.produto!.linhas, novo] };
    const antes = srv.chamadas.length;
    srv.interromperNaChamada(antes + 3); // cliente e cliente_condicao (delta) ok; produto cai
    expect(await m0.sincronizar()).toBe(false);
    srv.interromperNaChamada(null);
    const meio = srv.chamadas.length;
    const m1 = await abrirApp(armazenamento, srv.transporte);
    expect(await m1.sincronizar()).toBe(true);
    expect(srv.chamadas.slice(meio).map((c) => c.entidade)).toEqual(['cliente', 'cliente_condicao', 'produto']);
    expect(m1.estado().carga.retomada).toBe(false);
    expect((await m1.linhas('produto')).length).toBe(4);
  });

  it('ressincronização por mudança de carteira interrompida: retoma e no fim ainda apaga o que saiu do escopo', async () => {
    const { fontes, srv, armazenamento } = cenario();
    const m0 = await abrirApp(armazenamento, srv.transporte);
    expect(await m0.sincronizar()).toBe(true);
    expect((await m0.linhas('cliente')).length).toBe(5);

    // a carteira mudou: sai o cliente 100, entram 105 e 106 (versão nova) — 6 linhas, 3 páginas
    fontes.cliente = { linhas: [...linhas(101, 4, (i) => ({ nome: `Cliente ${i + 1}` })), ...linhas(105, 2, (i) => ({ nome: `Novo ${i}` }))], versao: 'v2' };
    relogio = BASE + 60_000;
    const antes = srv.chamadas.length;
    srv.interromperNaChamada(antes + 3); // cliente: do cursor final (vazio, versão nova) → recomeça do 0 → morre na página de 2
    const m1 = await abrirApp(armazenamento, srv.transporte);
    expect(await m1.sincronizar()).toBe(false);
    expect(srv.chamadas.at(-1)).toEqual({ entidade: 'cliente', de: 2 });

    srv.interromperNaChamada(null);
    const meio = srv.chamadas.length;
    const m2 = await abrirApp(armazenamento, srv.transporte);
    expect(await m2.sincronizar()).toBe(true);
    // continua da página de 2 (não volta ao início) e a primeira página da versão v2 não é pedida de novo
    expect(srv.chamadas.slice(meio).filter((c) => c.entidade === 'cliente')).toEqual([
      { entidade: 'cliente', de: 2 },
      { entidade: 'cliente', de: 4 },
    ]);
    const ids = (await m2.linhas('cliente')).map((l) => l.id).sort();
    expect(ids).toEqual([101, 102, 103, 104, 105, 106].map(uuid)); // o 100 saiu do escopo e foi apagado
  });

  it('passada interrompida há mais de VALIDADE_RETOMADA_MS não pula entidades (cada uma segue do seu cursor)', async () => {
    const { srv, armazenamento } = cenario();
    srv.interromperNaChamada(4); // cliente concluído; cai na 1ª página de cliente_condicao
    const m1 = await abrirApp(armazenamento, srv.transporte);
    expect(await m1.sincronizar()).toBe(false);
    srv.interromperNaChamada(null);
    relogio = BASE + VALIDADE_RETOMADA_MS + 1;
    const antes = srv.chamadas.length;
    const m2 = await abrirApp(armazenamento, srv.transporte);
    expect(await m2.sincronizar()).toBe(true);
    // cliente é conferido de novo (delta do cursor final: 1 chamada, depois das 5 linhas), sem baixar tudo outra vez
    expect(srv.chamadas.slice(antes).filter((c) => c.entidade === 'cliente')).toEqual([{ entidade: 'cliente', de: 5 }]);
    expect(m2.estado().carga.retomada).toBe(false);
  });

  it('etapa extra concluída não roda de novo na retomada; a passada completa limpa o registro', async () => {
    const { srv, armazenamento } = cenario();
    let execucoes = 0;
    let falhar = true;
    const etapas: EtapaSync[] = [
      { id: 'carga-a', rotulo: 'Etapa A', modulo: 'core', executar: async () => void execucoes++ },
      {
        id: 'carga-b',
        rotulo: 'Etapa B',
        modulo: 'vendedor',
        executar: async () => {
          if (falhar) throw new Error('processo encerrado (simulado)');
        },
      },
    ];
    const m1 = await abrirApp(armazenamento, srv.transporte, etapas);
    expect(await m1.sincronizar()).toBe(false);
    expect(execucoes).toBe(1);
    falhar = false;
    const m2 = await abrirApp(armazenamento, srv.transporte, etapas);
    const antes = srv.chamadas.length;
    expect(await m2.sincronizar()).toBe(true);
    expect(execucoes).toBe(1); // a etapa A já tinha terminado
    expect(srv.chamadas.length).toBe(antes); // nenhuma entidade puxada de novo
    // a próxima sincronização é uma passada normal (delta de todas, etapas de novo)
    expect(await m2.sincronizar()).toBe(true);
    expect(execucoes).toBe(2);
    expect(m2.estado().carga).toMatchObject({ retomada: false, concluidas: 6, total: 6 });
  });

  it('a tela recebe o módulo da entidade e as páginas gravadas (sem depender do nome técnico)', async () => {
    const { srv, armazenamento } = cenario();
    const m = await abrirApp(armazenamento, srv.transporte);
    const vistos: { entidade: string | null; modulo: string | null; paginas: number }[] = [];
    m.assinar((e) => vistos.push({ entidade: e.carga.entidade, modulo: e.carga.modulo, paginas: e.carga.paginas }));
    expect(await m.sincronizar()).toBe(true);
    expect(vistos).toContainEqual({ entidade: 'cliente_condicao', modulo: 'vendedor', paginas: 3 });
    expect(vistos).toContainEqual({ entidade: 'cliente', modulo: 'core', paginas: 3 });
  });
});
