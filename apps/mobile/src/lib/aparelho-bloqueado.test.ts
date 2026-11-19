import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { AVISO_APARELHO_LIMPO, CODIGO_DISPOSITIVO_BLOQUEADO } from '@macuxi/core/contracts';
import {
  comPrefixo,
  criarMotorSync,
  criarRegistroSync,
  defineModule,
  definirEntidadeSync,
  type ArmazenamentoSync,
} from '@macuxi/platform-sdk';
// o índice de `@macuxi/core/app` puxa telas (react-native); o teste usa a função pura do Core direto
import { ehAparelhoBloqueado, tratarAparelhoBloqueado } from '../../../../modules/core/app/lib/aparelho-bloqueado';
import { chavesDoAparelhoBloqueado, criarTratadorAparelhoBloqueado, type FontesAparelhoBloqueado } from './aparelho-bloqueado';

const USUARIO = '0a000000-0000-4000-8000-000000000001';
const OUTRO = '0a000000-0000-4000-8000-000000000002';
const VISITA = '0e000000-0000-4000-8000-000000000001';
const FOTO = '0f000000-0000-4000-8000-0000000000a1';

/** AsyncStorage simulado (chave → JSON), com o mesmo prefixo por usuário de `services/armazenamento.ts`. */
function discoSimulado(inicial: Record<string, unknown>) {
  const dados = new Map(Object.entries(inicial).map(([k, v]) => [k, JSON.stringify(v)]));
  const doUsuario = (id: string): ArmazenamentoSync => {
    const base: ArmazenamentoSync = {
      ler: async <T,>(c: string) => (dados.has(c) ? (JSON.parse(dados.get(c)!) as T) : null),
      gravar: async (c, v) => void (v === null || v === undefined ? dados.delete(c) : dados.set(c, JSON.stringify(v))),
      remover: async (c) => void dados.delete(c),
      chaves: async (p) => [...dados.keys()].filter((k) => k.startsWith(p)).sort(),
    };
    return comPrefixo(base, `macuxi:u:${id}:`);
  };
  return { dados, doUsuario };
}

async function montar() {
  const disco = discoSimulado({
    'fv:dispositivo': 'aparelho-1',
    'fv:settings': { apiUrl: null },
    'fv:codigo_empresa': 'ACME',
    'fv:session': { user: { id: USUARIO } },
    [`macuxi:u:${OUTRO}:sync:fila`]: [{ id: 'x' }],
    [`macuxi:u:${OUTRO}:mod:core:me`]: { nome: 'outro' },
    [`fv:u:${USUARIO}:outbox`]: [],
  });
  const registro = criarRegistroSync([defineModule({ id: 'core', versao: '1.0.0', perfis: ['vendedor'], sync: ['visita'] })]);
  registro.registrar(definirEntidadeSync({ nome: 'visita', modulo: 'core', direcao: 'ambos', conflito: 'somente_insercao', schema: z.object({ foto_fachada_id: z.string() }) }));
  const fotos = new Set([`fotos/${FOTO}.jpg`, 'fotos/ainda-nao-enfileirada.jpg']);
  const motor = criarMotorSync({
    registro,
    armazenamento: disco.doUsuario(USUARIO),
    transporte: { push: async () => [], pull: async () => ({ itens: [], proximo_cursor: null }) },
    online: () => false,
    arquivos: { ler: async () => null, remover: async (c) => void fotos.delete(c) },
  });
  await motor.carregar();
  await motor.aplicarModulosAtivos(['core']);
  await motor.enfileirar({ id: VISITA, entidade: 'visita', payload: { foto_fachada_id: FOTO } });
  await motor.enfileirarArquivo({ id: FOTO, modulo: 'core' });
  await motor.armazenamentoDoModulo('core').gravar('me', { nome: 'Ana' });

  const passos: string[] = [];
  let motorAberto: typeof motor | null = motor;
  let tokens: string | null = 'access+refresh';
  let aviso: string | null = null;
  const fontes: FontesAparelhoBloqueado = {
    motor: () => motorAberto,
    // T-0156 (tracking §3.4): a captura do trajeto para antes de qualquer apagamento (nenhum ponto chega a banco apagado)
    pararCaptura: async () => {
      passos.push('captura');
    },
    apagarBancos: async () => {
      // T-0088: depois da limpeza do motor (o motor ainda está aberto) e antes da varredura das chaves
      passos.push(motorAberto && disco.dados.size > 0 ? 'bancos' : 'bancos?');
    },
    chavesLocais: async () => [...disco.dados.keys()],
    removerChaves: async (ks) => {
      for (const k of ks) disco.dados.delete(k);
    },
    apagarFotos: async () => {
      passos.push('fotos');
      fotos.clear();
    },
    apagarTokens: async () => {
      passos.push('tokens');
      tokens = null;
    },
    fecharSessao: () => {
      passos.push('sessao');
      motorAberto = null;
    },
    avisar: (m) => {
      passos.push('aviso');
      aviso = m;
    },
    irParaLogin: () => passos.push('login'),
  };
  return { disco, motor, fotos, fontes, passos, estado: () => ({ tokens, aviso, motorAberto }) };
}

