import { z } from 'zod';
import { describe, expect, it } from 'vitest';
import { ambienteIndisponivel, criarClienteHttp, ehErroDeCliente, ehSemConexao, ErroHttp, ErroSemConexao, type AmbienteAparelho, type MetodoHttp, type OpcoesHttp } from './ambiente';
import { defineModule } from './manifesto';
import { criarArmazenamentoEmMemoria, criarMotorSync, type ContextoEtapaSync } from './motor-sync';
import { criarServidorSyncSimulado } from './sync-simulado';
import { criarRegistroSync, definirEntidadeSync } from './sync';

function transporteGravando() {
  const chamadas: { metodo: MetodoHttp; caminho: string; opcoes: OpcoesHttp }[] = [];
  const requisitar = async <T,>(metodo: MetodoHttp, caminho: string, opcoes: OpcoesHttp): Promise<T> => {
    chamadas.push({ metodo, caminho, opcoes });
    return { ok: caminho } as T;
  };
  return { chamadas, requisitar };
}

describe('ambiente do aparelho (ctx.http)', () => {
  it('get e requisitar passam pelo transporte do shell com query, corpo e cabeçalhos', async () => {
    const t = transporteGravando();
    const http = criarClienteHttp(t.requisitar);
    await expect(http.get('/customers', { limit: 5000 })).resolves.toEqual({ ok: '/customers' });
    await http.requisitar('PUT', '/orders/1', { body: { a: 1 }, headers: { 'Idempotency-Key': 'k' } });
    expect(t.chamadas).toEqual([
      { metodo: 'GET', caminho: '/customers', opcoes: { query: { limit: 5000 } } },
      { metodo: 'PUT', caminho: '/orders/1', opcoes: { body: { a: 1 }, headers: { 'Idempotency-Key': 'k' } } },
    ]);
    await expect(http.get('customers')).rejects.toThrow(/começar com "\/"/);
  });

  it('modo sem sinal: nada sai do aparelho e o erro é ErroSemConexao', async () => {
    const t = transporteGravando();
    let online = false;
    const http = criarClienteHttp(t.requisitar, { online: () => online });
    const erro = await http.get('/me').catch((e: unknown) => e);
    expect(erro).toBeInstanceOf(ErroSemConexao);
    expect(ehSemConexao(erro)).toBe(true);
    expect(t.chamadas).toHaveLength(0);
    online = true;
    await http.get('/me');
    expect(t.chamadas).toHaveLength(1);
  });

  it('erros: 4xx é erro de cliente (carga segue vazia); sem conexão não é', () => {
    expect(ehErroDeCliente(new ErroHttp(404, 'not_found', 'Sem rota hoje'))).toBe(true);
    expect(ehErroDeCliente(new ErroHttp(503, 'file_locked', 'Planilha aberta'))).toBe(false);
    expect(ehErroDeCliente(new ErroSemConexao())).toBe(false);
  });

  it('ambiente indisponível (antes do login): offline e http falha em português, sem rede', async () => {
    const a = ambienteIndisponivel();
    expect(a.online()).toBe(false);
    expect(a.usuario()).toBeNull();
    await expect(a.http.get('/me')).rejects.toBeInstanceOf(ErroSemConexao);
    expect(a.novoId()).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('as etapas de sync recebem http, sinal, UUID e usuário do ambiente; o motor expõe o mesmo ambiente às telas', async () => {
    const manifestos = [defineModule({ id: 'core', versao: '1.0.0', perfis: ['vendedor'], sync: ['cliente'] })];
    const registro = criarRegistroSync(manifestos);
    registro.registrar(definirEntidadeSync({ nome: 'cliente', modulo: 'core', direcao: 'pull', conflito: 'servidor_vence', schema: z.object({}) }));
    const t = transporteGravando();
    const ambiente: AmbienteAparelho = {
      http: criarClienteHttp(t.requisitar),
      online: () => true,
      novoId: () => '00000000-0000-4000-8000-000000000001',
      usuario: () => ({ id: 'u1', nome: 'Rafael Souza', perfil: 'vendedor' }),
    };
    let visto: ContextoEtapaSync | null = null;
    const motor = criarMotorSync({
      registro,
      armazenamento: criarArmazenamentoEmMemoria(),
      transporte: criarServidorSyncSimulado(registro, { modulosAtivos: ['core'] }),
      ambiente,
      etapas: [
        {
          id: 'clientes',
          rotulo: 'Clientes',
          modulo: 'core',
          executar: async (ctx) => {
            visto = ctx;
            await ctx.armazenamento.gravar('clientes', await ctx.http.get('/customers', { limit: 10 }));
          },
        },
      ],
    });
    await motor.aplicarModulosAtivos(['core']);
    expect(await motor.sincronizar()).toBe(true);
    const ctx = visto as ContextoEtapaSync | null;
    expect(ctx?.online()).toBe(true);
    expect(ctx?.novoId()).toBe('00000000-0000-4000-8000-000000000001');
    expect(ctx?.usuario()?.nome).toBe('Rafael Souza');
    expect(t.chamadas.map((c) => c.caminho)).toEqual(['/customers']);
    expect(await motor.armazenamentoDoModulo('core').ler('clientes')).toEqual({ ok: '/customers' });
    // o motor completa o ambiente do shell (consultar e parametros, T-0029 E1/E3) sem trocar o resto
    expect(motor.ambiente).toMatchObject({ http: ambiente.http, online: ambiente.online, novoId: ambiente.novoId, usuario: ambiente.usuario });
    expect(typeof motor.ambiente.consultar).toBe('function');
    expect(motor.ambiente.parametros('core')).toEqual({});
    expect(motor.http).toBe(ambiente.http);
  });

  it('motor sem ambiente: a etapa que usa http falha com mensagem e o sync registra o erro (nada some)', async () => {
    const manifestos = [defineModule({ id: 'core', versao: '1.0.0', perfis: ['vendedor'] })];
    const registro = criarRegistroSync(manifestos);
    const motor = criarMotorSync({
      registro,
      armazenamento: criarArmazenamentoEmMemoria(),
      transporte: criarServidorSyncSimulado(registro, { modulosAtivos: ['core'] }),
      etapas: [{ id: 'x', rotulo: 'X', modulo: 'core', executar: async (ctx) => void (await ctx.http.get('/me')) }],
    });
    await motor.aplicarModulosAtivos(['core']);
    expect(await motor.sincronizar()).toBe(false);
    expect(motor.estado().erro).toMatch(/ainda não está conectado/);
  });
});
