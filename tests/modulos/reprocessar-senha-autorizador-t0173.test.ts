/**
 * T-0173 — reprocessar lote com a senha de quem autoriza (RN-INT-16), integração entre módulos SEM banco:
 * rota `lotes/:id/reprocessar` do Hub (modules/integracao) → porta `verificarSenhaAutorizador` do apps/api →
 * consultas `core.usuarios_com_acao@1` e `core.credencial_conferir@1` do Core (implementações reais, argon2id real,
 * permissão efetiva com a matriz dos manifestos reais). Só o `db` e a `tx` são simulados.
 *
 * Confere: senha certa reprocessa e apaga os erros antigos; a lista de autorizadores vem do Core, sem quem pede; o solicitante não
 * autoriza a si mesmo (422 `autorizador_invalido`); a conferência devolve `incorreta`/`bloqueado`/`sem_permissao` e a porta do
 * apps/api esconde os dois últimos; a 6ª falha do mesmo autorizador dá 429; outro autorizador não é afetado; perfil personalizado
 * com a ação autoriza; cancelar de novo devolve 200 sem auditar; a auditoria grava quem autorizou e nunca a senha (nem em log).
 * Precisa de Node >= 24.7 (crypto.argon2); em Node mais antigo, pula com aviso.
 */
import crypto from 'node:crypto';
import { CONSULTA_CREDENCIAL_CONFERIR, CONSULTA_USUARIOS_COM_ACAO } from '@macuxi/core/contracts';
import { manifest as core } from '@macuxi/core/manifest';
import { manifest as integracao } from '@macuxi/integracao/manifest';
import { matrizDeFabrica, type ErroHttpModulo } from '@macuxi/platform-sdk';
import { beforeAll, describe, expect, it } from 'vitest';
import { verificarSenhaAutorizador } from '../../apps/api/src/senha-autorizador';
import { consultaCredencialConferir, consultaUsuariosComAcao } from '../../modules/core/api/credencial';
import { hashSenha } from '../../modules/core/api/seguranca';
import {
  criarLimiteTentativas,
  criarRotaReprocessarLote,
  rotaCancelarLote,
  rotaListarAutorizadores,
} from '../../modules/integracao/api/bko-lotes-acoes';

const temArgon2 = typeof (crypto as unknown as { argon2?: unknown }).argon2 === 'function';
const TENANT = '0f000000-0000-4000-8000-000000000001';
const LOTE = '0b7e6c52-1c1c-4b43-9d1e-0a4f0f3a2222';
const ANA = '0a000000-0000-4000-8000-0000000000a1'; // admin
const BRUNO = '0a000000-0000-4000-8000-0000000000b2'; // analista
const CAIO = '0a000000-0000-4000-8000-0000000000c3'; // admin com a conta bloqueada
const DIEGO = '0a000000-0000-4000-8000-0000000000d4'; // gerente de fábrica: sem lote.reprocessar
const EVA = '0a000000-0000-4000-8000-0000000000e5'; // gerente com perfil personalizado que concede lote.reprocessar
const SOLICITANTE = '0e000000-0000-4000-8000-0000000000e1'; // gerente que pede o reprocessamento
const SENHA: Record<string, string> = {
  [ANA]: 'senha-ficticia-da-ana-1',
  [BRUNO]: 'senha-ficticia-do-bruno-2',
  [CAIO]: 'senha-ficticia-do-caio-3',
  [DIEGO]: 'senha-ficticia-do-diego-4',
  [EVA]: 'senha-ficticia-da-eva-5',
  [SOLICITANTE]: 'senha-ficticia-do-solicitante-6',
};
const AGORA = new Date('2026-11-15T18:00:00Z');
const MATRIZ = matrizDeFabrica([core, integracao]);
const ACAO = { modulo: 'integracao', acao: 'lote.reprocessar' };

interface LinhaPerfil {
  codigo: string;
  base: string;
  fabrica: boolean;
  sobreposicoes: unknown;
}
interface UsuarioCore {
  id: string;
  nome: string;
  perfil: string;
  senha_hash: string;
  ativo: boolean;
  bloqueado_em: Date | null;
  bloqueio_ate: Date | null;
  deleted_at: null;
  linhas: LinhaPerfil[];
}
let usuarios: Record<string, UsuarioCore>;

