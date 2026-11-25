/**
 * Caminho novo da autorização (ADR 0073 §2.7, E3) com os módulos INSTALADOS: decide pela concessão do perfil sem base e pelo
 * cargo, sem `RotaModulo.perfis` nem o `perfis` do manifesto. Confere, nos 7 perfis padrão (modelos), que:
 *  - em toda ação do catálogo, `verificarAcaoPeloCargo` responde igual ao motor antigo (`verificarAcao`), e a leitura dupla não
 *    acusa diferença (RN-CORE-35: os perfis migrados mantêm o acesso de hoje);
 *  - em toda rota, o caminho novo nunca recusa o que o antigo aceita e só aceita a mais nas rotas de leitura SEM `acao` cuja lista
 *    `perfis` é mais estreita que o módulo (`PENDENTES_DA_E6`): essas precisam ganhar `acao` (chave do catálogo) no PR do dono
 *    antes da troca de leitura. Rota nova nessa situação, ou rota da lista que deixe de abrir, faz este teste falhar;
 *  - RN-PRO-01: o cargo promotor é barrado em toda rota de escrita de pedido; RN-CORE-33: rota do BKO recusa vendedor, promotor
 *    e supervisor.
 */
import {
  autorizarRotaPeloCargo,
  camposPeloCargo,
  catalogoDePermissoes,
  criarPermissoes,
  diferencasEntreMotores,
  matrizDeFabrica,
  MODELOS_PERFIL,
  modelosDePerfil,
  perfilDeFabrica,
  podeEntrar,
  promotorBarradoNaRota,
  resolverPerfil,
  verificarAcao,
  verificarAcaoPeloCargo,
  verificarAcesso,
  type ModuloId,
  type Perfil,
  type RotaModulo,
  type UsuarioAcesso,
} from '@macuxi/platform-sdk';
import { describe, expect, it } from 'vitest';
import { MODULOS_API } from '../src/modulos';

const MANIFESTOS = MODULOS_API.map((m) => m.manifesto);
const PERMISSOES = criarPermissoes(MANIFESTOS);
const MODELOS = modelosDePerfil(MANIFESTOS);
const MATRIZ = matrizDeFabrica(MANIFESTOS);
const CHAVES = catalogoDePermissoes(MANIFESTOS).map((d) => d.chave);

/**
 * Rotas de leitura sem `acao` que hoje restringem por `perfis` e que o caminho novo abriria a todo perfil com a licença do
 * módulo. Cada dono troca `perfis` por `acao` (chave nova no catálogo, `CATALOGO_PERMISSOES_VERSAO` sobe) antes da E6.
 */
const PENDENTES_DA_E6 = new Set([
  'core GET carteira',
  'core GET clientes/:id/carteira',
  'core GET dispositivos',
  'core GET equipe/hierarquia',
  'core GET licencas',
  'core GET rotas',
  'core GET rotas/:usuarioId/:data',
  'core GET usuarios/:id/clientes',
  'core GET visitas',
  'pesquisa GET questionarios',
  'pesquisa GET questionarios/:id',
  'promotor GET cadastros/categorias',
  'promotor GET cadastros/checklists',
  'promotor GET cadastros/concorrentes',
  'promotor GET cadastros/metas-share',
  'promotor GET cadastros/mix',
  'promotor GET cadastros/parametros',
  'promotor GET cadastros/produtos-concorrente',
  'promotor GET relatorios/ruptura',
  'promotor GET relatorios/share',
]);

/** Usuário de um perfil padrão: módulos do padrão do perfil (`perfis` do manifesto = `perfil_modulo` de fábrica), os dois motores. */
function usuario(m: Perfil): UsuarioAcesso {
  return {
    id: 'u',
    tenant_id: 't',
    perfil: m,
    modulos: MANIFESTOS.filter((x) => x.perfis.includes(m)).map((x) => x.id) as ModuloId[],
    perfis: [{ codigo: m, base: m, permissoes: resolverPerfil(perfilDeFabrica(m), MATRIZ).permissoes }],
    ...camposPeloCargo({ codigo: m, ...MODELOS[m] }),
  };
}

/** A decisão de hoje em `apps/api/src/app.ts` (`montarRota`, passos 1 a 3), sem o super-admin. */
function rotaPeloMotorAntigo(u: UsuarioAcesso, modulo: ModuloId, rotas: readonly RotaModulo[]): boolean[] {
  return rotas.map((rota) => {
    if (!verificarAcesso(u, { modulo, perfis: [u.perfil] }).ok) return false;
    if (rota.superficie === 'bko' && !podeEntrar(u.perfis, 'bko')) return false;
    if (u.perfil === 'promotor' && promotorBarradoNaRota(rota)) return false;
    const manifesto = MANIFESTOS.find((x) => x.id === modulo)!;
    return (
      rota.acao
        ? verificarAcao(u, PERMISSOES, rota.acao)
        : verificarAcesso(u, { modulo, perfis: rota.perfis ?? manifesto.perfis })
    ).ok;
  });
}

describe('caminho novo da autorização com os módulos instalados (ADR 0073, E3)', () => {
  it('RN-CORE-35: em toda ação do catálogo, os 7 perfis padrão respondem igual nos dois motores', () => {
    for (const m of MODELOS_PERFIL) {
      const u = usuario(m);
      for (const chave of CHAVES)
        expect(verificarAcaoPeloCargo(u, PERMISSOES, chave).ok, `${m} ${chave}`).toBe(
          verificarAcao(u, PERMISSOES, chave).ok,
        );
      expect(diferencasEntreMotores(u.perfis, u.perfil_acesso), m).toEqual([]);
    }
  });

  it('em toda rota, o caminho novo nunca recusa o que o antigo aceita e abre exatamente as rotas pendentes da E6', () => {
    const fechadas: string[] = [];
    const abertas = new Set<string>();
    for (const api of MODULOS_API) {
      const rotas = (api.rotas ?? []).filter((r) => r.superAdmin !== 'exige');
      for (const m of MODELOS_PERFIL) {
        const u = usuario(m);
        const antigo = rotaPeloMotorAntigo(u, api.manifesto.id, rotas);
        rotas.forEach((r, i) => {
          const novo = autorizarRotaPeloCargo(u, PERMISSOES, api.manifesto.id, r).ok;
          const nome = `${api.manifesto.id} ${r.metodo} ${r.caminho}`;
          if (antigo[i] && !novo) fechadas.push(`${nome} (${m})`);
          if (!antigo[i] && novo) abertas.add(nome);
        });
      }
    }
    expect(fechadas).toEqual([]);
    expect([...abertas].sort()).toEqual([...PENDENTES_DA_E6].sort());
  });

  it('RN-PRO-01 e RN-CORE-33 nas rotas reais: promotor fora de toda escrita de pedido; BKO só de quem tem acesso.bko', () => {
    const promotor = usuario('promotor');
    for (const api of MODULOS_API)
      for (const r of api.rotas ?? []) {
        if (promotorBarradoNaRota(r))
          expect(
            autorizarRotaPeloCargo(promotor, PERMISSOES, api.manifesto.id, r).ok,
            `${api.manifesto.id} ${r.metodo} ${r.caminho}`,
          ).toBe(false);
        if (r.superficie === 'bko')
          for (const m of ['vendedor', 'promotor', 'supervisor'] as const)
            expect(
              autorizarRotaPeloCargo(usuario(m), PERMISSOES, api.manifesto.id, r).ok,
              `${m} ${r.caminho}`,
            ).toBe(false);
      }
  });
});
