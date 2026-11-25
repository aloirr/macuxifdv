/**
 * Catálogo de permissões dos manifestos INSTALADOS (ADR 0073 §2.2, E1): instantâneo das chaves (com nível e alvos) por versão.
 * Nenhuma chave entra, muda de nome, de nível ou de alvos, ou sai sem `CATALOGO_PERMISSOES_VERSAO` subir: suba a versão no SDK e ACRESCENTE o mapa novo em
 * `catalogo-permissoes.instantaneo.json` (as versões antigas não mudam: são as de `plataforma.modelo_permissao` já aplicadas).
 * Também confere os 7 modelos com os manifestos reais: nenhuma trava pelo cargo violada (RN-PRO-01, RN-CORE-33, RN-CORE-04), o
 * nome de compatibilidade igual ao perfil padrão e a equivalência com o motor antigo (ADR 0073 §2.8), e a RN-PRO-01 no catálogo.
 */
import { readFileSync } from 'node:fs';
import {
  CATALOGO_PERMISSOES_VERSAO,
  catalogoDePermissoes,
  CHAVES_PLATAFORMA,
  chavesPermitidas,
  ehAcaoDeEscritaDePedido,
  escopoDosPerfis,
  matrizDeFabrica,
  MODELOS_PERFIL,
  modelosDePerfil,
  pode,
  podePeloCargo,
  perfilDeCompatibilidade,
  perfilDeFabrica,
  PERFIS,
  protegidoDaSenha,
  resolverPerfil,
  resolverPerfilPeloCargo,
  travaDaChavePeloCargo,
  validarAcessoPeloCargo,
  validarPerfilPeloCargo,
  type Perfil,
  type RefPerfil,
} from '@macuxi/platform-sdk';
import { describe, expect, it } from 'vitest';
import { MODULOS_API } from '../src/modulos';

const MANIFESTOS = MODULOS_API.map((m) => m.manifesto);
const CATALOGO = catalogoDePermissoes(MANIFESTOS);
const MODELOS = modelosDePerfil(MANIFESTOS);
const INSTANTANEO = JSON.parse(
  readFileSync(new URL('./catalogo-permissoes.instantaneo.json', import.meta.url), 'utf8'),
) as Record<string, Record<string, { nivel?: string; alvos?: true }>>;

describe('catálogo de permissões versionado (ADR 0073 §2.2)', () => {
  it('as chaves, com nível e alvos, são as do instantâneo da versão atual (qualquer mudança = versão nova)', () => {
    const atual = Object.fromEntries(
      CATALOGO.map((d) => d.chave)
        .sort()
        .map((k) => {
          const d = CATALOGO.find((x) => x.chave === k)!;
          return [k, { ...(d.nivel ? { nivel: d.nivel } : {}), ...(d.alvos ? { alvos: d.alvos } : {}) }];
        }),
    );
    expect(atual).toEqual(INSTANTANEO[String(CATALOGO_PERMISSOES_VERSAO)]);
  });

  it('o instantâneo tem as versões 1..atual, sem buraco, e cada versão muda a lista', () => {
    const versoes = Object.keys(INSTANTANEO).map(Number);
    expect(versoes).toEqual(Array.from({ length: CATALOGO_PERMISSOES_VERSAO }, (_, i) => i + 1));
    for (const v of versoes.slice(1))
      expect(INSTANTANEO[String(v)], `versão ${v}`).not.toEqual(INSTANTANEO[String(v - 1)]);
  });

  it('nenhuma chave repetida no catálogo', () => {
    const chaves = CATALOGO.map((d) => d.chave);
    expect(new Set(chaves).size).toBe(chaves.length);
  });
});

