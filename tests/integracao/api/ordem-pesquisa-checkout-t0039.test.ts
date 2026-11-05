/**
 * T-0039 — investigação (agente `testes`, sem banco): no push do aparelho, a resposta da pesquisa (`resposta_pesquisa`)
 * chega ao servidor ANTES do checkout (`visita_checkout`) do Core? Pergunta do gerente-projetos antes de o Core ligar a
 * consulta `pesquisa.etapas_checkout@1` (modules/pesquisa/api/consulta-etapas-checkout.ts) no recebimento do checkout.
 *
 * Duas camadas, ambas com o MOTOR REAL do platform-sdk (`criarMotorSync`, fila FIFO persistida):
 *  A) aparelho → servidor simulado do SDK (`criarServidorSyncSimulado`): ordem dos LOTES e dos itens que saem do aparelho
 *     (offline com vários itens, falha de rede no 1º envio, rejeição da resposta, retentável, lote de 500, envio em
 *     curso, fotos na fila de arquivos);
 *  B) aparelho → API REAL (`createApp` de apps/api, rota `POST /v1/sync/push` de apps/api/src/sync.ts) por `inject`, com os
 *     manifestos e entidades reais dos 8 módulos e só o `receber` trocado por um gravador (ordem em que o servidor
 *     PROCESSA cada item). A rota corta o lote em trechos de itens CONSECUTIVOS do mesmo provedor e processa na ordem da
 *     fila (D-T0039a corrigido em 05/11: 4xx recusa só o trecho; 5xx volta 500 sem processar o resto e o motor reenvia).
 *
 * Como a Pesquisa e o Core põem na fila (só leitura): modules/pesquisa/app/state/use-pesquisa.ts `enviar` (fotos na fila
 * de arquivos, depois `enfileirar('resposta_pesquisa')`, depois `void motor.enviar()`); modules/core/app/lib/acoes-visita.ts
 * `fazerCheckin` (`visita`) e `fazerCheckout` (`visita_checkout`, foto da fachada na fila de arquivos depois). A etapa
 * obrigatória (RN-PES-03) só libera o checkout com a resposta já na fila, então a ordem de criação é resposta → checkout.
 *
 * Convenção: `it` = vale hoje; `it.fails` = defeito aberto (fica vermelho quando corrigir e vira `it`).
 */
import { manifest as manifestoCore } from '@macuxi/core/manifest';
import { ENTIDADES_PESQUISA } from '@macuxi/pesquisa/contracts';
import { manifest as manifestoPesquisa } from '@macuxi/pesquisa/manifest';
import {
  criarArmazenamentoEmMemoria,
  criarMotorSync,
  criarRegistroSync,
  criarServidorSyncSimulado,
  definirModuloApi,
  ErroRedeSimulada,
  type ItemPush,
  type ModuloApi,
  type ModuloId,
  type MotorSync,
  type ProvedorSync,
  type ResultadoItemPush,
  type TransporteSync,
  type UsuarioAutenticado,
} from '@macuxi/platform-sdk';
import { describe, expect, it } from 'vitest';
import { createApp } from '../../../apps/api/src/app';
import type { BancoApp } from '../../../apps/api/src/banco';
import { MODULOS_API } from '../../../apps/api/src/modulos';
import { entidadesRota } from '../../../modules/core/app/lib/entidades-rota';
import { montarCheckin, montarCheckout } from '../../../modules/core/app/lib/visita-payload';

const T0 = Date.parse('2026-11-05T13:00:00.000Z');
const MIN = 60_000;
const TENANT = '0a000000-0000-4000-8000-000000003901';
const VENDEDOR: UsuarioAutenticado = { id: '0b000000-0000-4000-8000-000000003901', tenant_id: TENANT, perfil: 'vendedor' };
const QUESTIONARIO = '0c000000-0000-4000-8000-000000003901';
const VERSAO = '0c000000-0000-4000-8000-000000003902';
const PERGUNTA = '0c000000-0000-4000-8000-000000003903';
const MOTIVO = '0d000000-0000-4000-8000-000000003901';

let seq = 0;
/** UUID v4 determinístico (o aparelho gera o seu; aqui basta ser único e válido). */
const uuid = (prefixo = 'e0') => `${prefixo}000000-0000-4000-8000-${(++seq).toString(16).padStart(12, '0')}`;

/** Registro do aparelho: as mesmas definições que o Core (entidades-rota) e a Pesquisa (contracts) registram no shell. */
function registroAparelho() {
  const registro = criarRegistroSync([manifestoCore, manifestoPesquisa]);
  for (const e of [...entidadesRota, ...ENTIDADES_PESQUISA]) registro.registrar(e);
  return registro;
}