beforeAll(async () => {
  if (!temArgon2) return;
  const u = async (
    id: string,
    nome: string,
    perfil: string,
    extra: Partial<UsuarioCore> = {},
  ): Promise<UsuarioCore> => ({
    id,
    nome,
    perfil,
    senha_hash: await hashSenha(SENHA[id]!),
    ativo: true,
    bloqueado_em: null,
    bloqueio_ate: null,
    deleted_at: null,
    linhas: [],
    ...extra,
  });
  const bloqueio = {
    bloqueado_em: new Date('2026-11-15T17:00:00Z'),
    bloqueio_ate: new Date('2026-11-16T17:00:00Z'),
  };
  const personalizado: LinhaPerfil[] = [
    {
      codigo: 'gerente-integracao',
      base: 'gerente',
      fabrica: false,
      sobreposicoes: [{ chave: 'lote.reprocessar', concedida: true, nivel: null, alvos: null }],
    },
  ];
  const lista = await Promise.all([
    u(ANA, 'Ana', 'admin'),
    u(BRUNO, 'Bruno', 'analista'),
    u(CAIO, 'Caio', 'admin', bloqueio),
    u(DIEGO, 'Diego', 'gerente'),
    u(EVA, 'Eva', 'gerente', { linhas: personalizado }),
    u(SOLICITANTE, 'Sol', 'gerente'),
  ]);
  usuarios = Object.fromEntries(lista.map((x) => [x.id, x]));
});

/** Banco do Hub (schema integracao) e do Core (schema core) simulados: o Core só é lido pelas consultas do próprio Core. */
function criarDb(status = 'falhou') {
  const sqls: string[] = [];
  const db = {
    query: async (sql: string, params: unknown[] = []) => {
      sqls.push(sql);
      if (/left join lateral plataforma\.perfis_do_usuario/.test(sql)) {
        const rows = Object.values(usuarios)
          .filter((x) => x.ativo)
          .sort((a, b) => a.nome.localeCompare(b.nome))
          .flatMap((x) =>
            (x.linhas.length ? x.linhas : [null]).map((l) => ({
              ...x,
              codigo: l?.codigo ?? null,
              base: l?.base ?? null,
              fabrica: l?.fabrica ?? null,
              sobreposicoes: l?.sobreposicoes ?? null,
            })),
          );
        return { rows };
      }
      if (/from plataforma\.perfis_do_usuario/.test(sql))
        return { rows: usuarios[String(params[0])]?.linhas ?? [] };
      if (/from core\.usuario where id/.test(sql)) {
        const x = params[1] === TENANT ? usuarios[String(params[0])] : undefined;
        return { rows: x ? [x] : [] };
      }
      if (/from integracao\.lote where/.test(sql))
        return { rows: [{ id: LOTE, entidade: 'cliente', status, com_erro: 4, recebidas: 10 }] };
      if (/from integracao\.lote_staging/.test(sql)) return { rows: [{ tem: true }] };
      if (/join integracao\.conector/.test(sql))
        return { rows: [{ conector: 'erp-1', entidade: 'cliente', modo: 'delta' }] };
      return { rows: [] };
    },
  };
  return { db, sqls };
}

type Executavel = { executar: (c: never) => Promise<unknown> };

function montar(o: { status?: string; solicitante?: string } = {}) {
  const auditoria: Array<Record<string, unknown>> = [];
  const logs: unknown[] = [];
  const consultas: string[] = [];
  const { db, sqls } = criarDb(o.status);
  const usuario = { id: o.solicitante ?? SOLICITANTE, tenant_id: TENANT, perfil: 'gerente', perfis: [] };
  const ctxConsulta = {
    db,
    agora: () => AGORA,
    tenant_id: TENANT,
    usuario,
    permissoes: { catalogo: [], matriz: MATRIZ },
  };
  const tx = {
    auditar: async (r: Record<string, unknown>) => void auditoria.push(r),
    publicar: async () => undefined,
    consultar: async (def: { nome: string }, entrada: unknown) => {
      consultas.push(def.nome);
      if (def.nome === CONSULTA_USUARIOS_COM_ACAO.nome)
        return consultaUsuariosComAcao.executar(
          CONSULTA_USUARIOS_COM_ACAO.entrada.parse(entrada),
          ctxConsulta as never,
        );
      if (def.nome === CONSULTA_CREDENCIAL_CONFERIR.nome)
        return consultaCredencialConferir.executar(
          CONSULTA_CREDENCIAL_CONFERIR.entrada.parse(entrada),
          ctxConsulta as never,
        );
      throw new Error(`consulta não simulada: ${def.nome}`);
    },
  };
  const ctx = {
    usuario,
    params: { id: LOTE },
    agora: () => AGORA,
    comTenant: async (fn: (d: unknown, t: unknown) => unknown) => fn(db, tx),
    log: {
      info: (...a: unknown[]) => logs.push(a),
      warn: (...a: unknown[]) => logs.push(a),
      error: (...a: unknown[]) => logs.push(a),
    },
  };
  const chamar = (rota: Executavel, corpo: Record<string, unknown> = {}) =>
    rota.executar({ ...ctx, corpo } as never);
  const updates = () => sqls.filter((s) => /^update integracao\.lote/.test(s));
  const deletes = () => sqls.filter((s) => /^delete from integracao\.lote_linha_erro/.test(s));
  return { chamar, auditoria, logs, consultas, updates, deletes, ctxConsulta, tx };
}

