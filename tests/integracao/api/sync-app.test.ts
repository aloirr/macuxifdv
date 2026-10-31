/**
 * T-0003 C3.1 "ativar/desativar reflete no app no próximo sync", de ponta a ponta: o MOTOR DE SYNC real do
 * platform-sdk (o mesmo do app, com armazenamento em memória no lugar do AsyncStorage) conversa com o createApp real
 * (Core + Postgres como macuxi_app) por um transporte igual ao `transporteV1` do shell mobile
 * (apps/mobile/src/services/transporte.ts) e faz o que o `sincronizar` do shell faz
 * (apps/mobile/src/state/plataforma.tsx): `GET /v1/me/modulos` → `aplicarModulosAtivos` → `motor.sincronizar()`.
 * Cenários S0-046, S0-047, S0-048, S0-104 e S0-105 do plano.
 */
import { MeusModulosRespostaSchema } from '@macuxi/core/contracts';
import { manifest as manifestoCore } from '@macuxi/core/manifest';
import { manifest as manifestoCatalogo } from '@macuxi/catalogo/manifest';
import { manifest as manifestoPromotor } from '@macuxi/promotor/manifest';
import { manifest as manifestoVendedor } from '@macuxi/vendedor/manifest';
import { semBanco } from '@macuxi/db/teste/estado';
import {
  criarArmazenamentoEmMemoria,
  criarMotorSync,
  criarRegistroSync,
  definirEntidadeSync,
  type ItemPush,
  type LinhaSync,
  type MotorSync,
  type PaginaSync,
  type ResultadoItemPush,
  type TransporteSync,
  MENSAGEM_PULL_INDISPONIVEL,
  rotuloDoItem,
  SYNC_NAO_IMPLEMENTADO,
} from '@macuxi/platform-sdk';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { A, B, comToken, licenca, subirApi, type ApiDeTeste, type Tenant } from '../apoio/api';

const MANIFESTOS = [manifestoCore, manifestoCatalogo, manifestoVendedor, manifestoPromotor];
/** Pedido só de envio nos cenários de licença (o pull real de pedido é provado no bloco do registro do Campo; o push segue sem `receber` na Sprint 1). */
const entidadePedido = definirEntidadeSync({ nome: 'pedido', modulo: 'vendedor', direcao: 'push', conflito: 'app_edita_ate_status', schema: z.object({ id: z.string() }).passthrough() });

class ErroTransporte extends Error {
  constructor(
    readonly status: number,
    readonly codigo: string,
  ) {
    super(`${status} ${codigo}`);
  }
}

/** Igual ao transporteV1 do shell: 4xx no lote vira rejeição por item; 401/5xx/rede = exceção (o motor tenta depois). */
function transporte(api: ApiDeTeste, token: () => string): TransporteSync {
  return {
    async push(itens: ItemPush[]): Promise<ResultadoItemPush[]> {
      const r = await api.chamar(token(), { method: 'POST', url: '/v1/sync/push', payload: { itens } });
      if (r.statusCode === 200) return (r.json() as { resultados: ResultadoItemPush[] }).resultados;
      const e = r.json() as { codigo: string; mensagem: string };
      if (r.statusCode >= 500 || r.statusCode === 401) throw new ErroTransporte(r.statusCode, e.codigo);
      return itens.map((i) => ({ id: i.id, status: 'rejeitado' as const, codigo: e.codigo, mensagem: e.mensagem }));
    },
    async pull(entidade: string, cursor: string | null): Promise<PaginaSync<LinhaSync>> {
      const q = new URLSearchParams({ entidade, ...(cursor ? { cursor } : {}) });
      const r = await api.chamar(token(), { method: 'GET', url: `/v1/sync/pull?${q}` });
      if (r.statusCode !== 200) throw new ErroTransporte(r.statusCode, (r.json() as { codigo: string }).codigo);
      return r.json() as PaginaSync<LinhaSync>;
    },
  };
}

interface Aparelho {
  motor: MotorSync;
  armazenamento: ReturnType<typeof criarArmazenamentoEmMemoria>;
  /** O `sincronizar` do shell: licenças primeiro (se houver sinal), depois o motor. */
  sincronizar(): Promise<boolean>;
  online: { valor: boolean };
  token: { valor: string };
}