describe('aparelho bloqueado no shell (RN-CORE-15)', () => {
  it('423 DISPOSITIVO_BLOQUEADO apaga dados, fila e fotos, encerra a sessão, avisa e volta ao login', async () => {
    const t = await montar();
    const tratar = criarTratadorAparelhoBloqueado(t.fontes, tratarAparelhoBloqueado, ehAparelhoBloqueado);

    expect(await tratar({ status: 423, code: CODIGO_DISPOSITIVO_BLOQUEADO })).toBe(true);

    expect(t.motor.estado()).toMatchObject({ fila: [], arquivos: [], modulosAtivos: [] });
    // nada de nenhum usuário fica no aparelho; o id do aparelho, o servidor e o código da empresa ficam
    expect(Object.fromEntries(t.disco.dados)).toEqual({
      'fv:dispositivo': JSON.stringify('aparelho-1'),
      'fv:settings': JSON.stringify({ apiUrl: null }),
      'fv:codigo_empresa': JSON.stringify('ACME'),
    });
    expect(t.fotos.size).toBe(0);
    expect(t.estado()).toEqual({ tokens: null, aviso: AVISO_APARELHO_LIMPO, motorAberto: null });
    expect(t.passos).toEqual(['captura', 'bancos', 'fotos', 'tokens', 'sessao', 'aviso', 'login']);
  });

  it('no login (sem motor aberto) também varre os dados de todos os usuários do aparelho', async () => {
    const t = await montar();
    const tratar = criarTratadorAparelhoBloqueado({ ...t.fontes, motor: () => null }, tratarAparelhoBloqueado, ehAparelhoBloqueado);
    expect(await tratar({ codigo: CODIGO_DISPOSITIVO_BLOQUEADO })).toBe(true);
    expect([...t.disco.dados.keys()].sort()).toEqual(['fv:codigo_empresa', 'fv:dispositivo', 'fv:settings']);
    // sem motor, os bancos SQLite de todos os usuários saem do mesmo jeito (desenho T-0088 §3)
    expect(t.passos.filter((p) => p.startsWith('bancos'))).toHaveLength(1);
    expect(t.passos.at(-1)).toBe('login');
  });

  it('outros erros (401, 403 DISPOSITIVO_INVALIDO, sem rede) não tocam em nada', async () => {
    const t = await montar();
    const tratar = criarTratadorAparelhoBloqueado(t.fontes, tratarAparelhoBloqueado, ehAparelhoBloqueado);
    for (const e of [{ status: 401, code: 'TOKEN_EXPIRADO' }, { status: 403, codigo: 'DISPOSITIVO_INVALIDO' }, new Error('Sem conexão'), null])
      expect(await tratar(e)).toBe(false);
    expect(t.motor.estado().fila).toHaveLength(1);
    expect(t.passos).toEqual([]);
  });

  it('várias chamadas com 423 ao mesmo tempo limpam o aparelho uma vez só', async () => {
    const t = await montar();
    let vezes = 0;
    const tratar = criarTratadorAparelhoBloqueado(
      t.fontes,
      async (e, a) => {
        vezes++;
        return tratarAparelhoBloqueado(e, a);
      },
      ehAparelhoBloqueado,
    );
    const erro = { status: 423, code: CODIGO_DISPOSITIVO_BLOQUEADO };
    expect(await Promise.all([tratar(erro), tratar(erro), tratar(erro)])).toEqual([true, true, true]);
    expect(vezes).toBe(1);
  });

  it('só as chaves de usuário e a sessão guardada saem', () => {
    expect(chavesDoAparelhoBloqueado(['fv:dispositivo', 'fv:session', 'fv:offline', 'macuxi:u:a:sync:fila', 'fv:u:a:outbox', 'macuxi.sessao.tokens'])).toEqual([
      'fv:session',
      'macuxi:u:a:sync:fila',
      'fv:u:a:outbox',
    ]);
  });
});
