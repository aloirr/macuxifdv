/**
 * Jornada AM2808 — telas REAIS do app Macuxi Campo no navegador (react-native-web), com o MOTOR DE SYNC real do aparelho
 * (`criarMotorSync` do platform-sdk, `shellDaVariante('campo')` com o registro, as etapas e as consultas do shell, o
 * `transporteV1` e o `ApiClient` do app) falando com a API local. Diferenças do aparelho: armazenamento em memória no lugar
 * do SQLite (o motor sincroniza do zero a cada abertura), módulos nativos (câmera, GPS, arquivos) como dublês vazios e o
 * expo-router como dublê (os parâmetros da rota vêm do cenário). Nada de produção é alterado.
 */
import { criarArmazenamentoEmMemoria, criarMotorSync, ErroHttp, type MotorSync } from '@macuxi/platform-sdk';
import { ProvedorBloqueioDeSaida, ShellProvider } from '@macuxi/platform-sdk/react';
import { MeusModulosRespostaSchema, type SessaoResposta } from '@macuxi/core/contracts';
import { createElement, type ComponentType } from 'react';
import { createRoot } from 'react-dom/client';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { shellDaVariante } from '../../../../apps/mobile/src/lib/modulos';
import { ApiClient } from '../../../../apps/mobile/src/services/api';
import { criarAmbienteDoAparelho } from '../../../../apps/mobile/src/services/ambiente';
import { transporteV1 } from '../../../../apps/mobile/src/services/transporte';
import { TelaClientes } from '../../../../modules/core/app/telas/clientes';
import { VisitSheetsProvider } from '../../../../modules/core/app/components/visit-sheets';
import { TelaCliente } from '../../../../modules/core/app/telas/cliente';
import * as Catalogo from '../../../../modules/catalogo/app/telas/catalogo';
import * as Pedidos from '../../../../modules/vendedor/app/screens/orders-screen';
import * as Detalhe from '../../../../modules/vendedor/app/screens/order-detail-screen';
import * as NovoPedido from '../../../../modules/vendedor/app/screens/new-order-screen';
import { lerLinhas, listaDeClientes, produtosComPrecos, condicoesDoCliente, meDoAparelho, politicaApi } from '../../../../modules/vendedor/app/lib/pull';
import { montarPedido, prepararPedido, rascunhoVazio, type Rascunho } from '../../../../modules/vendedor/app/lib/pedidos';
import { CONSULTA_PRECOS_CLIENTE } from '@macuxi/catalogo/contracts';

type Cenario = { tela: string; params?: Record<string, string>; codigo_empresa: string; email: string; senha: string; pedido?: { cliente_ext: string; quantidades: Record<string, number> } };
const C = (window as unknown as { CENARIO: Cenario }).CENARIO;
const API = 'http://localhost:47998/v1';
const log = (...a: unknown[]) => console.log('[campo]', ...a);
const w = window as unknown as Record<string, unknown>;

const primeiro = (m: Record<string, unknown>) => (m.default ?? Object.values(m).find((v) => typeof v === 'function')) as ComponentType;
const TELAS: Record<string, () => ComponentType> = {
  clientes: () => TelaClientes as ComponentType,
  cliente: () => TelaCliente,
  catalogo: () => primeiro(Catalogo as Record<string, unknown>),
  pedidos: () => primeiro(Pedidos as Record<string, unknown>),
  pedido: () => primeiro(Detalhe as Record<string, unknown>),
  'novo-pedido': () => primeiro(NovoPedido as Record<string, unknown>),
};