async function aparelho(api: ApiDeTeste, email: string, tenant: Tenant = A): Promise<Aparelho> {
  const s = await api.sessao(email, tenant);
  const token = { valor: s.access_token };
  const online = { valor: true };
  const registro = criarRegistroSync(MANIFESTOS);
  // as entidades de pull do Core como o servidor as define (provedores reais do createApp)
  for (const p of api.modulos.find((m) => m.manifesto.id === 'core')!.sync ?? []) if (['cliente', 'carteira'].includes(p.entidade.nome)) registro.registrar(p.entidade);
  registro.registrar(entidadePedido);
  const armazenamento = criarArmazenamentoEmMemoria();
  const motor = criarMotorSync({ registro, armazenamento, transporte: transporte(api, () => token.valor), online: () => online.valor });
  await motor.carregar();
  return {
    motor,
    armazenamento,
    online,
    token,
    async sincronizar() {
      if (online.valor) {
        const r = await api.app.inject({ method: 'GET', url: '/v1/me/modulos', headers: comToken(token.valor) });
        if (r.statusCode === 200) await motor.aplicarModulosAtivos(MeusModulosRespostaSchema.parse(r.json()).modulos.map((m) => m.id));
      }
      return motor.sincronizar();
    },
  };
}

const idsDe = (linhas: LinhaSync[]) => linhas.map((l) => l.id).sort();

