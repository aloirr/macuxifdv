/**
 * 0104/0105 × SDK (ADR 0073 §2.3 e §5; plano §7.2). O que o BANCO garante:
 * - plataforma.modelo_permissao versão 1 = os modelos do SDK (`modelosDePerfil` + `linhasDosModelos` da E1; antes dela,
 *   `matrizDeFabrica` com os 8 manifestos), linha a linha, com o cargo de cada modelo (CARGO_DA_BASE);
 * - a gêmea SQL plataforma.permissoes_legado_do_perfil = `resolverPerfil` do SDK (motor de hoje) em perfis com sobreposições
 *   sorteadas (semente fixa), em todas as bases;
 * - plataforma.perfil_compat = `perfilDeCompatibilidade` e plataforma.trava_da_chave_do_cargo = `travaDaChavePeloCargo` (E1),
 *   quando o SDK já as exporta.
 * Mudou o catálogo do SDK sem migração nova = este teste cai (a 0104 é cópia congelada; a versão seguinte entra por migração).
 */
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CARGOS, PERFIS, catalogoDePermissoes } from '@macuxi/platform-sdk';
import { DOIS_TENANTS } from '../seeds/fixtures/dois-tenants';
import { banco, semBanco } from './estado';
import { compatNoSdk, legadoDoPerfil, linhasDoSdk, MANIFESTOS, normalizar, resolverLegadoNoSdk, travaNoSdk, VERSAO_DO_SDK, type Sobreposicao } from './perfis-sem-base-apoio';
import { emTransacao } from './util';

const A = DOIS_TENANTS.A;

/** Gerador determinístico (mulberry32): a mesma sequência em toda rodada. */
function sorteio(semente: number): () => number {
  let s = semente >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe.skipIf(semBanco())('0104/0105 × SDK (fixture dois-tenants, ROLLBACK)', () => {
  let admin: pg.Client;
  beforeAll(async () => {
    admin = new pg.Client({ connectionString: banco().urlAdmin });
    await admin.connect();
  });
  afterAll(async () => {
    await admin?.end();
  });

  it('modelo_permissao v1 = os modelos do SDK (406 linhas, mesma ordem, cargo, nível e alvos)', async () => {
    expect(VERSAO_DO_SDK).toBe(1);
    const r = await admin.query('select versao, modelo, cargo, chave, nivel, alvos from plataforma.modelo_permissao where deleted_at is null');
    const ordem = (x: { modelo: string; chave: string }) => `${PERFIS.indexOf(x.modelo as (typeof PERFIS)[number])}`.padStart(2, '0') + x.chave;
    const doBanco = [...r.rows].sort((x, y) => (ordem(x) < ordem(y) ? -1 : 1));
    expect(doBanco).toEqual(linhasDoSdk());
    expect(doBanco).toHaveLength(406);
  });

  it('gêmea SQL = resolverPerfil do SDK com sobreposições sorteadas (7 bases × 12 perfis, semente fixa)', async () => {
    const catalogo = catalogoDePermissoes(MANIFESTOS).map((d) => d.chave);
    const niveisEscopo = ['proprio', 'carteira', 'equipe', 'equipes_abaixo', 'tenant', null];
    const rnd = sorteio(73);
    await emTransacao(admin, null, async () => {
      let n = 0;
      for (const base of PERFIS) {
        for (let i = 0; i < 12; i++) {
          const id = `cccccccc-0104-4000-8000-${String(++n).padStart(12, '0')}`;
          await admin.query(
            "insert into plataforma.perfil (id, tenant_id, codigo, nome, base, cargo) values ($1, $2, $3, 'Sorteado', $4, plataforma.cargo_da_base($4))",
            [id, A.tenantId, `sorteado_${n}`, base],
          );
          const sob: Sobreposicao[] = [];
          for (const chave of catalogo) {
            if (rnd() > 0.12) continue;
            const concedida = rnd() < 0.5;
            const s: Sobreposicao = { chave, concedida };
            if (concedida && chave === 'dados.escopo') s.nivel = niveisEscopo[Math.floor(rnd() * niveisEscopo.length)] ?? null;
            if (concedida && chave === 'senha.redefinir' && rnd() < 0.7) s.alvos = rnd() < 0.5 ? ['*'] : ['vendedor', 'promotor'];
            // a trava da base (0041) recusa a gravação do que ela corta: o sorteio só grava o que a 0041 aceita
            await admin.query('savepoint s');
            try {
              await admin.query('insert into plataforma.perfil_permissao (tenant_id, perfil_id, chave, concedida, nivel, alvos) values ($1, $2, $3, $4, $5, $6)', [
                A.tenantId, id, chave, concedida, s.nivel ?? null, s.alvos ?? null,
              ]);
              await admin.query('release savepoint s');
              sob.push(s);
            } catch {
              await admin.query('rollback to savepoint s');
            }
          }
          const sdk = resolverLegadoNoSdk(base, sob);
          if (sdk) expect(await legadoDoPerfil(admin, id), `${base} #${i}`).toEqual(sdk);
          // o espelho (0106) mantém as concessões = acesso de hoje cortado pelo cargo (aqui o cargo é o da base: nada a cortar)
          const conc = await admin.query<{ p: Record<string, { nivel?: string; alvos?: string[] }> }>('select plataforma.concessoes_do_perfil($1) as p', [id]);
          const derivada = await admin.query<{ p: Record<string, { nivel?: string; alvos?: string[] }> }>(
            'select plataforma.concessoes_derivadas($1, plataforma.cargo_da_base($2)) as p', [id, base],
          );
          expect(normalizar(conc.rows[0]!.p)).toEqual(normalizar(derivada.rows[0]!.p));
        }
      }
    });
  });

  it('perfil_compat = perfilDeCompatibilidade e trava_da_chave_do_cargo = travaDaChavePeloCargo (quando o SDK da E1 já as tem)', async () => {
    const catalogo = catalogoDePermissoes(MANIFESTOS).map((d) => d.chave);
    const r = await admin.query<{ modelo: string; cargo: string; p: Record<string, { nivel?: string; alvos?: string[] }> }>(
      `select modelo, min(cargo) as cargo, jsonb_object_agg(chave, jsonb_strip_nulls(jsonb_build_object('nivel', nivel, 'alvos', to_jsonb(alvos)))) as p
         from plataforma.modelo_permissao where versao = 1 and deleted_at is null group by modelo`,
    );
    for (const m of r.rows) {
      const sql = (await admin.query<{ c: string }>('select plataforma.perfil_compat($1, $2) as c', [m.cargo, m.p])).rows[0]!.c;
      expect(sql, m.modelo).toBe(m.modelo);
      const sdk = compatNoSdk(m.cargo, m.p);
      if (sdk !== null) expect(sdk, m.modelo).toBe(sql);
    }
    const linhas = (await admin.query<{ cargo: string; chave: string; regra: string | null }>(
      'select c.cargo, k.chave, plataforma.trava_da_chave_do_cargo(c.cargo, k.chave, null) as regra from unnest($1::text[]) as c (cargo) cross join unnest($2::text[]) as k (chave)',
      [[...CARGOS], catalogo],
    )).rows;
    for (const l of linhas) {
      // o portal com a gestão completa: a trava que sobra é a do cargo (o SQL confere a gestão no conjunto, em aplicar_travas_do_cargo)
      const sdk = travaNoSdk(l.cargo, l.chave, true);
      if (sdk !== undefined) expect(l.regra, `${l.cargo} ${l.chave}`).toBe(sdk);
    }
  });
});
