/**
 * T-0173 — reprocessar lote com a senha de quem autoriza (RN-INT-16), integração entre módulos SEM banco:
 * rota `lotes/:id/reprocessar` do Hub (modules/integracao) → porta `verificarSenhaAutorizador` do apps/api →
 * consulta `core.credencial_conferir@1` do Core com o argon2id real. Só o `db` e a `tx` são simulados.
 *
 * Confere: senha certa reprocessa; senha errada e conta bloqueada dão a MESMA resposta; a 6ª falha do mesmo autorizador dá 429;
 * outro autorizador não é afetado; a auditoria grava quem autorizou e nunca a senha (nem em log).
 * Precisa de Node >= 24.7 (crypto.argon2); em Node mais antigo, pula com aviso.
 */
import crypto from 'node:crypto';
import { CONSULTA_CREDENCIAL_CONFERIR } from '@macuxi/core/contracts';
import type { ErroHttpModulo } from '@macuxi/platform-sdk';
import { beforeAll, describe, expect, it } from 'vitest';
import { verificarSenhaAutorizador } from '../../apps/api/src/senha-autorizador';
import { consultaCredencialConferir } from '../../modules/core/api/credencial';
import { hashSenha } from '../../modules/core/api/seguranca';
import {
  criarLimiteTentativas,
  criarRotaReprocessarLote,
} from '../../modules/integracao/api/bko-lotes-acoes';

const temArgon2 = typeof (crypto as unknown as { argon2?: unknown }).argon2 === 'function';
const TENANT = '0f000000-0000-4000-8000-000000000001';
const LOTE = '0b7e6c52-1c1c-4b43-9d1e-0a4f0f3a2222';
const ANA = '0a000000-0000-4000-8000-0000000000a1'; // admin, senha certa conhecida
const BRUNO = '0a000000-0000-4000-8000-0000000000b2'; // analista
const CAIO = '0a000000-0000-4000-8000-0000000000c3'; // admin com a conta bloqueada
const SENHA_ANA = 'senha-ficticia-da-ana-1';
const SENHA_BRUNO = 'senha-ficticia-do-bruno-2';
const SENHA_CAIO = 'senha-ficticia-do-caio-3';
const AGORA = new Date('2026-11-15T18:00:00Z');

interface UsuarioCore {
  senha_hash: string;
  ativo: boolean;
  bloqueado_em: Date | null;
  bloqueio_ate: Date | null;
  deleted_at: null;
}
let usuarios: Record<string, UsuarioCore>;

beforeAll(async () => {
  if (!temArgon2) return;
  const u = async (senha: string, bloqueado = false): Promise<UsuarioCore> => ({
    senha_hash: await hashSenha(senha),
    ativo: true,
    bloqueado_em: bloqueado ? new Date('2026-11-15T17:00:00Z') : null,
    bloqueio_ate: bloqueado ? new Date('2026-11-16T17:00:00Z') : null,
    deleted_at: null,
  });
  usuarios = { [ANA]: await u(SENHA_ANA), [BRUNO]: await u(SENHA_BRUNO), [CAIO]: await u(SENHA_CAIO, true) };
});