describe.skipIf(semBanco())('T-0003 C3.1 — o app reflete a licença no próximo sync (motor real × API real × Postgres)', () => {
  let api: ApiDeTeste;
  let admin: string;

  beforeAll(async () => {
    api = await subirApi();
    admin = (await api.sessao('admin@exemplo.com.br')).access_token;
    // o pull só devolve linhas com updated_at < now() − 2 s (horizonte seguro, desenho T-0004 §5): a fixture acabou de entrar
    await new Promise((r) => setTimeout(r, 2_500));
  });
  afterAll(async () => {
    await api?.fechar();
  });

  it('S0-046: desliga → no próximo sync o Vendedor sai do aparelho e o armazenamento dele é apagado; religa → volta', async () => {
    const ap = await aparelho(api, 'vendedor2@exemplo.com.br');
    expect(await ap.sincronizar()).toBe(true);
    expect(ap.motor.estado().modulosAtivos).toEqual(['core', 'catalogo', 'vendedor']);
    await ap.motor.armazenamentoDoModulo('vendedor').gravar('rascunho', { cliente: A.clientes.c2 });

    expect((await licenca(api, admin, 'usuario', 'vendedor', false, A.usuarios.vendedor2)).statusCode).toBe(200);
    // antes do próximo sync o aparelho segue com o estado anterior (sem travar)
    expect(ap.motor.estado().modulosAtivos).toContain('vendedor');
    expect(await ap.sincronizar()).toBe(true);
    expect(ap.motor.estado().modulosAtivos).toEqual(['core', 'catalogo']);
    expect(await ap.motor.armazenamentoDoModulo('vendedor').chaves('')).toEqual([]);
    expect(Object.keys(ap.armazenamento.conteudo()).filter((k) => k.startsWith('mod:vendedor:'))).toEqual([]);
    // os dados do Core continuam (cliente da carteira do vendedor2)
    expect(idsDe(await ap.motor.linhas('cliente'))).toEqual([A.clientes.c2]);

    expect((await licenca(api, admin, 'usuario', 'vendedor', true, A.usuarios.vendedor2)).statusCode).toBe(200);
    expect(await ap.sincronizar()).toBe(true);
    expect(ap.motor.estado().modulosAtivos).toEqual(['core', 'catalogo', 'vendedor']);
  });

  it('S0-047: sem sinal o aparelho mantém o estado anterior; na reconexão aplica a desativação', async () => {
    const ap = await aparelho(api, 'vendedor2@exemplo.com.br');
    expect(await ap.sincronizar()).toBe(true);
    ap.online.valor = false;
    expect((await licenca(api, admin, 'tenant', 'vendedor', false)).statusCode).toBe(200);
    try {
      expect(await ap.sincronizar()).toBe(false);
      expect(ap.motor.estado().erro).toMatch(/Sem sinal/);
      expect(ap.motor.estado().modulosAtivos).toEqual(['core', 'catalogo', 'vendedor']);
      ap.online.valor = true;
      expect(await ap.sincronizar()).toBe(true);
      expect(ap.motor.estado().modulosAtivos).toEqual(['core', 'catalogo']);
    } finally {
      expect((await licenca(api, admin, 'tenant', 'vendedor', true)).statusCode).toBe(200);
    }
  });

  it('S0-048 (RN-CORE-02): item na fila de módulo desativado não some em silêncio — fica pendente de confirmação e os dados aguardam', async () => {
    const ap = await aparelho(api, 'vendedor2@exemplo.com.br');
    expect(await ap.sincronizar()).toBe(true);
    ap.online.valor = false; // pedido feito sem sinal
    const item = await ap.motor.enfileirar({ id: '0e000000-0000-4000-8000-0000000000a1', entidade: 'pedido', payload: { id: '0e000000-0000-4000-8000-0000000000a1' } });
    await ap.motor.armazenamentoDoModulo('vendedor').gravar('rascunho', { x: 1 });
    expect((await licenca(api, admin, 'usuario', 'vendedor', false, A.usuarios.vendedor2)).statusCode).toBe(200);
    try {
      ap.online.valor = true;
      await ap.sincronizar();
      const e = ap.motor.estado();
      expect(e.modulosAtivos).toEqual(['core', 'catalogo']);
      expect(e.limpezaPendente).toEqual(['vendedor']);
      const naFila = e.fila.find((i) => i.id === item.id);
      expect(naFila, 'o item continua visível na fila').toBeDefined();
      expect(naFila!.situacao).not.toBe('pendente');
      expect(naFila!.codigo).toBeTruthy();
      // dados do módulo só saem depois do "ok" do usuário
      expect(await ap.motor.armazenamentoDoModulo('vendedor').chaves('')).toEqual(['rascunho']);
      await ap.motor.confirmarLimpeza('vendedor');
      expect(ap.motor.estado().fila).toEqual([]);
      expect(await ap.motor.armazenamentoDoModulo('vendedor').chaves('')).toEqual([]);
    } finally {
      expect((await licenca(api, admin, 'usuario', 'vendedor', true, A.usuarios.vendedor2)).statusCode).toBe(200);
    }
  });

  it('S0-105: o pull respeita tenant e carteira (vendedor1 de A: c1 e c3; vendedor de B: só o cliente de B)', async () => {
    const a1 = await aparelho(api, 'vendedor@exemplo.com.br', A);
    const b1 = await aparelho(api, 'vendedor@exemplo.com.br', B);
    expect(await a1.sincronizar()).toBe(true);
    expect(await b1.sincronizar()).toBe(true);
    expect(idsDe(await a1.motor.linhas('cliente'))).toEqual([A.clientes.c1, A.clientes.c3].sort());
    expect(idsDe(await b1.motor.linhas('cliente'))).toEqual([B.clientes.c1]);
    // carteira: só vínculos de clientes visíveis (o do promotor no c1 aparece: quem mais atende o meu cliente — observação no relatório)
    const carteiraA = await a1.motor.linhas<LinhaSync & { cliente_id: string; usuario_id: string }>('carteira');
    expect(new Set(carteiraA.map((l) => l.cliente_id))).toEqual(new Set([A.clientes.c1, A.clientes.c3]));
    expect(carteiraA.map((l) => l.usuario_id)).toContain(A.usuarios.vendedor1);
    expect(carteiraA.map((l) => l.usuario_id)).not.toContain(A.usuarios.vendedor2);
    const carteiraB = await b1.motor.linhas<LinhaSync & { cliente_id: string }>('carteira');
    expect(carteiraB.map((l) => l.cliente_id)).toEqual([B.clientes.c1]);
  });

  it('S0-104: acesso inválido no meio do caminho → o push falha sem perder a fila; com o acesso novo (refresh) envia', async () => {
    const s = await api.sessao('vendedor2@exemplo.com.br');
    const ap = await aparelho(api, 'vendedor2@exemplo.com.br');
    expect(await ap.sincronizar()).toBe(true);
    await ap.motor.enfileirar({ id: '0e000000-0000-4000-8000-0000000000b1', entidade: 'pedido', payload: { id: '0e000000-0000-4000-8000-0000000000b1' } });
    ap.token.valor = 'expirado.ou.invalido';
    await ap.motor.enviar();
    expect(ap.motor.estado().fila).toHaveLength(1);
    expect(ap.motor.estado().fila[0]).toMatchObject({ situacao: 'pendente', tentativas: 1 });
    const r = await api.app.inject({ method: 'POST', url: '/v1/auth/refresh', payload: { refresh_token: s.refresh_token } });
    expect(r.statusCode, r.body).toBe(200);
    ap.token.valor = (r.json() as { access_token: string }).access_token;
    await ap.motor.enviar();
    // o servidor responde por item (pedido ainda sem `receber` na Sprint 1: rejeitado com código), nunca 401 de novo
    expect(ap.motor.estado().fila[0]!.codigo).not.toBeNull();
    expect(ap.motor.estado().fila[0]!.tentativas).toBe(2);
  });
});

