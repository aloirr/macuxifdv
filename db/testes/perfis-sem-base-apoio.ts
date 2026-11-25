/**
 * Apoio dos testes das migrações 0103 a 0105 (perfis sem perfil base, ADR 0073; plano docs/banco/plano-migracao-perfis-sem-base.md).
 * Fonte do SDK: `modelosDePerfil` e `linhasDosModelos` (E1, perfis-por-cargo.ts) quando já exportados; antes disso, o
 * `matrizDeFabrica` de hoje (a 0103 congelou a versão 1 a partir dele). O motor antigo (`resolverPerfil` + `matrizDeFabrica`) é a
 * referência da gêmea SQL `plataforma.permissoes_legado_do_perfil` enquanto existir no SDK.
 */
import * as sdk from '@macuxi/platform-sdk';
import { CARGO_DA_BASE, PERFIS, type Manifesto, type Perfil } from '@macuxi/platform-sdk';
import type pg from 'pg';
import { manifest as catalogo } from '../../modules/catalogo/manifest';
import { manifest as core } from '../../modules/core/manifest';
import { manifest as gestor } from '../../modules/gestor/manifest';
import { manifest as integracao } from '../../modules/integracao/manifest';
import { manifest as pesquisa } from '../../modules/pesquisa/manifest';
import { manifest as promotor } from '../../modules/promotor/manifest';
import { manifest as treinamento } from '../../modules/treinamento/manifest';
import { manifest as vendedor } from '../../modules/vendedor/manifest';

/** Os 8 manifestos instalados (os mesmos da matriz congelada na 0103). */
export const MANIFESTOS: readonly Manifesto[] = [core, catalogo, vendedor, promotor, gestor, pesquisa, treinamento, integracao];

export type Valor = { nivel?: string; alvos?: string[] };
export type Permissoes = Record<string, Valor>;
export interface LinhaModelo {
  versao: number;
  modelo: string;
  cargo: string;
  chave: string;
  nivel: string | null;
  alvos: string[] | null;
}

const API = sdk as unknown as Record<string, unknown>;
type Fn = (...a: unknown[]) => unknown;
const fn = (nome: string): Fn | null => (typeof API[nome] === 'function' ? (API[nome] as Fn) : null);

/** Versão do catálogo do SDK (E1); 1 enquanto a constante não existe. */
export const VERSAO_DO_SDK: number = typeof API.CATALOGO_PERMISSOES_VERSAO === 'number' ? (API.CATALOGO_PERMISSOES_VERSAO as number) : 1;

/** Linhas dos 7 modelos pelo SDK, na ordem de PERFIS e da chave (o formato de plataforma.modelo_permissao). */
export function linhasDoSdk(): LinhaModelo[] {
  const modelos = fn('modelosDePerfil');
  const linhas = fn('linhasDosModelos');
  if (modelos && linhas) {
    return (linhas(modelos(MANIFESTOS), 1) as LinhaModelo[]).map((l) => ({ ...l, alvos: l.alvos ? [...l.alvos] : null }));
  }
  const matriz = sdk.matrizDeFabrica(MANIFESTOS);
  return PERFIS.flatMap((modelo) =>
    Object.keys(matriz[modelo])
      .sort()
      .map((chave) => {
        const v = matriz[modelo][chave]!;
        return { versao: 1, modelo, cargo: CARGO_DA_BASE[modelo], chave, nivel: v.nivel ?? null, alvos: v.alvos ? [...v.alvos] : null };
      }),
  );
}

/** Sobreposição como a 0041 grava (plataforma.perfil_permissao). */
export interface Sobreposicao {
  chave: string;
  concedida: boolean;
  nivel?: string | null;
  alvos?: string[] | null;
}

/** resolverPerfil do SDK (motor antigo) sobre a matriz dos 8 manifestos; null se o SDK já não o tiver. */
export function resolverLegadoNoSdk(base: Perfil, sobreposicoes: readonly Sobreposicao[]): Permissoes | null {
  const resolver = fn('resolverPerfil');
  const matriz = fn('matrizDeFabrica');
  if (!resolver || !matriz) return null;
  const r = resolver({ codigo: base, base, ativo: true, fabrica: false, sobreposicoes }, matriz(MANIFESTOS)) as { permissoes: Permissoes };
  return normalizar(r.permissoes);
}