type Relogio = { agora: number };

async function aparelho(transporte: TransporteSync, relogio: Relogio, extra: { fotos?: boolean } = {}) {
  const motor = criarMotorSync({
    registro: registroAparelho(),
    armazenamento: criarArmazenamentoEmMemoria(),
    transporte,
    agora: () => new Date(relogio.agora),
    ...(extra.fotos ? { arquivos: { ler: async () => new Uint8Array([0xff, 0xd8, 0xff]) } } : {}),
  });
  await motor.carregar();
  await motor.aplicarModulosAtivos(['core', 'pesquisa']);
  return motor;
}

/** O que `fazerCheckin` enfileira (id do item = id da visita). */
async function checkin(motor: MotorSync, relogio: Relogio, cliente: string): Promise<string> {
  const id = uuid('a1');
  const feito = montarCheckin({ id, cliente: { id: cliente, lat: null, lng: null }, agora: new Date(relogio.agora), posicao: null, extra: false });
  if (!feito.ok) throw new Error('check-in de teste recusado');
  await motor.enfileirar({ id, entidade: 'visita', payload: feito.payload, rotulo: 'Check-in' });
  relogio.agora += MIN;
  return id;
}

/** O que `use-pesquisa.enviar` enfileira: fotos na fila de arquivos (antes), depois a resposta ligada à visita. */
async function responder(motor: MotorSync, relogio: Relogio, cliente: string, visita: string, comFoto = false): Promise<{ id: string; foto: string | null }> {
  const id = uuid('b1');
  const foto = comFoto ? uuid('f1') : null;
  const itens = foto
    ? [{ pergunta_id: PERGUNTA, tipo: 'foto' as const, fotos: [{ id: foto, referencia: foto, capturada_em: new Date(relogio.agora).toISOString() }] }]
    : [{ pergunta_id: PERGUNTA, tipo: 'sim_nao' as const, valor: true }];
  if (foto) await motor.enfileirarArquivo({ id: foto, modulo: 'pesquisa', rotulo: 'Foto · Pesquisa' });
  await motor.enfileirar({
    id,
    entidade: 'resposta_pesquisa',
    payload: { id, questionario_id: QUESTIONARIO, versao_id: VERSAO, cliente_id: cliente, visita_id: visita, respondida_em: new Date(relogio.agora).toISOString(), itens },
    rotulo: 'Pesquisa',
  });
  relogio.agora += MIN;
  return { id, foto };
}

/** O que `fazerCheckout` enfileira (id do item = UUID do comando). */
async function checkout(motor: MotorSync, relogio: Relogio, visita: string): Promise<string> {
  const id = uuid('c1');
  const payload = montarCheckout({ id, visita_id: visita, agora: new Date(relogio.agora), posicao: null, resultado: 'sem_pedido', motivo_id: MOTIVO });
  await motor.enfileirar({ id, entidade: 'visita_checkout', payload, rotulo: 'Checkout sem pedido' });
  relogio.agora += MIN;
  return id;
}

/** Servidor simulado do SDK com o registro de cada chamada (lotes) e dos arquivos, na ordem de chegada. */
function servidorSimulado() {
  const s = criarServidorSyncSimulado(registroAparelho(), { modulosAtivos: ['core', 'pesquisa'] });
  const chegada: string[] = [];
  const lotes: string[][] = [];
  const push = s.push.bind(s);
  s.push = async (itens: ItemPush[]) => {
    lotes.push(itens.map((i) => i.id));
    const r = await push(itens);
    for (const x of r) if (x.status === 'aceito') chegada.push(x.id);
    return r;
  };
  s.enviarArquivo = async (a) => {
    chegada.push(`arquivo:${a.id}`);
    return { status: 'aceito' };
  };
  return { s, chegada, lotes };
}

const antes = (lista: readonly string[], a: string, b: string) => {
  expect(lista).toContain(a);
  expect(lista).toContain(b);
  return lista.indexOf(a) < lista.indexOf(b);
};