/**
 * O registro de sync REAL do app Campo hoje contra a API real: modules/core/app (`visita` ambos) e modules/vendedor/app
 * (`pedido` ambos e `pedido_item` pull, com as definições que o servidor publica: mesmas `schemaLinha`). Desde a T-0018
 * do Vendedor o pull de `pedido`/`pedido_item` responde 200 (escopo por usuários visíveis; janela de 90 dias ou status não
 * final). `visita` depende da T-0018 do Core (em andamento) e não é afirmada aqui. Para provar o D-2 (501 vira aviso,
 * item fica pendente) o teste registra também `alerta_ruptura`: está no manifesto do Vendedor e, pelo desenho T-0016 §3
 * ("Sem provedor nesta sprint"), segue sem provedor na Sprint 1.
 */
describe.skipIf(semBanco())('C3.1 com o registro de sync que o app Campo declara hoje', () => {
  let api: ApiDeTeste;
  let admin: string;
  /** Entidade do manifesto do Vendedor sem provedor no servidor nesta sprint (desenho T-0016 §3). */
  const SEM_PROVEDOR = 'alerta_ruptura';
  const registroDoCampo = () => {
    const r = criarRegistroSync(MANIFESTOS);
    r.registrar(definirEntidadeSync({ nome: 'visita', modulo: 'core', direcao: 'ambos', conflito: 'servidor_vence', schema: z.unknown() }));
    for (const p of api.modulos.find((m) => m.manifesto.id === 'vendedor')!.sync ?? [])
      if (['pedido', 'pedido_item'].includes(p.entidade.nome)) r.registrar(p.entidade);
    r.registrar(
      definirEntidadeSync({ nome: SEM_PROVEDOR, modulo: 'vendedor', direcao: 'ambos', conflito: 'servidor_vence', schema: z.object({ id: z.string() }).passthrough() }),
    );
    return r;
  };
  const novoMotor = (token: string) =>
    criarMotorSync({ registro: registroDoCampo(), armazenamento: criarArmazenamentoEmMemoria(), transporte: transporte(api, () => token) });
  const sincronizarComoOShell = async (motor: MotorSync, token: string) => {
    const r = await api.app.inject({ method: 'GET', url: '/v1/me/modulos', headers: comToken(token) });
    await motor.aplicarModulosAtivos(MeusModulosRespostaSchema.parse(r.json()).modulos.map((m) => m.id));
    return motor.sincronizar();
  };

  beforeAll(async () => {
    api = await subirApi();
    admin = (await api.sessao('admin@exemplo.com.br')).access_token;
    // horizonte seguro do pull (updated_at < now() − 2 s): a fixture de pedidos acabou de entrar
    await new Promise((r) => setTimeout(r, 2_500));
  });
  afterAll(async () => {
    await api?.fechar();
  });

  it('S0-046: a lista de módulos é aplicada mesmo quando o pull de uma entidade falha', async () => {
    const t = (await api.sessao('vendedor2@exemplo.com.br')).access_token;
    const motor = novoMotor(t);
    await sincronizarComoOShell(motor, t);
    expect(motor.estado().modulosAtivos).toEqual(['core', 'catalogo', 'vendedor']);
    expect((await licenca(api, admin, 'usuario', 'vendedor', false, A.usuarios.vendedor2)).statusCode).toBe(200);
    try {
      await sincronizarComoOShell(motor, t);
      expect(motor.estado().modulosAtivos).toEqual(['core', 'catalogo']);
    } finally {
      expect((await licenca(api, admin, 'usuario', 'vendedor', true, A.usuarios.vendedor2)).statusCode).toBe(200);
    }
  });

  it('T-0018: o "Sincronizar" do app Campo termina sem erro e traz pedido e pedido_item de verdade, no escopo do vendedor', async () => {
    const t = (await api.sessao('vendedor2@exemplo.com.br')).access_token;
    const motor = novoMotor(t);
    expect(await sincronizarComoOShell(motor, t)).toBe(true);
    const e = motor.estado();
    expect(e.erro).toBeNull();
    expect(e.sincronizado_em).not.toBeNull();
    // pedido e pedido_item não viram mais aviso (o 501 acabou)
    expect(e.avisos.map((a) => a.entidade)).not.toContain('pedido');
    expect(e.avisos.map((a) => a.entidade)).not.toContain('pedido_item');
    // vendedor-2 vê só o próprio pedido (p2, digitado pelo supervisor em nome dele, RN-VEN-35); p1 e p3 são do vendedor-1
    const pedidos = await motor.linhas<LinhaSync & { vendedor_id: string; cliente_id: string; status: string }>('pedido');
    expect(idsDe(pedidos)).toEqual([A.pedidos.p2]);
    expect(pedidos[0]).toMatchObject({ vendedor_id: A.usuarios.vendedor2, cliente_id: A.clientes.c2, status: 'pending_approval' });
    const itens = await motor.linhas<LinhaSync & { pedido_id: string }>('pedido_item');
    expect(itens.length).toBeGreaterThan(0);
    expect(new Set(itens.map((i) => i.pedido_id))).toEqual(new Set([A.pedidos.p2]));
    // o próximo sync é incremental: nada novo, nada duplicado
    expect(await sincronizarComoOShell(motor, t)).toBe(true);
    expect(idsDe(await motor.linhas('pedido'))).toEqual([A.pedidos.p2]);
    expect(await motor.linhas('pedido_item')).toHaveLength(itens.length);
  });

  // D-2 (corrigido no motor e na API, ADR 0009 §7; recado R-20261031-163405): entidade do manifesto de módulo ativo
  // sem provedor no servidor → pull 501 `SYNC_NAO_IMPLEMENTADO` vira AVISO (cursor intacto) e o sync termina; o push
  // dela volta `rejeitado/SYNC_NAO_IMPLEMENTADO` e o item fica `pendente` na fila. Provado com `alerta_ruptura`.
  it('D-2: o "Sincronizar" do app Campo termina sem erro; entidade sem provedor vira aviso e o item fica pendente', async () => {
    const t = (await api.sessao('vendedor2@exemplo.com.br')).access_token;
    const motor = novoMotor(t);
    const id = '0e000000-0000-4000-8000-0000000000d2';
    await motor.enfileirar({ id, entidade: SEM_PROVEDOR, payload: { id } });
    const ok = await sincronizarComoOShell(motor, t);
    const e = motor.estado();
    expect(e.erro).toBeNull();
    expect(ok).toBe(true);
    expect(e.sincronizado_em).not.toBeNull();
    // sem provedor de pull: aviso, não erro; o pedido (com provedor) não aparece entre os avisos e chega de verdade
    expect(e.avisos.map((a) => a.entidade)).toContain(SEM_PROVEDOR);
    expect(e.avisos.map((a) => a.entidade)).not.toContain('pedido');
    for (const a of e.avisos) expect(a).toMatchObject({ codigo: SYNC_NAO_IMPLEMENTADO, mensagem: MENSAGEM_PULL_INDISPONIVEL });
    expect(await motor.linhas(SEM_PROVEDOR)).toEqual([]);
    expect(idsDe(await motor.linhas('pedido'))).toEqual([A.pedidos.p2]);
    // o item feito no aparelho continua na fila, pendente, com o código retentável e o rótulo de "na fila"
    const naFila = e.fila.find((i) => i.id === id);
    expect(naFila, 'o item continua na fila').toBeDefined();
    expect(naFila).toMatchObject({ situacao: 'pendente', codigo: SYNC_NAO_IMPLEMENTADO, tentativas: 1 });
    expect(rotuloDoItem(naFila!)).toBe('na fila — envio ainda não disponível no servidor');
    // o próximo sync tenta de novo, sem erro e sem duplicar o item
    expect(await sincronizarComoOShell(motor, t)).toBe(true);
    expect(motor.estado().fila.filter((i) => i.id === id)).toMatchObject([{ situacao: 'pendente', tentativas: 2 }]);
  });
});
