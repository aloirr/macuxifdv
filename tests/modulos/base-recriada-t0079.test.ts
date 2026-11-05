/**
 * T-0079 (ADR 0021) — base do tenant recriada, ponta a ponta no APARELHO, sem banco: o MOTOR DE SYNC real do platform-sdk
 * (`criarMotorSync`, com o armazenamento chave→JSON e com o adaptador SQLite real sobre node:sqlite em memória), as
 * entidades REAIS do Core (`entidadesCliente`) e do Vendedor (`ENTIDADES_VENDEDOR`, push validado pelo `PedidoPush`), as
 * etapas REAIS do Vendedor (`etapasVendedor`, com `aoTrocarGeracao` = `apagarCopiaDoServidor`) e o repositório REAL do
 * Vendedor (`criarRepositorio`: exibições, rascunhos e `podarExibicoesOrfas`, com os itens montados como o use-vendedor).
 * O servidor é o `criarServidorSyncSimulado` do SDK (mesmo envelope da API: `geracao_base` em toda página e nas
 * novidades), com um "banco" por tenant e o número do pedido gerado no servidor (sequência que volta ao 11 no `--recriar`).
 *
 * Critério 4 da T-0079: geração igual → nada muda; diferente → a fila de pedidos/orçamentos é reenviada ANTES da limpeza,
 * a cópia local some (inclusive as exibições órfãs) e a fila sobrevive; app antigo sem `geracao_base` → nada quebra;
 * dois tenants isolados. A parte com a API real e o Postgres (girar_geracao_base da 0022) é a matriz D-6..D-9 de
 * docs/testes/T-0079.md (pendente de banco).
 */
import { manifest as catalogo } from '@macuxi/catalogo/manifest';
import type { ClienteSync } from '@macuxi/core/contracts';
import { manifest as core } from '@macuxi/core/manifest';
import {
  ambienteIndisponivel,
  criarArmazenamentoEmMemoria,
  criarArmazenamentoSqlite,
  criarMotorSync,
  criarRegistroSync,
  criarServidorSyncSimulado,
  NovidadesRespostaSchema,
  type AmbienteAparelho,
  type ArmazenamentoSync,
  type ServidorSyncSimulado,
  type TransporteSync,
} from '@macuxi/platform-sdk';
import { criarDriverNode } from '@macuxi/platform-sdk/sqlite-node';
import type { PedidoPush, PedidoSync } from '@macuxi/vendedor/contracts';
import { manifest as vendedor } from '@macuxi/vendedor/manifest';
import { describe, expect, it } from 'vitest';
import { entidadesCliente } from '../../modules/core/app/lib/entidades-cliente';
import { etapasVendedor } from '../../modules/vendedor/app/etapas';
import { criarRepositorio } from '../../modules/vendedor/app/lib/repositorio';
import type { OrderDisplay } from '../../modules/vendedor/app/lib/pedidos';
import { lerLinhas, listaDePedidos } from '../../modules/vendedor/app/lib/pull';
import { ENTIDADES_VENDEDOR } from '../../modules/vendedor/contracts/entidades';

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const T0 = Date.parse('2026-11-04T12:00:00.000Z');
const MIN = 60_000;
const MANAUS = 'America/Manaus';
const G = { a1: 'aaaaaaaa-0000-4000-8000-000000000001', a2: 'aaaaaaaa-0000-4000-8000-000000000002', b1: 'bbbbbbbb-0000-4000-8000-000000000001' };
const CLI = { atacadinho: U(101), padaria: U(102) };
const PRODUTO = U(201);
const VENDEDOR = U(1);

const FABRICAS: ReadonlyArray<readonly [string, () => ArmazenamentoSync]> = [
  ['chave→JSON', () => criarArmazenamentoEmMemoria()],
  ['SQLite em memória (node:sqlite)', () => criarArmazenamentoSqlite(criarDriverNode(':memory:'))],
];

const iso = (ms: number) => new Date(ms).toISOString();
const baseLinha = (em: number) => ({ created_at: iso(em), updated_at: iso(em), deleted_at: null, external_id: null });