async function iniciar() {
  const r = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ codigo_empresa: C.codigo_empresa, email: C.email, senha: C.senha, app: 'campo', dispositivo_id: crypto.randomUUID(), dispositivo_nome: 'Navegador da jornada' }) });
  const sessao = (await r.json()) as SessaoResposta;
  if (!r.ok) throw new Error(`login ${r.status} ${JSON.stringify(sessao)}`);
  const api = new ApiClient(API, sessao.access_token);
  const usuario = () => ({ id: sessao.usuario.id, nome: sessao.usuario.nome, perfil: sessao.usuario.perfil, fuso: sessao.tenant.fuso });
  const ambiente = { ...criarAmbienteDoAparelho({ api: () => api, online: () => true, usuario }), novoId: () => crypto.randomUUID(), posicaoAgora: async () => null };
  const shell = shellDaVariante('campo');
  const motor: MotorSync = criarMotorSync({
    registro: shell.registroSync,
    armazenamento: criarArmazenamentoEmMemoria(),
    transporte: transporteV1(() => api, async () => undefined),
    online: () => true,
    ambiente,
    etapas: [...shell.etapasSync],
    mensagemDeErro: (e) => (e instanceof Error ? e.message : String(e)),
    consultas: shell.consultas,
  });
  await motor.carregar();
  const mods = MeusModulosRespostaSchema.parse((await api.request<unknown>('GET', '/me/modulos')).data).modulos;
  await motor.aplicarModulosAtivos(mods.map((m) => m.id), Object.fromEntries(mods.map((m) => [m.id, m.parametros ?? {}])));
  const ok = await motor.sincronizar();
  log('sync', ok, motor.estado().erro);
  const visao = shell.montar({ perfil: sessao.usuario.perfil, modulosAtivos: mods.map((m) => m.id) } as never);
  w.__motor = motor;
  w.__sessao = { usuario: sessao.usuario.nome, perfil: sessao.usuario.perfil, fuso: sessao.tenant.fuso, empresa: sessao.tenant };

  if (C.pedido) w.__pedido = await criarPedidoPeloMotor(motor, sessao, C.pedido);

  const Tela = TELAS[C.tela]!();
  const bloqueio = { registrar: () => () => undefined, alterado: () => false, tentarSair: (p: () => void) => p() } as never;
  createRoot(document.getElementById('raiz')!).render(
    createElement(SafeAreaProvider, { initialMetrics: { frame: { x: 0, y: 0, width: 360, height: 800 }, insets: { top: 24, left: 0, right: 0, bottom: 0 } } } as never, createElement(ShellProvider, { visao: visao as never, motor, ambiente }, createElement(ProvedorBloqueioDeSaida, { value: bloqueio }, createElement(VisitSheetsProvider, null, createElement(Tela))))),
  );
  w.__pronto = true;
}

/** Pedido pelo motor real do app (as funções do Novo pedido: `prepararPedido` e `montarPedido`), como em tests/integracao/demo/ciclo-erp.test.ts. */
async function criarPedidoPeloMotor(motor: MotorSync, sessao: SessaoResposta, p: NonNullable<Cenario['pedido']>) {
  const l = await lerLinhas(motor);
  const u = sessao.usuario;
  const params = motor.parametros('vendedor');
  const cliente = listaDeClientes(l, { id: u.id, name: u.nome }).find((c) => (c as { external_id?: string }).external_id === p.cliente_ext || c.name.includes(p.cliente_ext));
  if (!cliente) throw new Error('cliente não está na carteira do aparelho');
  const ids = l.produtos.filter((x) => (x as { sku?: string }).sku && p.quantidades[(x as { sku: string }).sku]).map((x) => x.id);
  const precos = await motor.ambiente.consultar(CONSULTA_PRECOS_CLIENTE, { cliente_id: cliente.id, produto_ids: ids, em: new Date().toISOString() });
  const catalogo = produtosComPrecos(l, new Map(precos.itens.map((i) => [i.produto_id, i.preco_cents]))).filter((x) => ids.includes(x.id));
  const conds = condicoesDoCliente(l, cliente.id);
  const rascunho: Rascunho = {
    ...rascunhoVazio(cliente.id),
    lines: Object.fromEntries(catalogo.map((x) => [x.id, p.quantidades[(x as { sku?: string }).sku ?? ''] ?? 1])),
    discount_pct: 0,
    condicao_pagamento_id: conds[0]?.id ?? null,
    payment_terms: conds[0]?.descricao ?? 'À vista',
  };
  const eu = meDoAparelho({ id: u.id, nome: u.nome, perfil: u.perfil, fuso: sessao.tenant.fuso }, params, new Date()).seller;
  const { v, display } = prepararPedido({ rascunho, cliente, catalogo, politica: politicaApi(params), eu, filaDoClienteCents: 0 });
  const id = crypto.randomUUID();
  await motor.enfileirar({ id, entidade: 'pedido', payload: montarPedido({ id, cliente, rascunho, v, semSinal: false, agora: new Date().toISOString() }) });
  const ok = await motor.sincronizar();
  return { id, ok, erro: motor.estado().erro, fila: motor.estado().fila.length, esperado: display.expected, condicao: conds[0]?.descricao ?? null, itens: catalogo.map((x) => ({ sku: (x as { sku?: string }).sku, preco: x.price_cents })) };
}

iniciar().catch((e) => {
  w.__erro = e instanceof ErroHttp ? `${e.status} ${e.message}` : String((e as Error)?.stack ?? e);
  console.error('[campo] falhou', w.__erro);
});
