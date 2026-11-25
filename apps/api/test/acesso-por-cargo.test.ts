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
  ACOES_DA_TRANSICAO,
  acoesDoModulo,
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
 * módulo, com a chave do catálogo v2 que cada uma recebe como `acao` no PR do dono antes da E6 (ADR 0073). Duas reaproveitam a
 * chave da escrita da mesma tela (`modulo.gerir_licencas`, `dispositivo.bloquear`); as outras vêm de `ACOES_DA_TRANSICAO` até o
 * manifesto declará-las. Quando a rota ganhar a `acao`, ela sai daqui.
 */
const CHAVE_DA_PENDENTE: Readonly<Record<string, string>> = {
  'core GET carteira': 'carteira.ver',
  'core GET clientes/:id/carteira': 'carteira.ver',
  'core GET usuarios/:id/clientes': 'carteira.ver',
  'core GET dispositivos': 'dispositivo.bloquear',
  'core GET equipe/hierarquia': 'equipe.ver',
  'core GET licencas': 'modulo.gerir_licencas',
  'core GET rotas': 'rota.ver',
  'core GET rotas/:usuarioId/:data': 'rota.ver',
  'core GET visitas': 'visita.ver',
  'pesquisa GET questionarios': 'questionario.ver',
  'pesquisa GET questionarios/:id': 'questionario.ver',
  'promotor GET cadastros/categorias': 'cadastro_trade.ver',
  'promotor GET cadastros/checklists': 'cadastro_trade.ver',
  'promotor GET cadastros/concorrentes': 'cadastro_trade.ver',
  'promotor GET cadastros/metas-share': 'cadastro_trade.ver',
  'promotor GET cadastros/mix': 'cadastro_trade.ver',
  'promotor GET cadastros/parametros': 'cadastro_trade.ver',
  'promotor GET cadastros/produtos-concorrente': 'cadastro_trade.ver',
  'promotor GET relatorios/ruptura': 'relatorio_trade.ver',
  'promotor GET relatorios/share': 'relatorio_trade.ver',
};
const PENDENTES_DA_E6 = new Set(Object.keys(CHAVE_DA_PENDENTE));

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

  it('catálogo v2: cada rota pendente tem chave no catálogo, do mesmo módulo e com os mesmos perfis da rota (ninguém perde acesso)', () => {
    for (const api of MODULOS_API) {
      const acoes = acoesDoModulo(api.manifesto);
      for (const r of api.rotas ?? []) {
        const nome = `${api.manifesto.id} ${r.metodo} ${r.caminho}`;
        const chave = CHAVE_DA_PENDENTE[nome];
        if (!chave) continue;
        expect(CHAVES, nome).toContain(chave);
        expect([...(acoes[chave]?.perfis ?? [])].sort(), nome).toEqual([...(r.perfis ?? [])].sort());
      }
    }
  });

  it('ACOES_DA_TRANSICAO não diverge do manifesto que já declara a chave (mesmos perfis)', () => {
    for (const api of MODULOS_API)
      for (const [chave, def] of Object.entries(ACOES_DA_TRANSICAO[api.manifesto.id] ?? {})) {
        const declarada = api.manifesto.acoes[chave];
        if (declarada) expect([...declarada.perfis].sort(), chave).toEqual([...def.perfis].sort());
      }
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
