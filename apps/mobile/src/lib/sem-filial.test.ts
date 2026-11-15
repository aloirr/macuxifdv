/**
 * T-0176 (RN-CORE-39; ADR 0056; tela 13 da spec docs/design/filial-cadastro-venda §4): usuário sem filial de cadastro no app.
 * - o 403 `USUARIO_SEM_FILIAL` no meio da sessão sai UMA vez, depois da sincronização em curso, sem apagar nada;
 * - a fila offline fica pendente: o push recusado com 403 não vira "falhou" e segue quando a filial for informada.
 */
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { comPrefixo, criarMotorSync, criarRegistroSync, defineModule, definirEntidadeSync, type ArmazenamentoSync } from '@macuxi/platform-sdk';

import { HttpError, type ApiClient } from '@/services/api';
import { transporteV1 } from '@/services/transporte';

import { criarTratadorSemFilial, type FontesSemFilial } from './sem-filial';

const PEDIDO = '0e000000-0000-4000-8000-000000000001';

function fontes(sessao = true) {
  const ordem: string[] = [];
  let soltarSync: () => void = () => undefined;
  const sync = new Promise<void>((r) => (soltarSync = r));
  const f: FontesSemFilial = {
    temSessao: () => sessao,
    email: () => 'carla@distnorte.com.br',
    esperarSync: () => sync.then(() => void ordem.push('sync terminou')),
    sair: vi.fn(async () => void ordem.push('sair')),
    avisar: vi.fn((email: string | null) => void ordem.push(`avisar ${email}`)),
    irParaLogin: vi.fn(() => void ordem.push('login')),
  };
  return { f, ordem, soltarSync };
}

describe('403 USUARIO_SEM_FILIAL no meio da sessão', () => {
  it('avisa com o e-mail, espera a sincronização em curso, sai e vai ao login — uma vez para várias chamadas', async () => {
    const { f, ordem, soltarSync } = fontes();
    const tratar = criarTratadorSemFilial(f);
    const erro = new HttpError(403, 'USUARIO_SEM_FILIAL', 'x');
    const a = tratar(erro);
    const b = tratar(erro);
    await Promise.resolve();
    expect(ordem).toEqual(['avisar carla@distnorte.com.br']);
    soltarSync();
    await expect(Promise.all([a, b])).resolves.toEqual([true, true]);
    expect(ordem).toEqual(['avisar carla@distnorte.com.br', 'sync terminou', 'sair', 'login']);
    expect(f.sair).toHaveBeenCalledTimes(1);
  });

  it('outro erro não toca em nada', async () => {
    const { f } = fontes();
    await expect(criarTratadorSemFilial(f)(new HttpError(403, 'MODULO_INATIVO', 'x'))).resolves.toBe(false);
    expect(f.avisar).not.toHaveBeenCalled();
    expect(f.sair).not.toHaveBeenCalled();
  });

  it('sem sessão (chamada que sobrou depois de sair): nada a fazer', async () => {
    const { f } = fontes(false);
    await expect(criarTratadorSemFilial(f)(new HttpError(403, 'USUARIO_SEM_FILIAL', 'x'))).resolves.toBe(true);
    expect(f.sair).not.toHaveBeenCalled();
  });
});

describe('fila offline preservada (ADR 0056: o push do bloqueado recebe 403 no lote inteiro)', () => {
  function disco(): { dados: Map<string, string>; armazenamento: ArmazenamentoSync } {
    const dados = new Map<string, string>();
    const base: ArmazenamentoSync = {
      ler: async <T,>(c: string) => (dados.has(c) ? (JSON.parse(dados.get(c)!) as T) : null),
      gravar: async (c, v) => void (v === null || v === undefined ? dados.delete(c) : dados.set(c, JSON.stringify(v))),
      remover: async (c) => void dados.delete(c),
      chaves: async (p) => [...dados.keys()].filter((k) => k.startsWith(p)).sort(),
    };
    return { dados, armazenamento: comPrefixo(base, 'macuxi:u:carla:') };
  }

  async function motorCom(push: () => Promise<unknown>) {
    const registro = criarRegistroSync([defineModule({ id: 'core', versao: '1.0.0', perfis: ['vendedor'], sync: ['pedido'] })]);
    registro.registrar(definirEntidadeSync({ nome: 'pedido', modulo: 'core', direcao: 'push', conflito: 'somente_insercao', schema: z.object({ total_centavos: z.number() }) }));
    const api = { request: push } as unknown as ApiClient;
    const d = disco();
    const motor = criarMotorSync({ registro, armazenamento: d.armazenamento, transporte: transporteV1(() => api, async () => undefined), online: () => true });
    await motor.carregar();
    await motor.aplicarModulosAtivos(['core']);
    await motor.enfileirar({ id: PEDIDO, entidade: 'pedido', payload: { total_centavos: 12_345 } });
    return { motor, d };
  }

  it('403 USUARIO_SEM_FILIAL: o pedido continua pendente (nem "falhou", nem apagado) e vai quando a filial for informada', async () => {
    let bloqueado = true;
    const { motor, d } = await motorCom(async () => {
      if (bloqueado) throw new HttpError(403, 'USUARIO_SEM_FILIAL', 'x');
      return { status: 200, data: { resultados: [{ id: PEDIDO, status: 'aceito' }] } };
    });
    await motor.enviar({ incluirFalhos: true }).catch(() => undefined);
    expect(motor.estado().fila).toMatchObject([{ id: PEDIDO, situacao: 'pendente' }]);
    expect([...d.dados.keys()].some((k) => k.includes('fila'))).toBe(true);

    // o motor reabre do disco (o "Sair" fechou o arquivo; o próximo login reabre o mesmo): a fila está lá
    bloqueado = false;
    await motor.carregar();
    expect(motor.estado().fila).toMatchObject([{ id: PEDIDO, situacao: 'pendente' }]);
    await motor.enviar();
    expect(motor.estado().fila).toEqual([]);
  });

  it('comparação: outro 403 no lote (ex.: PERFIL_SEM_ACESSO) continua virando rejeição do item', async () => {
    const { motor } = await motorCom(async () => {
      throw new HttpError(403, 'PERFIL_SEM_ACESSO', 'x');
    });
    await motor.enviar().catch(() => undefined);
    expect(motor.estado().fila).toMatchObject([{ id: PEDIDO, situacao: 'falhou', codigo: 'PERFIL_SEM_ACESSO' }]);
  });
});