const erroDe = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    return e as ErroHttpModulo;
  }
  throw new Error('era para falhar');
};
const resposta = (e: ErroHttpModulo) => ({ status: e.status, codigo: e.codigo, mensagem: e.message });
const novaRota = (): Executavel =>
  criarRotaReprocessarLote({
    verificarSenha: verificarSenhaAutorizador,
    limite: criarLimiteTentativas(),
  }) as never;
const pedir = (m: ReturnType<typeof montar>, rota: Executavel, autorizador_id?: string, senha?: string) =>
  m.chamar(rota, { autorizador_id, senha });

describe.skipIf(!temArgon2)(
  'T-0173 / RN-INT-16: reprocessar com a senha do autorizador (Hub + apps/api + Core)',
  () => {
    it('RN-INT-16: a lista de autorizadores vem de core.usuarios_com_acao@1 (permissão efetiva, sem bloqueado, sem quem pede, sem e-mail)', async () => {
      const m = montar();
      const r = (await m.chamar(rotaListarAutorizadores as never)) as { itens: unknown[] };
      expect(m.consultas).toEqual(['core.usuarios_com_acao@1']);
      expect(r.itens).toEqual([
        { id: ANA, nome: 'Ana' },
        { id: BRUNO, nome: 'Bruno' },
        { id: EVA, nome: 'Eva' },
      ]);
      // quem pede some da lista mesmo quando tem a ação
      const comoEva = montar({ solicitante: EVA });
      const r2 = (await comoEva.chamar(rotaListarAutorizadores as never)) as { itens: Array<{ id: string }> };
      expect(r2.itens.map((i) => i.id)).toEqual([ANA, BRUNO]);
    });

    it('RN-INT-16: senha certa reprocessa, apaga os erros antigos e a auditoria grava quem autorizou, sem a senha', async () => {
      const m = montar();
      expect(await pedir(m, novaRota(), ANA, SENHA[ANA])).toEqual({
        lote_id: LOTE,
        reenfileiradas: 4,
        status: 'recebido',
      });
      expect(m.consultas).toEqual(['core.usuarios_com_acao@1', 'core.credencial_conferir@1']);
      expect(m.updates()).toHaveLength(1);
      expect(m.deletes()).toHaveLength(1);
      expect(m.auditoria).toHaveLength(1);
      expect(m.auditoria[0]).toMatchObject({
        acao: 'lote.reprocessar',
        entidade_id: LOTE,
        depois: { via: 'autorizado', autorizado_por: ANA },
      });
      expect(JSON.stringify([m.auditoria, m.logs])).not.toContain(SENHA[ANA]);
    });

    it('RN-INT-16 / RN-CORE-35: perfil personalizado que concede lote.reprocessar autoriza', async () => {
      const m = montar();
      expect(await pedir(m, novaRota(), EVA, SENHA[EVA])).toMatchObject({ status: 'recebido' });
      expect(m.auditoria[0]).toMatchObject({ depois: { autorizado_por: EVA } });
    });

    it('RN-INT-16: credencial_conferir devolve ok/incorreta/bloqueado/sem_permissao e a porta do apps/api esconde os dois últimos', async () => {
      const m = montar();
      const conferir = async (usuario_id: string, senha: string) =>
        (await m.tx.consultar(CONSULTA_CREDENCIAL_CONFERIR, { usuario_id, senha, acao: ACAO })) as {
          resultado: string;
        };
      expect((await conferir(ANA, SENHA[ANA]!)).resultado).toBe('ok');
      expect((await conferir(ANA, 'senha-errada')).resultado).toBe('incorreta');
      expect((await conferir(CAIO, SENHA[CAIO]!)).resultado).toBe('bloqueado');
      expect((await conferir(DIEGO, SENHA[DIEGO]!)).resultado).toBe('sem_permissao');
      expect((await conferir(DIEGO, 'senha-errada')).resultado).toBe('incorreta');
      expect((await conferir(EVA, SENHA[EVA]!)).resultado).toBe('ok');
      for (const id of [CAIO, DIEGO])
        expect(
          await verificarSenhaAutorizador(
            { tenant_id: TENANT, usuario_id: id, senha: SENHA[id]!, acao: ACAO },
            m.tx as never,
          ),
          id,
        ).toBe('incorreta');
      expect(
        await verificarSenhaAutorizador(
          { tenant_id: TENANT, usuario_id: ANA, senha: SENHA[ANA]!, acao: ACAO },
          m.tx as never,
        ),
      ).toBe('ok');
    });

    it('RN-INT-16: senha errada dá 422 "Senha incorreta."; conta bloqueada sai da lista e dá 403 antes de conferir a senha', async () => {
      const m = montar();
      const errada = resposta(await erroDe(pedir(m, novaRota(), ANA, 'senha-errada')));
      expect(errada).toEqual({ status: 422, codigo: 'senha_incorreta', mensagem: 'Senha incorreta.' });
      const bloqueado = await erroDe(pedir(m, novaRota(), CAIO, SENHA[CAIO]));
      expect([bloqueado.status, bloqueado.codigo]).toEqual([403, 'autorizador_sem_permissao']);
      expect(m.updates()).toHaveLength(0);
      expect(m.deletes()).toHaveLength(0);
      expect(m.auditoria).toHaveLength(0);
    });

    it('RN-INT-16: autorizador = solicitante → 422 autorizador_invalido; gerente sem a ação → 403; sem autorizador → 403', async () => {
      const m = montar();
      const rota = novaRota();
      const eu = await erroDe(pedir(m, rota, SOLICITANTE, SENHA[SOLICITANTE]));
      expect([eu.status, eu.codigo]).toEqual([422, 'autorizador_invalido']);
      const comoEva = montar({ solicitante: EVA });
      const eva = await erroDe(pedir(comoEva, novaRota(), EVA, SENHA[EVA]));
      expect([eva.status, eva.codigo]).toEqual([422, 'autorizador_invalido']);
      const diego = await erroDe(pedir(m, rota, DIEGO, SENHA[DIEGO]));
      expect([diego.status, diego.codigo]).toEqual([403, 'autorizador_sem_permissao']);
      const nada = await erroDe(pedir(m, rota));
      expect([nada.status, nada.codigo]).toEqual([403, 'autorizador_necessario']);
      expect([...m.consultas, ...comoEva.consultas]).not.toContain('core.credencial_conferir@1');
      expect(m.updates()).toHaveLength(0);
    });

    it('RN-INT-16: 5 erros do mesmo autorizador → a 6ª tentativa dá 429 (até com a senha certa); outro autorizador segue normal', async () => {
      const m = montar();
      const rota = novaRota();
      for (let i = 1; i <= 5; i++)
        expect((await erroDe(pedir(m, rota, ANA, `errada-${i}`))).status, `tentativa ${i}`).toBe(422);
      const sexta = await erroDe(pedir(m, rota, ANA, SENHA[ANA]));
      expect([sexta.status, sexta.codigo]).toEqual([429, 'muitas_tentativas']);
      expect((await erroDe(pedir(m, rota, BRUNO, 'errada'))).status).toBe(422);
      expect(await pedir(m, rota, BRUNO, SENHA[BRUNO])).toMatchObject({ status: 'recebido' });
      expect(m.auditoria.map((a) => (a.depois as { autorizado_por: string }).autorizado_por)).toEqual([
        BRUNO,
      ]);
      const tudo = JSON.stringify([m.auditoria, m.logs]);
      for (const s of [SENHA[ANA]!, SENHA[BRUNO]!, 'errada-1']) expect(tudo).not.toContain(s);
    });

    it('RN-INT-15: cancelar lote já cancelado devolve 200 com o mesmo corpo, sem update nem auditoria', async () => {
      const m = montar({ status: 'cancelado' });
      expect(await m.chamar(rotaCancelarLote as never)).toEqual({ lote_id: LOTE, status: 'cancelado' });
      expect(m.updates()).toHaveLength(0);
      expect(m.auditoria).toHaveLength(0);
      const concluido = montar({ status: 'concluido' });
      const e = await erroDe(concluido.chamar(rotaCancelarLote as never));
      expect([e.status, e.codigo]).toEqual([409, 'lote_nao_esta_em_andamento']);
    });
  },
);

describe.runIf(!temArgon2)('T-0173 / RN-INT-16 (aviso)', () => {
  it.skip('pulado: este Node não tem crypto.argon2 (precisa de Node >= 24.7)', () => undefined);
});