function pedidoSync(o: { id: string; numero: string; cliente_id: string; cliente_nome: string; em: number; tipo?: 'pedido' | 'orcamento' }): PedidoSync {
  return {
    ...baseLinha(o.em),
    id: o.id,
    cliente_id: o.cliente_id,
    vendedor_id: VENDEDOR,
    autor_id: VENDEDOR,
    status: 'approved',
    condicao_pagamento: null,
    desconto_pct: 0,
    total_tabela_cents: 10_000,
    total_cents: 10_000,
    observacao: null,
    visita_id: null,
    rota_parada_id: null,
    criado_no_aparelho_em: null,
    recebido_em: iso(o.em),
    numero_erp: null,
    motivo_cancelamento: null,
    numero: o.numero,
    cliente_nome: o.cliente_nome,
    vendedor_nome: 'Lucas Andrade',
    condicao_pagamento_descricao: 'À vista',
    nivel_aprovacao: null,
    motivos_aprovacao: [],
    tipo: o.tipo ?? 'pedido',
  } as PedidoSync;
}

const clienteSync = (id: string, fantasia: string, em: number): ClienteSync =>
  ({ ...baseLinha(em), id, documento: null, razao_social: `${fantasia} Ltda`, nome_fantasia: fantasia, segmento: null, telefone: null, email: null, logradouro: null, numero: null, bairro: null, cidade: 'Manaus', uf: 'AM', cep: null, latitude: null, longitude: null, ativo: true }) as ClienteSync;

const payload = (id: string, cliente: string, tipo: 'pedido' | 'orcamento' = 'pedido'): PedidoPush =>
  ({ id, customer_id: cliente, discount_pct: 0, payment_terms: 'À vista', items: [{ product_id: PRODUTO, quantity: 2 }], tipo }) as PedidoPush;

const exibicao = (cliente: string): OrderDisplay => ({ customer_name: cliente, subtotal_cents: 2_000, discount_cents: 0, total_cents: 2_000, items_count: 1, units: 2, lines: [], expected: 'ok', notes: [] });

/**
 * "Banco" de um tenant: servidor simulado do SDK com o número legível gerado no servidor. `recriar()` = `seed demo --recriar`
 * (girar_geracao_base + base nova: o contador volta e o p05 do seed ganha de novo o 000011, R-20261104-195513).
 */
function tenant(geracao: string, relogio: () => number) {
  const registro = criarRegistroSync([core, catalogo, vendedor]);
  for (const e of [...entidadesCliente, ...ENTIDADES_VENDEDOR]) if (!registro.entidade(e.nome)) registro.registrar(e);
  const s: ServidorSyncSimulado = criarServidorSyncSimulado(registro, { modulosAtivos: ['core', 'catalogo', 'vendedor'], comNovidades: true });
  s.relogio = () => new Date(relogio());
  s.geracao_base = geracao;
  let seq = 0;
  const numero = () => String(++seq).padStart(6, '0');
  const semear = () => {
    seq = 0;
    const em = relogio() - 60 * MIN;
    s.linhas = {
      cliente: [clienteSync(CLI.atacadinho, 'Atacadinho', em), clienteSync(CLI.padaria, 'Padaria Pão Quente', em)],
      pedido: Array.from({ length: 10 }, (_x, i) => pedidoSync({ id: U(1000 + i), numero: numero(), cliente_id: CLI.atacadinho, cliente_nome: 'Atacadinho', em: em + i })),
    };
  };
  semear();
  const pushOriginal = s.push.bind(s);
  /** Ordem das chamadas do lado do servidor (push com os ids, pull por entidade), para provar "reenvia antes de limpar". */
  const log: string[] = [];
  s.push = async (itens) => {
    log.push(`push:${itens.map((i) => i.id).join(',')}`);
    const r = await pushOriginal(itens);
    for (const x of r) {
      if (x.status !== 'aceito') continue;
      if ((s.linhas.pedido ?? []).some((l) => l.id === x.id)) continue; // idempotente: o mesmo UUID não ganha outro número
      const it = itens.find((i) => i.id === x.id)!;
      const p = it.payload as PedidoPush;
      s.linhas.pedido!.push(pedidoSync({ id: it.id, numero: numero(), cliente_id: p.customer_id, cliente_nome: p.customer_id === CLI.padaria ? 'Padaria Pão Quente' : 'Atacadinho', em: relogio(), tipo: p.tipo }));
    }
    return r;
  };
  const pull = s.pull.bind(s);
  s.pull = async (entidade, cursor) => {
    log.push(`pull:${entidade}`);
    return pull(entidade, cursor);
  };
  const recriar = (nova: string) => {
    s.geracao_base = nova;
    s.recebidos.clear();
    semear();
    for (const l of s.linhas.pedido! as PedidoSync[]) l.updated_at = l.created_at = iso(relogio() - 5 * MIN);
  };
  return { servidor: s, log, recriar };
}