describe('modelos dos 7 perfis padrão com os manifestos instalados (ADR 0073 §2.3)', () => {
  const alvos = new Map(
    MODELOS_PERFIL.map(
      (m) => [m, { cargo: MODELOS[m].cargo, gerePerfis: protegidoDaSenha(MODELOS[m].permissoes) }] as const,
    ),
  );

  it('nenhum modelo viola as travas pelo cargo nem o catálogo', () => {
    for (const m of MODELOS_PERFIL) {
      expect(
        validarPerfilPeloCargo(
          { codigo: m, cargo: MODELOS[m].cargo, ativo: true, permissoes: MODELOS[m].permissoes },
          alvos,
          { catalogo: CATALOGO },
        ),
        m,
      ).toEqual([]);
    }
  });

  it('os 7 semeados com um admin formam um tenant válido (RN-CORE-35)', () => {
    const perfis = MODELOS_PERFIL.map((m) => ({
      codigo: m,
      cargo: MODELOS[m].cargo,
      ativo: true,
      permissoes: MODELOS[m].permissoes,
    }));
    expect(
      validarAcessoPeloCargo({
        depois: { perfis, usuarios: [{ id: 'u1', ativo: true, perfil: 'admin' }] },
        catalogo: CATALOGO,
      }),
    ).toEqual([]);
  });

  it('o nome de compatibilidade de cada modelo é o do perfil padrão (core.usuario.perfil de hoje)', () => {
    for (const m of MODELOS_PERFIL)
      expect(perfilDeCompatibilidade(MODELOS[m].cargo, MODELOS[m].permissoes), m).toBe(m);
  });
});

describe('modelos x motor antigo com os manifestos instalados (ADR 0073 §2.8, equivalência até a E6)', () => {
  const MATRIZ = matrizDeFabrica(MANIFESTOS);
  const antigo = (b: Perfil) => resolverPerfil(perfilDeFabrica(b), MATRIZ);
  const chaves = [...new Set([...CATALOGO.map((d) => d.chave), ...Object.keys(CHAVES_PLATAFORMA)])];

  it('permissões, escopo e pode() (com e sem alvo) iguais aos do perfil de fábrica', () => {
    for (const b of PERFIS) {
      const velho = antigo(b);
      const m = MODELOS[b];
      expect(m.permissoes, b).toEqual(velho.permissoes);
      expect(Object.keys(m.permissoes).sort(), b).toEqual(chavesPermitidas([velho]));
      const novo = resolverPerfilPeloCargo({ codigo: b, cargo: m.cargo, permissoes: m.permissoes });
      expect(novo.permissoes, `${b} sem perda na leitura nova`).toEqual(velho.permissoes);
      expect(novo.permissoes['dados.escopo']?.nivel ?? 'carteira', b).toBe(escopoDosPerfis([velho]));
      for (const k of chaves) {
        expect(podePeloCargo(novo, k), `${b} ${k}`).toBe(pode([velho], k));
        for (const t of PERFIS)
          for (const proprio of [true, false]) {
            const alvoNovo = {
              proprio,
              perfil: { codigo: t, gerePerfis: protegidoDaSenha(MODELOS[t].permissoes) },
            };
            const alvoVelho = { proprio, perfis: [{ codigo: t, base: t }] satisfies RefPerfil[] };
            expect(podePeloCargo(novo, k, alvoNovo), `${b} ${k} -> ${t} proprio=${proprio}`).toBe(
              pode([velho], k, alvoVelho),
            );
          }
      }
    }
  });

  it('só o modelo admin tem perfil.gerir (base admin = protegido da senha)', () => {
    expect(PERFIS.filter((b) => protegidoDaSenha(MODELOS[b].permissoes))).toEqual(['admin']);
  });
});

describe('RN-PRO-01 sobre o catálogo instalado', () => {
  it('toda ação de escrita de pedido é travada no promotor (escrita e leitura) e livre no vendedor', () => {
    const escrita = CATALOGO.map((d) => d.chave).filter(ehAcaoDeEscritaDePedido);
    expect(escrita.length).toBeGreaterThan(0);
    for (const k of escrita) {
      const p = {
        codigo: 'p_x',
        cargo: 'promotor' as const,
        ativo: true,
        permissoes: { 'acesso.campo': {}, [k]: {} },
      };
      expect(
        validarPerfilPeloCargo(p, new Map(), { catalogo: CATALOGO }).map(
          (v) => `${v.codigo}:${v.regra}:${v.chave}`,
        ),
        k,
      ).toContain(`TRAVA_DO_PERFIL:RN-PRO-01:${k}`);
      expect(resolverPerfilPeloCargo(p).permissoes[k], k).toBeUndefined();
      expect(travaDaChavePeloCargo('vendedor', k, { gestaoDoAcesso: false }), k).toBeNull();
    }
  });
});
