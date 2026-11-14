/**
 * T-0170 × Postgres real (fixture dois-tenants, RLS): frase do dia do Início (RN-CORE-41; desenho `inicio-frase-avatar-pedidos.md` §2.1).
 * BKO cria, edita, desativa, reordena e remove; o pull leva as removidas; texto repetido, vazio e longo são 422 com o código da
 * regra; nenhum dado cruza o tenant (RN-CORE-05). Não conta linhas absolutas (a fixture e as 30 padrão já ocupam a tabela). Pula sem Postgres.
 */
import { semBanco } from '@macuxi/db/teste/estado';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FraseDiaSyncSchema } from '../contracts/frases';
import { fraseDoDia } from '../domain/frase-avatar/frase-do-dia';
import { A, AmbienteBanco, B, U } from './apoio-teste-t0170';
import { rotasDeFrases } from './frases';
import { provedoresSyncT0170 } from './sync-t0170';

const PREFIXO = 'Teste T0170:';

describe.skipIf(semBanco())('Core T-0170 × Postgres: frase do dia', () => {
  const amb = new AmbienteBanco();
  const analista = amb.usuario(U.analista, 'analista');
  const adminB = amb.usuario(B.usuarios.admin, 'admin', B.tenantId);
  const vendedor1 = amb.usuario(U.vendedor1, 'vendedor');
  const chamar = (metodo: string, caminho: string, u = analista, extra = {}) => amb.chamar(rotasDeFrases, metodo, caminho, u, extra);
  const lista = async (u = analista) => (await chamar('GET', 'frases', u)).itens as Array<{ id: string; texto: string; ativa: boolean; ordem: number; padrao_codigo: string | null }>;
  const limpar = () => amb.limpar(`delete from core.frase_dia where texto like '${PREFIXO}%'`);

  beforeAll(async () => {
    await amb.abrir();
    await limpar();
  });
  afterAll(async () => {
    await limpar();
    await amb.fechar();
  });

  it('RN-CORE-31: o tenant nasce com as 30 frases padrão (P01 a P30) e o BKO as lista na ordem do rodízio', async () => {
    const l = await lista();
    for (const f of l) FraseDiaSyncSchema.parse({ ...f, updated_at: new Date().toISOString(), deleted_at: null, external_id: null });
    const padrao = l.filter((f) => f.padrao_codigo !== null).map((f) => f.padrao_codigo);
    expect(padrao).toEqual(expect.arrayContaining(['P01', 'P15', 'P30']));
    expect(l.map((f) => f.ordem)).toEqual([...l.map((f) => f.ordem)].sort((a, b) => a - b));
  });

  it('RN-CORE-41: a frase nova entra no fim da lista, ativa, sem os espaços das pontas; o rodízio do domain a enxerga', async () => {
    const antes = await lista();
    const nova = await chamar('POST', 'frases', analista, { corpo: { texto: `  ${PREFIXO} venda com calma.  ` } });
    expect(nova).toMatchObject({ texto: `${PREFIXO} venda com calma.`, ativa: true, padrao_codigo: null });
    expect(nova.ordem).toBeGreaterThan(Math.max(...antes.map((f) => f.ordem)));
    const depois = await lista();
    expect(depois).toHaveLength(antes.length + 1);
    expect(depois[depois.length - 1]!.id).toBe(nova.id);
    expect(fraseDoDia(depois, '2026-11-13')).not.toBeNull();
  });

  it('RN-CORE-41: texto vazio, acima de 120 caracteres ou repetido (sem diferenciar maiúsculas) é 422 com o motivo', async () => {
    await expect(chamar('POST', 'frases', analista, { corpo: { texto: '   ' } })).rejects.toMatchObject({ status: 422, codigo: 'RN-CORE-41', detalhes: { motivo: 'vazia' } });
    await expect(chamar('POST', 'frases', analista, { corpo: { texto: 'x'.repeat(121) } })).rejects.toMatchObject({ status: 422, codigo: 'RN-CORE-41', detalhes: { motivo: 'longa' } });
    await expect(chamar('POST', 'frases', analista, { corpo: { texto: `${PREFIXO.toUpperCase()} VENDA COM CALMA.` } })).rejects.toMatchObject({ status: 422, codigo: 'RN-CORE-41', detalhes: { motivo: 'repetida' } });
  });

  it('edita o texto e desativa; a frase inativa sai do rodízio e o texto repetido de outra frase é recusado', async () => {
    const a = (await lista()).find((f) => f.texto.startsWith(PREFIXO))!;
    const b = await chamar('POST', 'frases', analista, { corpo: { texto: `${PREFIXO} segunda frase` } });
    const editada = await chamar('PUT', 'frases/:id', analista, { params: { id: a.id }, corpo: { texto: `${PREFIXO} venda com calma, sempre.`, ativa: false } });
    expect(editada).toMatchObject({ texto: `${PREFIXO} venda com calma, sempre.`, ativa: false });
    expect(fraseDoDia([{ ...editada, deleted_at: null }], '2026-11-13')).toBeNull();
    await expect(chamar('PUT', 'frases/:id', analista, { params: { id: b.id }, corpo: { texto: `${PREFIXO} venda com calma, sempre.` } })).rejects.toMatchObject({ status: 422, detalhes: { motivo: 'repetida' } });
    await expect(chamar('PUT', 'frases/:id', analista, { params: { id: '0e600000-0000-4000-8000-000000000999' }, corpo: { ativa: true } })).rejects.toMatchObject({ status: 404, codigo: 'FRASE_NAO_ENCONTRADA' });
    expect(await chamar('PUT', 'frases/:id', analista, { params: { id: b.id }, corpo: {} })).toMatchObject({ texto: `${PREFIXO} segunda frase` }); // corpo vazio não muda nada
  });

  it('reordena a lista inteira de ids vivos; lista incompleta ou repetida é 422 e nada muda', async () => {
    const l = await lista();
    const ids = l.map((f) => f.id);
    const trocada = [...ids.slice(0, -2), ids[ids.length - 1]!, ids[ids.length - 2]!];
    const r = await chamar('PUT', 'frases/ordem', analista, { corpo: { ids: trocada } });
    expect(r).toMatchObject({ alteradas: 2 });
    expect((await lista()).map((f) => f.id)).toEqual(trocada);
    await expect(chamar('PUT', 'frases/ordem', analista, { corpo: { ids: trocada.slice(1) } })).rejects.toMatchObject({ status: 422, codigo: 'RN-CORE-41', detalhes: { motivo: 'ordem_incompleta' } });
    await expect(chamar('PUT', 'frases/ordem', analista, { corpo: { ids: [...trocada.slice(1), trocada[1]!] } })).rejects.toMatchObject({ status: 422 });
    expect((await lista()).map((f) => f.id)).toEqual(trocada);
    expect(await chamar('PUT', 'frases/ordem', analista, { corpo: { ids: trocada } })).toMatchObject({ alteradas: 0 });
  });

  it('remove com deleted_at (repetir responde igual); o pull leva a removida e o BKO deixa de listá-la; a padrão removida não volta', async () => {
    const alvo = (await lista()).find((f) => f.texto.startsWith(PREFIXO))!;
    expect(await chamar('DELETE', 'frases/:id', analista, { params: { id: alvo.id } })).toEqual({ id: alvo.id, removida: true });
    expect(await chamar('DELETE', 'frases/:id', analista, { params: { id: alvo.id } })).toEqual({ id: alvo.id, removida: true });
    expect((await lista()).some((f) => f.id === alvo.id)).toBe(false);
    const pull = await amb.puxar(provedoresSyncT0170, 'frase_dia', vendedor1);
    for (const l of pull) FraseDiaSyncSchema.parse(l);
    expect(pull.find((l) => l.id === alvo.id)).toMatchObject({ deleted_at: expect.any(String) });
    await expect(chamar('DELETE', 'frases/:id', analista, { params: { id: '0e600000-0000-4000-8000-000000000998' } })).rejects.toMatchObject({ status: 404 });
    // padrão removida: a linha fica (o único de padrao_codigo não filtra deleted_at) e o código não pode ser reaproveitado
    const p01 = (await lista()).find((f) => f.padrao_codigo === 'P01')!;
    await chamar('DELETE', 'frases/:id', analista, { params: { id: p01.id } });
    try {
      await expect(amb.admin.query("insert into core.frase_dia (tenant_id, texto, ordem, padrao_codigo) values ($1, 'Teste T0170: P01 de novo', 999, 'P01')", [A.tenantId])).rejects.toThrow();
    } finally {
      await amb.limpar('update core.frase_dia set deleted_at = null where id = $1', [p01.id]);
    }
  });

  it('auditoria: cada mudança grava plataforma.auditoria sem o texto da frase; o pull é igual para todos os usuários do tenant e o tenant B não vê nada daqui', async () => {
    const aud = await amb.noTenant(A.tenantId, async (db) => (await db.query<{ acao: string; antes: unknown; depois: unknown }>("select acao, antes, depois from plataforma.auditoria where acao like 'frase_dia.%' order by created_at desc limit 20")).rows);
    expect(aud.map((x) => x.acao)).toEqual(expect.arrayContaining(['frase_dia.criar', 'frase_dia.editar', 'frase_dia.ordenar', 'frase_dia.remover']));
    expect(JSON.stringify(aud)).not.toContain(PREFIXO);
    const promotor = amb.usuario(U.promotor, 'promotor');
    expect((await amb.puxar(provedoresSyncT0170, 'frase_dia', promotor)).map((l) => l.id)).toEqual((await amb.puxar(provedoresSyncT0170, 'frase_dia', vendedor1)).map((l) => l.id));
    const doB = await lista(adminB);
    expect(doB.some((f) => f.texto.startsWith(PREFIXO) || f.texto.includes('Alfa'))).toBe(false);
    expect(amb.linhasDeLog.join('')).not.toContain(PREFIXO);
  });
});