async function aparelho(fabrica: () => ArmazenamentoSync, transporte: TransporteSync, relogio: () => number, rede = { online: true }) {
  const registro = criarRegistroSync([core, catalogo, vendedor]);
  for (const e of [...entidadesCliente, ...ENTIDADES_VENDEDOR]) if (!registro.entidade(e.nome)) registro.registrar(e);
  // API v1: o login traz o fuso, então as cargas REST da Fase M não rodam (soNaDemonstracao); o aoTrocarGeracao roda sempre
  const ambiente: AmbienteAparelho = { ...ambienteIndisponivel(), online: () => rede.online, usuario: () => ({ id: VENDEDOR, nome: 'Lucas Andrade', perfil: 'vendedor', fuso: MANAUS }) };
  const armazenamento = fabrica();
  const motor = criarMotorSync({ registro, armazenamento, transporte, ambiente, etapas: etapasVendedor, online: () => rede.online, agora: () => new Date(relogio()) });
  await motor.carregar();
  await motor.aplicarModulosAtivos(['core', 'catalogo', 'vendedor']);
  const repo = criarRepositorio(motor.armazenamentoDoModulo('vendedor'));
  /** Os números que a lista de Pedidos mostra (mesmas funções da tela na API v1). */
  const numeros = async () => listaDePedidos(await lerLinhas(motor), {}).map((o) => o.number).sort();
  /** O efeito do use-vendedor (T-0079 / V2): fila + aceitos do Vendedor → poda das exibições órfãs. */
  const podar = async () => {
    const e = motor.estado();
    const itens = [...e.fila, ...e.aceitos].filter((i) => i.modulo === 'vendedor').map((i) => ({ id: i.id, entidade: i.entidade, situacao: 'pendente' as const }));
    return repo.podarExibicoesOrfas(itens);
  };
  return { motor, armazenamento, repo, numeros, podar, rede };
}