/** perfilDeCompatibilidade do SDK (E1); null antes dela. */
export function compatNoSdk(cargo: string, permissoes: Permissoes): string | null {
  const f = fn('perfilDeCompatibilidade');
  return f ? (f(cargo, permissoes) as string) : null;
}

/** travaDaChavePeloCargo do SDK (E1): a RN da trava, ou null; undefined antes dela. */
export function travaNoSdk(cargo: string, chave: string, gestaoDoAcesso: boolean): string | null | undefined {
  const f = fn('travaDaChavePeloCargo');
  if (!f) return undefined;
  const t = f(cargo, chave, { gestaoDoAcesso }) as { regra: string } | null;
  return t ? t.regra : null;
}

/** Chave -> { nivel?, alvos? } com alvos em ordem e sem repetição (a comparação da 0105). */
export function normalizar(p: Readonly<Record<string, { nivel?: string | null; alvos?: readonly string[] | null }>> | null | undefined): Permissoes {
  const saida: Permissoes = {};
  for (const chave of Object.keys(p ?? {}).sort()) {
    const v = p![chave]!;
    saida[chave] = { ...(v.nivel ? { nivel: v.nivel } : {}), ...(v.alvos ? { alvos: [...new Set(v.alvos)].sort() } : {}) };
  }
  return saida;
}

/** Retrato das concessões de um tenant (tudo, vivas e apagadas): o que a idempotência compara. */
export async function retratoConcessoes(c: pg.ClientBase, tenant: string): Promise<{ n: number; hash: string; vivas: number }> {
  const r = await c.query<{ n: string; hash: string; vivas: string }>(
    `select count(*) as n, count(*) filter (where deleted_at is null) as vivas,
            md5(coalesce(string_agg(id::text || '|' || chave || '|' || coalesce(nivel, '') || '|' || coalesce(array_to_string(alvos, ','), '')
                                    || '|' || updated_at::text || '|' || coalesce(deleted_at::text, ''), ';' order by id), '')) as hash
       from plataforma.perfil_concessao where tenant_id = $1`,
    [tenant],
  );
  return { n: Number(r.rows[0]!.n), hash: r.rows[0]!.hash, vivas: Number(r.rows[0]!.vivas) };
}

/** Concessões vivas de um perfil, normalizadas. */
export async function concessoesDoPerfil(c: pg.ClientBase, perfil: string): Promise<Permissoes> {
  const r = await c.query<{ p: Permissoes }>('select plataforma.concessoes_do_perfil($1) as p', [perfil]);
  return normalizar(r.rows[0]!.p);
}

/** Acesso de hoje (gêmea SQL de resolverPerfil), com ou sem o ajuste dos 2 parâmetros, normalizado. */
export async function legadoDoPerfil(c: pg.ClientBase, perfil: string, parametros = false): Promise<Permissoes> {
  const r = await c.query<{ p: Permissoes }>('select plataforma.permissoes_legado_do_perfil($1, $2) as p', [perfil, parametros]);
  return normalizar(r.rows[0]!.p);
}

/** Achados abertos de um tenant: "tipo/efeito/perfil/chave", em ordem. */
export async function achados(c: pg.ClientBase, tenant: string, abertos = true): Promise<string[]> {
  const r = await c.query<{ l: string }>(
    `select tipo || '/' || efeito || '/' || coalesce(perfil_codigo, '-') || '/' || coalesce(chave, '-') as l
       from plataforma.perfil_migracao_conflito
      where tenant_id = $1 and deleted_at is null and ($2::boolean is false or resolvido_em is null)
      order by 1`,
    [tenant, abertos],
  );
  return r.rows.map((x) => x.l);
}

/** Leitura do tenant na transição. */
export async function leitura(c: pg.ClientBase, tenant: string): Promise<string> {
  return (await c.query<{ l: string }>('select plataforma.leitura_de_perfis($1) as l', [tenant])).rows[0]!.l;
}