describe('T-0039 A — aparelho: ordem em que a fila sai (motor real + servidor simulado do SDK)', () => {
  it('offline com vários itens: um lote só, na ordem de criação (check-in → resposta → checkout)', async () => {
    const relogio = { agora: T0 };
    const { s, chegada, lotes } = servidorSimulado();
    s.online = false;
    const motor = await aparelho(s, relogio);
    const cliA = uuid('d1');
    const cliB = uuid('d1');
    const visA = await checkin(motor, relogio, cliA);
    const resA = await responder(motor, relogio, cliA, visA);
    const chkA = await checkout(motor, relogio, visA);
    const visB = await checkin(motor, relogio, cliB);
    const resB = await responder(motor, relogio, cliB, visB);
    const chkB = await checkout(motor, relogio, visB);
    await motor.enviar(); // sem sinal: o transporte falha e nada sai
    expect(motor.estado().fila.map((i) => i.id)).toEqual([visA, resA.id, chkA, visB, resB.id, chkB]);
    s.online = true;
    await motor.enviar();
    expect(lotes.at(-1)).toEqual([visA, resA.id, chkA, visB, resB.id, chkB]);
    expect(antes(chegada, resA.id, chkA)).toBe(true);
    expect(antes(chegada, resB.id, chkB)).toBe(true);
    expect(motor.estado().fila).toEqual([]);
  });

  it('falha de rede no 1º envio: conta a tentativa, para e reenvia o MESMO lote na mesma ordem', async () => {
    const relogio = { agora: T0 };
    const { s, chegada, lotes } = servidorSimulado();
    const motor = await aparelho(s, relogio);
    const cli = uuid('d1');
    const vis = await checkin(motor, relogio, cli);
    const res = await responder(motor, relogio, cli, vis);
    const chk = await checkout(motor, relogio, vis);
    const push = s.push.bind(s);
    let falhar = true;
    s.push = async (itens) => {
      if (falhar) {
        falhar = false;
        lotes.push(itens.map((i) => i.id));
        throw new ErroRedeSimulada();
      }
      return push(itens);
    };
    await motor.enviar();
    expect(motor.estado().fila.map((i) => [i.id, i.situacao, i.tentativas])).toEqual([
      [vis, 'pendente', 1],
      [res.id, 'pendente', 1],
      [chk, 'pendente', 1],
    ]);
    await motor.enviar();
    expect(lotes).toEqual([
      [vis, res.id, chk],
      [vis, res.id, chk],
    ]);
    expect(antes(chegada, res.id, chk)).toBe(true);
  });

  it('envio em curso quando o checkout entra na fila: o checkout espera o próximo envio (vai num lote DEPOIS da resposta)', async () => {
    const relogio = { agora: T0 };
    const { s, chegada, lotes } = servidorSimulado();
    const motor = await aparelho(s, relogio);
    const cli = uuid('d1');
    const vis = await checkin(motor, relogio, cli);
    await motor.enviar();
    const push = s.push.bind(s);
    let soltar: () => void = () => undefined;
    const portao = new Promise<void>((r) => (soltar = r));
    s.push = async (itens) => {
      await portao;
      return push(itens);
    };
    const res = await responder(motor, relogio, cli, vis);
    const envio = motor.enviar(); // o `void motor.enviar()` do use-pesquisa, rede lenta
    const chk = await checkout(motor, relogio, vis);
    expect(motor.enviar()).toBe(envio); // o `void motor.enviar()` do fazerCheckout recebe a mesma promessa
    soltar();
    await envio;
    expect(motor.estado().fila.map((i) => i.id)).toEqual([chk]);
    await motor.enviar();
    expect(lotes.slice(1)).toEqual([[res.id], [chk]]);
    expect(antes(chegada, res.id, chk)).toBe(true);
  });

  it('mais de 500 itens: resposta no fim de um lote e checkout no início do seguinte — lotes em sequência, ordem mantida', async () => {
    const relogio = { agora: T0 };
    const { s, chegada, lotes } = servidorSimulado();
    s.online = false;
    const motor = await aparelho(s, relogio);
    for (let i = 0; i < 498; i++) await checkin(motor, relogio, uuid('d2'));
    const cli = uuid('d1');
    const vis = await checkin(motor, relogio, cli); // 499º
    const res = await responder(motor, relogio, cli, vis); // 500º
    const chk = await checkout(motor, relogio, vis); // 501º
    s.online = true;
    await motor.enviar();
    expect(lotes.map((l) => l.length)).toEqual([500, 1]);
    expect(lotes[0]!.at(-1)).toBe(res.id);
    expect(lotes[1]).toEqual([chk]);
    expect(antes(chegada, res.id, chk)).toBe(true);
  });

  it('resposta REJEITADA pelo servidor (ex.: QUESTIONARIO_INEXISTENTE): vira `falhou` e NÃO segura o checkout, que é aceito sem a resposta', async () => {
    const relogio = { agora: T0 };
    const { s, chegada } = servidorSimulado();
    const motor = await aparelho(s, relogio);
    const cli = uuid('d1');
    s.online = false;
    const vis = await checkin(motor, relogio, cli);
    const res = await responder(motor, relogio, cli, vis);
    const chk = await checkout(motor, relogio, vis);
    s.online = true;
    s.rejeitar.set(res.id, { codigo: 'QUESTIONARIO_INEXISTENTE', mensagem: 'Esta pesquisa não existe mais. Atualize o app.' });
    await motor.enviar();
    expect(chegada).toContain(chk);
    expect(chegada).not.toContain(res.id);
    expect(motor.estado().fila.map((i) => [i.id, i.situacao])).toEqual([[res.id, 'falhou']]);
    // o usuário reenvia (incluirFalhos) e a resposta chega DEPOIS do checkout
    s.rejeitar.delete(res.id);
    await motor.enviar({ incluirFalhos: true });
    expect(antes(chegada, chk, res.id)).toBe(true);
  });

  it('resposta com código retentável (SYNC_NAO_IMPLEMENTADO, provedor ausente): continua `pendente` e o checkout passa à frente', async () => {
    const relogio = { agora: T0 };
    const { s, chegada } = servidorSimulado();
    const motor = await aparelho(s, relogio);
    const cli = uuid('d1');
    s.online = false;
    const vis = await checkin(motor, relogio, cli);
    const res = await responder(motor, relogio, cli, vis);
    const chk = await checkout(motor, relogio, vis);
    s.online = true;
    s.semReceptor.add('resposta_pesquisa');
    await motor.enviar();
    expect(chegada).toContain(chk);
    expect(motor.estado().fila.map((i) => [i.id, i.situacao, i.codigo])).toEqual([[res.id, 'pendente', 'SYNC_NAO_IMPLEMENTADO']]);
  });

  it('resposta com foto: o comando da resposta vai antes do checkout; os BYTES da foto (fila de arquivos) sobem só DEPOIS do checkout', async () => {
    const relogio = { agora: T0 };
    const { s, chegada } = servidorSimulado();
    s.online = false;
    const motor = await aparelho(s, relogio, { fotos: true });
    const cli = uuid('d1');
    const vis = await checkin(motor, relogio, cli);
    const res = await responder(motor, relogio, cli, vis, true);
    const chk = await checkout(motor, relogio, vis);
    s.online = true;
    await motor.enviar();
    expect(chegada).toEqual([vis, res.id, chk, `arquivo:${res.foto}`]);
  });
});