describe.each(FABRICAS)('T-0079 — base recriada no aparelho [%s] (ADR 0021)', (_nome, fabrica) => {
  function montar() {
    let agora = T0;
    const relogio = () => agora;
    const a = tenant(G.a1, relogio);
    return { a, relogio, avancar: (ms: number) => (agora += ms) };
  }

  it('D-1 geração igual: adota na primeira e depois é o pull incremental de sempre (nada apagado, cache do Vendedor intacto)', async () => {
    const { a, relogio, avancar } = montar();
    const ap = await aparelho(fabrica, a.servidor, relogio);
    expect(await ap.motor.sincronizar(), ap.motor.estado().erro ?? '').toBe(true);
    expect(await ap.armazenamento.ler('sync:geracao_base')).toBe(G.a1);
    expect(await ap.numeros()).toHaveLength(10);
    await ap.repo.guardarExibicao(U(9001), exibicao('Atacadinho'));
    await ap.repo.gravar('rascunhos', { [CLI.atacadinho]: { cliente: CLI.atacadinho } as never });

    avancar(10 * MIN);
    a.servidor.linhas.pedido!.push(pedidoSync({ id: U(1100), numero: '000011', cliente_id: CLI.padaria, cliente_nome: 'Padaria Pão Quente', em: relogio() - 5 * MIN }));
    a.log.length = 0;
    expect(await ap.motor.sincronizar(), ap.motor.estado().erro ?? '').toBe(true);
    expect(await ap.numeros()).toEqual(Array.from({ length: 11 }, (_x, i) => String(i + 1).padStart(6, '0')));
    // incremental: uma página por entidade, sem segunda passada completa
    expect(a.log.filter((l) => l === 'pull:pedido')).toHaveLength(1);
    expect(await ap.repo.ler('exibicoes')).toHaveProperty(U(9001));
    expect(await ap.repo.ler('rascunhos')).toHaveProperty(CLI.atacadinho);
    expect(await ap.podar()).toBe(false); // sem troca não há marcador: nada é podado

    // a atualização leve (novidades) com a mesma geração também não mexe em nada
    avancar(30 * MIN);
    expect(await ap.motor.sincronizarNovidades(), ap.motor.estado().erro ?? '').toBe(true);
    expect(await ap.numeros()).toHaveLength(11);
    expect(await ap.armazenamento.ler('sync:geracao_base')).toBe(G.a1);
  });

  it('D-2 geração diferente: pedido E orçamento feitos sem sinal são reenviados ANTES da limpeza, o fantasma 000011 some e nenhum número repete', async () => {
    const { a, relogio, avancar } = montar();
    const ap = await aparelho(fabrica, a.servidor, relogio);
    await ap.motor.sincronizar();
    // o pedido do aparelho de 02/11 ganhou 000011 na base antiga
    await ap.motor.enfileirar({ id: U(5011), entidade: 'pedido', payload: payload(U(5011), CLI.atacadinho), rotulo: 'Pedido · Atacadinho' });
    await ap.repo.guardarExibicao(U(5011), exibicao('Atacadinho'));
    await ap.motor.enviar();
    avancar(MIN);
    await ap.motor.sincronizar();
    expect(await ap.numeros()).toContain('000011');
    expect(ap.motor.estado().aceitos).toHaveLength(0);

    // sem sinal: um pedido e um orçamento novos ficam na fila
    ap.rede.online = false;
    await ap.motor.enfileirar({ id: U(5012), entidade: 'pedido', payload: payload(U(5012), CLI.padaria), rotulo: 'Pedido · Padaria Pão Quente' });
    await ap.motor.enfileirar({ id: U(5013), entidade: 'pedido', payload: payload(U(5013), CLI.atacadinho, 'orcamento'), rotulo: 'Orçamento · Atacadinho' });
    await ap.repo.guardarExibicao(U(5012), exibicao('Padaria Pão Quente'));
    await ap.repo.guardarExibicao(U(5013), exibicao('Atacadinho'));
    await ap.repo.gravar('rascunhos', { [CLI.padaria]: { cliente: CLI.padaria } as never });

    // `seed demo --recriar` enquanto o aparelho estava sem sinal
    a.recriar(G.a2);
    avancar(MIN);
    ap.rede.online = true;
    a.log.length = 0;
    const fantasmaNoReenvio: boolean[] = [];
    const pushDoTenant = a.servidor.push;
    a.servidor.push = async (itens) => {
      fantasmaNoReenvio.push((await ap.motor.linhas('pedido')).some((l) => l.id === U(5011)));
      return pushDoTenant(itens);
    };
    expect(await ap.motor.sincronizar(), ap.motor.estado().erro ?? '').toBe(true);

    // a fila chegou à base nova (ADR 0021 §5.2)
    expect(a.servidor.recebidos.has(U(5012))).toBe(true);
    expect(a.servidor.recebidos.has(U(5013))).toBe(true);
    expect(ap.motor.estado().fila).toHaveLength(0);
    expect(await ap.armazenamento.ler('sync:geracao_base')).toBe(G.a2);
    // ordem no servidor: envio normal → 1ª página (percebe a troca) → REENVIO da fila → passada completa do zero
    const envio = `push:${U(5012)},${U(5013)}`;
    expect(a.log.slice(0, 3)).toEqual([envio, 'pull:carteira', envio]);
    expect(a.log.slice(3)).toEqual(expect.arrayContaining(['pull:cliente', 'pull:pedido', 'pull:pedido_item']));
    expect(a.log.slice(3).every((l) => l.startsWith('pull:'))).toBe(true);
    // no reenvio da troca, a cópia antiga ainda estava no aparelho (limpeza só depois do envio, ADR 0021 §5.2–5.3)
    expect(fantasmaNoReenvio).toEqual([true, true]);

    // o fantasma (U5011 = 000011 da base antiga) saiu; o 000011 agora é o do seed; nenhum número repetido
    avancar(MIN);
    expect(await ap.motor.sincronizar(), ap.motor.estado().erro ?? '').toBe(true);
    const ids = (await ap.motor.linhas('pedido')).map((l) => l.id);
    expect(ids).not.toContain(U(5011));
    expect(ids).toEqual(expect.arrayContaining([U(5012), U(5013)]));
    const nums = await ap.numeros();
    expect(new Set(nums).size).toBe(nums.length);
    expect(nums).toEqual(Array.from({ length: 12 }, (_x, i) => String(i + 1).padStart(6, '0')));
    const tipos = listaDePedidos(await lerLinhas(ap.motor), {}).filter((o) => [U(5012), U(5013)].includes(o.id)).map((o) => o.tipo).sort();
    expect(tipos).toEqual(['orcamento', 'pedido']);
    expect(await ap.repo.ler('rascunhos')).toHaveProperty(CLI.padaria);
  });

  it('D-3 a cópia do Vendedor some (apagarCopiaDoServidor) e as exibições órfãs são podadas; as dos itens ainda na fila ficam', async () => {
    const { a, relogio, avancar } = montar();
    const ap = await aparelho(fabrica, a.servidor, relogio);
    await ap.motor.sincronizar();
    // cache da Fase M e da ficha (cópia do servidor) + exibição órfã de um pedido antigo já puxado
    await ap.repo.gravar('pedidos', [{ id: U(5011), number: '000011' } as never]);
    await ap.repo.gravar('ultimos', { [CLI.atacadinho]: [{ id: U(5011) } as never] });
    await ap.repo.guardarExibicao(U(5011), exibicao('Atacadinho'));
    // item que a base nova vai recusar: fica `falhou`, visível, e a exibição dele fica
    ap.rede.online = false;
    await ap.motor.enfileirar({ id: U(5020), entidade: 'pedido', payload: payload(U(5020), CLI.atacadinho), rotulo: 'Pedido · Atacadinho' });
    await ap.repo.guardarExibicao(U(5020), exibicao('Atacadinho'));
    a.recriar(G.a2);
    a.servidor.rejeitar.set(U(5020), { codigo: 'FORA_DA_CARTEIRA', mensagem: 'Cliente fora da carteira.' });
    ap.rede.online = true;
    avancar(MIN);
    expect(await ap.motor.sincronizar(), ap.motor.estado().erro ?? '').toBe(true);

    expect(await ap.repo.ler('pedidos')).toEqual([]);
    expect(await ap.repo.ler('ultimos')).toEqual({});
    // antes da poda as duas exibições ainda estão lá (o contexto da etapa não enxerga a fila)
    expect(Object.keys(await ap.repo.ler('exibicoes')).sort()).toEqual([U(5011), U(5020)]);
    expect(await ap.podar()).toBe(true);
    expect(Object.keys(await ap.repo.ler('exibicoes'))).toEqual([U(5020)]);
    expect(await ap.podar()).toBe(false); // marcador consumido: a poda roda uma vez por troca
    expect(ap.motor.estado().fila.map((i) => [i.id, i.situacao, i.codigo])).toEqual([[U(5020), 'falhou', 'FORA_DA_CARTEIRA']]);
  });

  it('D-4 troca percebida pela atualização leve (novidades) também reenvia a fila e limpa a cópia', async () => {
    const { a, relogio, avancar } = montar();
    const ap = await aparelho(fabrica, a.servidor, relogio);
    await ap.motor.sincronizar();
    await ap.motor.enfileirar({ id: U(5011), entidade: 'pedido', payload: payload(U(5011), CLI.atacadinho) });
    await ap.motor.enviar();
    avancar(MIN);
    await ap.motor.sincronizar();
    ap.rede.online = false;
    await ap.motor.enfileirar({ id: U(5030), entidade: 'pedido', payload: payload(U(5030), CLI.padaria, 'orcamento') });
    a.recriar(G.a2);
    ap.rede.online = true;
    avancar(30 * MIN);
    expect(await ap.motor.sincronizarNovidades(), ap.motor.estado().erro ?? '').toBe(true);
    expect(a.servidor.recebidos.has(U(5030))).toBe(true);
    expect(await ap.armazenamento.ler('sync:geracao_base')).toBe(G.a2);
    avancar(MIN);
    await ap.motor.sincronizar();
    const ids = (await ap.motor.linhas('pedido')).map((l) => l.id);
    expect(ids).not.toContain(U(5011));
    expect(ids).toContain(U(5030));
  });

  it('D-5 app antigo e servidor antigo: sem `geracao_base` nada quebra; o leitor antigo das novidades descarta o campo novo', async () => {
    const { a, relogio, avancar } = montar();
    // servidor antes da 0022: não manda o campo → aparelho não grava geração e não apaga nada
    a.servidor.geracao_base = null;
    const ap = await aparelho(fabrica, a.servidor, relogio);
    await ap.repo.guardarExibicao(U(9001), exibicao('Atacadinho'));
    expect(await ap.motor.sincronizar(), ap.motor.estado().erro ?? '').toBe(true);
    expect(await ap.armazenamento.ler('sync:geracao_base')).toBeNull();
    avancar(MIN);
    expect(await ap.motor.sincronizarNovidades(), ap.motor.estado().erro ?? '').toBe(true);
    expect(await ap.repo.ler('exibicoes')).toHaveProperty(U(9001));

    // app atualizado num aparelho que já tinha dados: a primeira geração é só adotada (ADR 0021, consequências)
    a.servidor.geracao_base = G.a1;
    avancar(MIN);
    expect(await ap.motor.sincronizar(), ap.motor.estado().erro ?? '').toBe(true);
    expect(await ap.armazenamento.ler('sync:geracao_base')).toBe(G.a1);
    expect(await ap.numeros()).toHaveLength(10);
    expect(await ap.repo.ler('exibicoes')).toHaveProperty(U(9001));

    // APK antigo: o NovidadesRespostaSchema dele não tinha o campo (z.object sem .strict()) e o pull não tem schema estrito
    const LeitorAntigo = NovidadesRespostaSchema.omit({ geracao_base: true });
    const resposta = await a.servidor.novidades!(null);
    expect(resposta.geracao_base).toBe(G.a1);
    const lido = LeitorAntigo.safeParse(resposta);
    expect(lido.success).toBe(true);
    expect(lido.data).not.toHaveProperty('geracao_base');
    expect(NovidadesRespostaSchema.parse(resposta).geracao_base).toBe(G.a1);
    const pagina = await a.servidor.pull('pedido', null);
    expect(pagina.geracao_base).toBe(G.a1);
    expect(Array.isArray(pagina.itens)).toBe(true);
    expect(typeof pagina.proximo_cursor === 'string' || pagina.proximo_cursor === null).toBe(true);
  });

  it('D-6 dois tenants: girar a base do tenant A não mexe no aparelho do tenant B (geração, linhas, fila e cache)', async () => {
    let agora = T0;
    const relogio = () => agora;
    const a = tenant(G.a1, relogio);
    const b = tenant(G.b1, relogio);
    const apA = await aparelho(fabrica, a.servidor, relogio);
    const apB = await aparelho(fabrica, b.servidor, relogio);
    await apA.motor.sincronizar();
    await apB.motor.sincronizar();
    // B tem um pedido aceito na base dele (000011) e um orçamento na fila
    await apB.motor.enfileirar({ id: U(6011), entidade: 'pedido', payload: payload(U(6011), CLI.atacadinho) });
    await apB.motor.enviar();
    await apB.repo.guardarExibicao(U(6011), exibicao('Atacadinho'));
    agora += MIN;
    await apB.motor.sincronizar();
    apB.rede.online = false;
    await apB.motor.enfileirar({ id: U(6012), entidade: 'pedido', payload: payload(U(6012), CLI.padaria, 'orcamento') });

    a.recriar(G.a2);
    agora += MIN;
    apB.rede.online = true;
    b.log.length = 0;
    expect(await apA.motor.sincronizar(), apA.motor.estado().erro ?? '').toBe(true);
    expect(await apB.motor.sincronizar(), apB.motor.estado().erro ?? '').toBe(true);

    expect(await apA.armazenamento.ler('sync:geracao_base')).toBe(G.a2);
    expect(await apB.armazenamento.ler('sync:geracao_base')).toBe(G.b1);
    expect(b.servidor.geracao_base).toBe(G.b1);
    expect((await apB.motor.linhas('pedido')).map((l) => l.id)).toContain(U(6011));
    expect(await apB.repo.ler('exibicoes')).toHaveProperty(U(6011));
    expect(await apB.podar()).toBe(false); // B não recebeu o marcador da troca
    expect(b.servidor.recebidos.has(U(6012))).toBe(true);
    // B fez só a passada normal (uma página de pedido)
    expect(b.log.filter((l) => l === 'pull:pedido')).toHaveLength(1);
  });
});