function montar(rota: ReturnType<typeof criarRotaReprocessarLote>) {
  const auditoria: Array<Record<string, unknown>> = [];
  const logs: unknown[] = [];
  const updates: string[] = [];
  // banco do Hub (schema integracao) e do Core (schema core) simulados: o Core só é lido pela consulta do próprio Core
  const db = {
    query: async (sql: string, params: unknown[] = []) => {
      if (/from core\.usuario where id/.test(sql))
        return { rows: usuarios[String(params[0])] ? [usuarios[String(params[0])]] : [] };
      if (/from integracao\.lote where/.test(sql))
        return { rows: [{ id: LOTE, entidade: 'cliente', status: 'falhou', com_erro: 4, recebidas: 10 }] };
      if (/from integracao\.lote_staging/.test(sql)) return { rows: [{ tem: true }] };
      if (/join integracao\.conector/.test(sql))
        return { rows: [{ conector: 'erp-1', entidade: 'cliente', modo: 'delta' }] };
      if (/^update integracao\.lote/.test(sql)) updates.push(sql);
      return { rows: [] };
    },
  };
  const tx = {
    auditar: async (r: Record<string, unknown>) => void auditoria.push(r),
    publicar: async () => undefined,
    consultar: async (def: { nome: string }, entrada: Record<string, unknown>) => {
      if (def.nome === 'core.usuarios_resumo@1') {
        return {
          usuarios: [
            { id: ANA, nome: 'Ana', perfil: 'admin', equipe_id: null, regional_id: null, ativo: true },
            { id: BRUNO, nome: 'Bruno', perfil: 'analista', equipe_id: null, regional_id: null, ativo: true },
            { id: CAIO, nome: 'Caio', perfil: 'admin', equipe_id: null, regional_id: null, ativo: true },
          ],
          proximo_cursor: null,
        };
      }
      if (def.nome === CONSULTA_CREDENCIAL_CONFERIR.nome) {
        const impl = consultaCredencialConferir as unknown as {
          executar: (e: unknown, c: unknown) => Promise<unknown>;
        };
        return impl.executar(CONSULTA_CREDENCIAL_CONFERIR.entrada.parse(entrada), {
          db,
          agora: () => AGORA,
          tenant_id: TENANT,
        });
      }
      throw new Error(`consulta não simulada: ${def.nome}`);
    },
  };
  const ctx = {
    usuario: { id: '0e000000-0000-4000-8000-0000000000e1', tenant_id: TENANT, perfil: 'gerente', perfis: [] },
    params: { id: LOTE },
    agora: () => AGORA,
    comTenant: async (fn: (d: unknown, t: unknown) => unknown) => fn(db, tx),
    log: {
      info: (...a: unknown[]) => logs.push(a),
      warn: (...a: unknown[]) => logs.push(a),
      error: (...a: unknown[]) => logs.push(a),
    },
  };
  const pedir = (autorizador_id: string, senha: string) =>
    rota.executar({ ...ctx, corpo: { autorizador_id, senha } } as never);
  return { pedir, auditoria, logs, updates };
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

describe.skipIf(!temArgon2)(
  'T-0173 / RN-INT-16: reprocessar com a senha do autorizador (Hub + apps/api + Core)',
  () => {
    it('RN-INT-16: senha certa reprocessa e a auditoria grava quem autorizou, sem a senha', async () => {
      const m = montar(
        criarRotaReprocessarLote({
          verificarSenha: verificarSenhaAutorizador,
          limite: criarLimiteTentativas(),
        }),
      );
      expect(await m.pedir(ANA, SENHA_ANA)).toEqual({ lote_id: LOTE, reenfileiradas: 4, status: 'recebido' });
      expect(m.updates).toHaveLength(1);
      expect(m.auditoria).toHaveLength(1);
      expect(m.auditoria[0]).toMatchObject({
        acao: 'lote.reprocessar',
        entidade_id: LOTE,
        depois: { via: 'autorizado', autorizado_por: ANA },
      });
      expect(JSON.stringify(m.auditoria)).not.toContain(SENHA_ANA);
      expect(JSON.stringify(m.logs)).not.toContain(SENHA_ANA);
    });

    it('RN-INT-16: senha errada e conta bloqueada (com a senha certa) dão a mesma resposta 422', async () => {
      // premissa do cenário: o Core diz `bloqueado` para o Caio (senha certa, conta travada) e `incorreta` para a senha errada
      const core = consultaCredencialConferir as unknown as {
        executar: (e: unknown, c: unknown) => Promise<{ resultado: string }>;
      };
      const dbCore = { query: async (_s: string, p: unknown[]) => ({ rows: [usuarios[String(p[0])]] }) };
      expect(
        (await core.executar({ usuario_id: CAIO, senha: SENHA_CAIO }, { db: dbCore, agora: () => AGORA }))
          .resultado,
      ).toBe('bloqueado');
      expect(
        (await core.executar({ usuario_id: ANA, senha: 'senha-errada' }, { db: dbCore, agora: () => AGORA }))
          .resultado,
      ).toBe('incorreta');
      const m = montar(
        criarRotaReprocessarLote({
          verificarSenha: verificarSenhaAutorizador,
          limite: criarLimiteTentativas(),
        }),
      );
      const errada = resposta(await erroDe(m.pedir(ANA, 'senha-errada')));
      const bloqueado = resposta(await erroDe(m.pedir(CAIO, SENHA_CAIO)));
      expect(errada).toEqual({ status: 422, codigo: 'senha_incorreta', mensagem: 'Senha incorreta.' });
      expect(bloqueado).toEqual(errada);
      expect(m.updates).toHaveLength(0);
      expect(m.auditoria).toHaveLength(0);
    });

    it('RN-INT-16: 5 erros do mesmo autorizador → a 6ª tentativa dá 429 (até com a senha certa); outro autorizador segue normal', async () => {
      const m = montar(
        criarRotaReprocessarLote({
          verificarSenha: verificarSenhaAutorizador,
          limite: criarLimiteTentativas(),
        }),
      );
      for (let i = 1; i <= 5; i++)
        expect((await erroDe(m.pedir(ANA, `errada-${i}`))).status, `tentativa ${i}`).toBe(422);
      const sexta = await erroDe(m.pedir(ANA, SENHA_ANA));
      expect([sexta.status, sexta.codigo]).toEqual([429, 'muitas_tentativas']);
      // Bruno não é afetado: a senha errada dele ainda dá 422 e a certa reprocessa
      expect((await erroDe(m.pedir(BRUNO, 'errada'))).status).toBe(422);
      expect(await m.pedir(BRUNO, SENHA_BRUNO)).toMatchObject({ status: 'recebido' });
      expect(m.auditoria.map((a) => (a.depois as { autorizado_por: string }).autorizado_por)).toEqual([
        BRUNO,
      ]);
      const tudo = JSON.stringify([m.auditoria, m.logs]);
      for (const s of [SENHA_ANA, SENHA_BRUNO, 'errada-1']) expect(tudo).not.toContain(s);
    });

    it('RN-INT-16: conta bloqueada conta como tentativa (5 → 429)', async () => {
      const m = montar(
        criarRotaReprocessarLote({
          verificarSenha: verificarSenhaAutorizador,
          limite: criarLimiteTentativas(),
        }),
      );
      for (let i = 1; i <= 5; i++) expect((await erroDe(m.pedir(CAIO, SENHA_CAIO))).status).toBe(422);
      expect((await erroDe(m.pedir(CAIO, SENHA_CAIO))).status).toBe(429);
    });
  },
);

describe.runIf(!temArgon2)('T-0173 / RN-INT-16 (aviso)', () => {
  it.skip('pulado: este Node não tem crypto.argon2 (precisa de Node >= 24.7)', () => undefined);
});