// ---------- B) API real: ordem em que a rota processa o lote ----------

/** API real com os manifestos/entidades dos 8 módulos; o `receber` de cada provedor só grava a ordem de processamento. */
function apiGravadora() {
  const token = 'token-t0039';
  const processados: string[] = [];
  const falharPesquisa = { vezes: 0 };
  const modulos: ModuloApi[] = MODULOS_API.map((m) => {
    const sync: ProvedorSync[] = (m.sync ?? []).map((p) => ({
      entidade: p.entidade,
      ...(p.escopo ? { escopo: p.escopo } : {}),
      ...(p.puxar ? { puxar: async () => [] } : {}),
      ...(p.receber
        ? {
            receber: async (_ctx, itens: ItemPush[]): Promise<ResultadoItemPush[]> => {
              if (p.entidade.nome === 'resposta_pesquisa' && falharPesquisa.vezes > 0) {
                falharPesquisa.vezes--;
                throw new Error('falha transitória do banco'); // vira 500: o motor tenta o lote de novo
              }
              for (const i of itens) processados.push(`${p.entidade.nome}:${i.id}`);
              return itens.map((i) => ({ id: i.id, status: 'aceito' as const }));
            },
          }
        : {}),
    }));
    return definirModuloApi({ manifesto: m.manifesto, sync });
  });
  const todos = MODULOS_API.map((m) => m.manifesto.id) as ModuloId[];
  const banco: BancoApp = {
    verificar: async () => undefined,
    comTenant: async (_t, fn) => fn({ query: async () => ({ rows: [], rowCount: 0 }) } as never),
    semTenant: async (fn) => fn({ query: async () => ({ rows: [], rowCount: 0 }) } as never),
    horizonteSync: async () => new Date(T0 - 2_000),
    instanteSync: async () => new Date(T0),
    resumoOutbox: async () => ({ pendentes: 0, parados: 0, mais_antigo_s: null }),
  };
  const app = createApp({
    modulos,
    banco,
    logger: false,
    autenticar: async (h) => (h.authorization === `Bearer ${token}` ? VENDEDOR : null),
    licencas: async () => ({ ativosNoTenant: todos, doPerfil: todos, removidosDoUsuario: [], parametros: {} }),
    carteira: async () => new Set<string>(),
    usuariosVisiveis: async (u) => new Set([u.id]),
  });
  const rede = { online: true };
  const transporte: TransporteSync = {
    async push(itens) {
      if (!rede.online) throw new Error('Sem conexão com o servidor.');
      const r = await app.inject({ method: 'POST', url: '/v1/sync/push', headers: { authorization: `Bearer ${token}` }, payload: { itens } });
      if (r.statusCode >= 500) throw new Error(`HTTP ${r.statusCode}`);
      if (r.statusCode !== 200) throw new Error(`HTTP ${r.statusCode}: ${r.body}`);
      return (r.json() as { resultados: ResultadoItemPush[] }).resultados;
    },
    async pull() {
      throw new Error('pull fora do escopo deste teste');
    },
  };
  return { app, processados, falharPesquisa, rede, transporte };
}

