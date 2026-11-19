/**
 * T-0156 × Postgres real (fixture dois-tenants, RLS): BKO do rastreamento — parâmetro (padrão desligado, salvar idempotente e
 * auditado, expediente obrigatório para ligar), termo (cada publicação é uma versão nova, isolado por tenant) e ausências (só do
 * escopo, cancelar). RN-CORE-13, RN-AUD-01, RN-CORE-04. Pula sem Postgres.
 */
import { semBanco } from '@macuxi/db/teste/estado';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PARAMETROS_RASTREAMENTO_PADRAO } from '../contracts';
import { A, AmbienteBanco, B, U } from './apoio-teste-t0170';
import { rotasDeRastreamento } from './rastreamento-bko';

const SEM_EXPEDIENTE = { '0': [], '1': [], '2': [], '3': [], '4': [], '5': [], '6': [] };

describe.skipIf(semBanco())('Core T-0156 × Postgres: BKO do rastreamento', () => {
  const amb = new AmbienteBanco();
  const admin = amb.usuario(U.admin, 'admin');
  const supervisor = amb.usuario(U.supervisor, 'supervisor');
  const adminB = amb.usuario(B.usuarios.admin, 'admin', B.tenantId);
  const chamar = (m: string, c: string, u = admin, extra: { corpo?: unknown; query?: unknown; params?: unknown } = {}) => amb.chamar(rotasDeRastreamento, m, c, u, extra);
  const auditorias = (acao: string) => amb.noTenant(A.tenantId, async (db) => Number((await db.query<{ n: string }>("select count(*)::text as n from plataforma.auditoria where acao = $1 and modulo = 'core'", [acao])).rows[0]!.n));
  const limpar = async () => {
    await amb.limpar("delete from plataforma.parametro where tenant_id = $1 and modulo = 'core' and chave = 'rastreamento'", [A.tenantId]);
    await amb.limpar("delete from core.ausencia_usuario where usuario_id = any($1::uuid[]) and de >= '2027-03-01'", [[U.vendedor1, U.vendedor2]]);
    await amb.limpar("delete from core.termo_rastreamento where tenant_id = $1 and versao > 2", [B.tenantId]);
  };

  beforeAll(async () => {
    await amb.abrir();
    await limpar();
  });
  afterAll(async () => {
    await limpar();
    await amb.fechar();
  });

  it('RN-CORE-13: sem parâmetro gravado o rastreamento está DESLIGADO (padrão de fábrica)', async () => {
    expect(await chamar('GET', 'parametros/rastreamento')).toEqual(PARAMETROS_RASTREAMENTO_PADRAO);
  });

  it('RN-CORE-13/RN-AUD-01: ligar grava e audita; salvar o mesmo valor não audita de novo; sem expediente não liga', async () => {
    const antes = await auditorias('rastreamento.configurar');
    const ligado = { ...PARAMETROS_RASTREAMENTO_PADRAO, ativo: true, frequencia: { distancia_m: 300, intervalo_min: 5, lote_min: 5 } };
    expect(await chamar('PUT', 'parametros/rastreamento', admin, { corpo: ligado })).toEqual(ligado);
    expect(await chamar('GET', 'parametros/rastreamento')).toEqual(ligado);
    expect(await auditorias('rastreamento.configurar')).toBe(antes + 1);
    await chamar('PUT', 'parametros/rastreamento', admin, { corpo: ligado });
    expect(await auditorias('rastreamento.configurar')).toBe(antes + 1);
    await expect(chamar('PUT', 'parametros/rastreamento', admin, { corpo: { ...ligado, expediente: SEM_EXPEDIENTE } })).rejects.toMatchObject({ codigo: 'RN-CORE-13' });
    expect((await chamar('GET', 'parametros/rastreamento')).ativo).toBe(true);
    // outro tenant não enxerga o parâmetro do A (RLS): segue desligado
    expect((await chamar('GET', 'parametros/rastreamento', adminB)).ativo).toBe(false);
  });

  it('RN-CORE-13: cada publicação do termo é uma versão nova (a maior é a vigente) e o outro tenant não vê o texto', async () => {
    const antes = await chamar('GET', 'rastreamento/termos', adminB);
    const base = antes.vigente as number;
    const v1 = await chamar('POST', 'rastreamento/termos', adminB, { corpo: { texto: 'Primeira redação do termo.' } });
    const v2 = await chamar('POST', 'rastreamento/termos', adminB, { corpo: { texto: 'Segunda redação do termo.' } });
    expect([v1.versao, v2.versao]).toEqual([base + 1, base + 2]);
    const lista = await chamar('GET', 'rastreamento/termos', adminB);
    expect(lista.vigente).toBe(base + 2);
    expect(lista.termos[0]).toMatchObject({ versao: base + 2, texto: 'Segunda redação do termo.' });
    expect((await chamar('GET', 'rastreamento/termos', admin)).termos.every((t: { texto: string }) => !t.texto.includes('redação do termo'))).toBe(true);
    await expect(chamar('POST', 'rastreamento/termos', adminB, { corpo: { texto: '   ' } })).rejects.toBeDefined();
  });

  it('RN-CORE-13/04: o supervisor cadastra ausência só de quem está na equipe dele; o admin, de qualquer um; cancelar tira da lista', async () => {
    const a = await chamar('POST', 'ausencias', supervisor, { corpo: { usuario_id: U.vendedor1, de: '2027-03-01', ate: '2027-03-10' } });
    expect(a).toMatchObject({ usuario_id: U.vendedor1, de: '2027-03-01', ate: '2027-03-10', deleted_at: null });
    await expect(chamar('POST', 'ausencias', supervisor, { corpo: { usuario_id: U.vendedor2, de: '2027-03-01', ate: '2027-03-10' } })).rejects.toMatchObject({ status: 404 });
    const b = await chamar('POST', 'ausencias', admin, { corpo: { usuario_id: U.vendedor2, de: '2027-03-05', ate: '2027-03-06' } });
    const doSup = (await chamar('GET', 'ausencias', supervisor)).ausencias.map((x: { id: string }) => x.id);
    expect(doSup).toContain(a.id);
    expect(doSup).not.toContain(b.id);
    const doAdmin = (await chamar('GET', 'ausencias', admin, { query: { usuario_id: U.vendedor2 } })).ausencias.map((x: { id: string }) => x.id);
    expect(doAdmin).toContain(b.id);
    expect(doAdmin).not.toContain(a.id);
    await expect(chamar('DELETE', 'ausencias/:id', supervisor, { params: { id: b.id } })).rejects.toMatchObject({ status: 404 });
    await chamar('DELETE', 'ausencias/:id', supervisor, { params: { id: a.id } });
    expect((await chamar('GET', 'ausencias', supervisor)).ausencias.map((x: { id: string }) => x.id)).not.toContain(a.id);
    // de depois de ate é recusado pelo contrato
    await expect(chamar('POST', 'ausencias', admin, { corpo: { usuario_id: U.vendedor1, de: '2027-03-10', ate: '2027-03-01' } })).rejects.toBeDefined();
  });
});