const chave = (entidade: string, id: string) => `${entidade}:${id}`;

describe('T-0039 B — API real: ordem em que POST /v1/sync/push processa o lote (motor real → createApp por inject)', () => {
  it('lote de UMA visita offline [check-in, resposta, checkout]: a resposta é processada antes do checkout', async () => {
    const relogio = { agora: T0 };
    const api = apiGravadora();
    api.rede.online = false;
    const motor = await aparelho(api.transporte, relogio);
    const cli = uuid('d1');
    const vis = await checkin(motor, relogio, cli);
    const res = await responder(motor, relogio, cli, vis);
    const chk = await checkout(motor, relogio, vis);
    api.rede.online = true;
    await motor.enviar();
    expect(api.processados).toEqual([chave('visita', vis), chave('resposta_pesquisa', res.id), chave('visita_checkout', chk)]);
    await api.app.close();
  });

  it('500 no grupo da Pesquisa no 1º envio: nada do checkout é processado; o reenvio do mesmo lote mantém resposta → checkout', async () => {
    const relogio = { agora: T0 };
    const api = apiGravadora();
    api.rede.online = false;
    const motor = await aparelho(api.transporte, relogio);
    const cli = uuid('d1');
    const vis = await checkin(motor, relogio, cli);
    const res = await responder(motor, relogio, cli, vis);
    const chk = await checkout(motor, relogio, vis);
    api.rede.online = true;
    api.falharPesquisa.vezes = 1;
    await motor.enviar();
    expect(motor.estado().fila.map((i) => i.tentativas)).toEqual([1, 1, 1]);
    expect(api.processados).not.toContain(chave('visita_checkout', chk));
    await motor.enviar();
    const depois = api.processados.slice(api.processados.indexOf(chave('visita', vis), 1));
    expect(antes(depois, chave('resposta_pesquisa', res.id), chave('visita_checkout', chk))).toBe(true);
    await api.app.close();
  });

  it('lote com DUAS visitas offline (A sem pesquisa, B com): a rota processa na ordem exata da fila (trechos consecutivos por provedor)', async () => {
    const relogio = { agora: T0 };
    const api = apiGravadora();
    api.rede.online = false;
    const motor = await aparelho(api.transporte, relogio);
    const cliA = uuid('d1');
    const cliB = uuid('d1');
    const visA = await checkin(motor, relogio, cliA);
    const chkA = await checkout(motor, relogio, visA); // visita A sem pesquisa obrigatória
    const visB = await checkin(motor, relogio, cliB);
    const resB = await responder(motor, relogio, cliB, visB);
    const chkB = await checkout(motor, relogio, visB);
    api.rede.online = true;
    await motor.enviar();
    // a fila saiu em ordem e o servidor mantém a ordem (antes do D-T0039a: visita A, visita B, checkout A, checkout B, resposta B)
    expect(api.processados).toEqual([
      chave('visita', visA),
      chave('visita_checkout', chkA),
      chave('visita', visB),
      chave('resposta_pesquisa', resB.id),
      chave('visita_checkout', chkB),
    ]);
    await api.app.close();
  });

  it('D-T0039a: o servidor processa o lote na ordem da fila (resposta de B antes do checkout de B mesmo com o checkout de A antes no lote)', async () => {
    const relogio = { agora: T0 };
    const api = apiGravadora();
    api.rede.online = false;
    const motor = await aparelho(api.transporte, relogio);
    const cliA = uuid('d1');
    const cliB = uuid('d1');
    const visA = await checkin(motor, relogio, cliA);
    await checkout(motor, relogio, visA);
    const visB = await checkin(motor, relogio, cliB);
    const resB = await responder(motor, relogio, cliB, visB);
    const chkB = await checkout(motor, relogio, visB);
    api.rede.online = true;
    await motor.enviar();
    expect(antes(api.processados, chave('resposta_pesquisa', resB.id), chave('visita_checkout', chkB))).toBe(true);
    await api.app.close();
  });
});
