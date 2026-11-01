import { criarArmazenamentoEmMemoria, criarMotorSync, criarRegistroSync, criarServidorSyncSimulado, type LinhaSync } from '@macuxi/platform-sdk';
import { describe, expect, it } from 'vitest';
import type { ClienteSync, MotivoSync, RotaParadaSync, RotaSync, VisitaSync } from '../../contracts';
import { manifest } from '../../manifest';
import { checkCheckin } from '../../domain';
import { entidadesCliente } from './entidades-cliente';
import { entidadesRota } from './entidades-rota';
import { montarEstadoLocal, pendentesDaFila, resumoDoCliente } from './rota-local';
import { montarCheckin, montarCheckout } from './visita-payload';

const HOJE = '2026-10-31';
const FUSO = 'America/Manaus';
const U = '0b000000-0000-4000-8000-000000000001';
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const base = { updated_at: '2026-10-31T10:00:00.000000Z', deleted_at: null, external_id: null };
const cliente = (n: number, nome: string, lat: string | null = '-3.100000', lng: string | null = '-60.000000'): ClienteSync => ({
  ...base,
  id: id(n),
  documento: `0000${n}`,
  razao_social: `${nome} Ltda`,
  nome_fantasia: nome,
  segmento: null,
  telefone: null,
  email: null,
  logradouro: 'Rua A',
  numero: '1',
  bairro: 'Centro',
  cidade: 'Manaus',
  uf: 'AM',
  cep: null,
  latitude: lat,
  longitude: lng,
  ativo: true,
});
const rota: RotaSync = { ...base, id: id(100), usuario_id: U, data: HOJE, situacao: 'publicada', origem: 'bko', regiao: 'Zona Sul', observacao: null };
const parada = (n: number, cid: number, seq: number): RotaParadaSync => ({ ...base, id: id(n), rota_id: id(100), usuario_id: U, data: HOJE, cliente_id: id(cid), sequencia: seq, janela_inicio: '09:00', janela_fim: '10:00' });
const motivo: MotivoSync = { ...base, id: id(200), tipo: 'cliente_fechado', codigo: 'loja_fechada', descricao: 'Loja fechada', exige_foto: true, sistema: true, ativo: true, ordem: 1 };
const linhasBase = {
  clientes: [cliente(1, 'Auto Peças Um'), cliente(2, 'Borracharia Dois'), cliente(3, 'Casa Três', null, null)],
  financeiros: [],
  titulos: [],
  historico: [],
  rotas: [rota],
  paradas: [parada(11, 1, 1), parada(12, 2, 2), parada(13, 3, 3)],
  visitas: [] as VisitaSync[],
  motivos: [motivo],
};
const o = { usuarioId: U, hoje: HOJE, fuso: FUSO, agora: new Date('2026-10-31T15:00:00Z') };

describe('rota do dia só com as linhas do aparelho (RF-CORE-05)', () => {
  it('lista e mapa: primeira parada é a próxima, as outras pendentes; região da rota', () => {
    const e = montarEstadoLocal(linhasBase, [], o);
    expect(e.rota?.stops.map((s) => [s.sequence, s.status, s.customer.trade_name])).toEqual([
      [1, 'next', 'Auto Peças Um'],
      [2, 'pending', 'Borracharia Dois'],
      [3, 'pending', 'Casa Três'],
    ]);
    expect(e.rota?.region).toBe('Zona Sul');
    expect(e.rota?.stops[2]?.customer.lat).toBeNull();
  });

  it('rota de outro usuário, de outro dia ou cancelada não aparece', () => {
    expect(montarEstadoLocal({ ...linhasBase, rotas: [{ ...rota, usuario_id: id(999) }] }, [], o).rota).toBeNull();
    expect(montarEstadoLocal({ ...linhasBase, rotas: [{ ...rota, data: '2026-10-30' }] }, [], o).rota).toBeNull();
    expect(montarEstadoLocal({ ...linhasBase, rotas: [{ ...rota, situacao: 'cancelada' }] }, [], o).rota).toBeNull();
  });

  it('RN-CORE-04: parada de cliente que saiu da carteira some da rota', () => {
    const sem = { ...linhasBase, clientes: linhasBase.clientes.slice(0, 2) };
    expect(montarEstadoLocal(sem, [], o).rota?.stops).toHaveLength(2);
  });

  it('resumo do cliente usa financeiro, títulos e histórico locais', () => {
    const r = resumoDoCliente(cliente(1, 'X'), null, [], [], HOJE);
    expect(r).toMatchObject({ trade_name: 'X', lat: -3.1, overdue_count: 0, days_since_purchase: null, positivated_this_month: false });
  });
});

describe('check-in e checkout no comando (RN-CORE-10/12/13/14)', () => {
  const cli = { id: id(1), lat: -3.1, lng: -60.0 };
  it('RN-CORE-10: fora do raio sem justificativa não gera comando; com justificativa vai marcado', () => {
    const longe = { lat: -3.11, lng: -60.0 };
    expect(montarCheckin({ id: id(50), cliente: cli, agora: o.agora, posicao: longe, extra: false }).ok).toBe(false);
    const com = montarCheckin({ id: id(50), cliente: cli, agora: o.agora, posicao: longe, justificativa: 'Cliente mudou de endereço', extra: false });
    expect(com.ok && com.avaliacao.fora_do_raio).toBe(true);
  });
  it('RN-CORE-13: sem GPS o comando vai sem coordenada', () => {
    const r = montarCheckin({ id: id(51), cliente: cli, agora: o.agora, posicao: null, extra: true });
    expect(r.ok && r.payload).toMatchObject({ lat: null, lng: null, extra: true });
  });
  it('RN-CORE-14: cliente fechado sem foto é recusado pelo contrato; com foto vai com motivo', () => {
    expect(() => montarCheckout({ id: id(60), visita_id: id(50), agora: o.agora, resultado: 'cliente_fechado', motivo_id: id(200) })).toThrow();
    expect(montarCheckout({ id: id(60), visita_id: id(50), agora: o.agora, resultado: 'cliente_fechado', motivo_id: id(200), foto_fachada_id: id(300) })).toMatchObject({ foto_fachada_id: id(300) });
  });
  it('RN-CORE-12: sem pedido exige motivo; pedido exige o pedido', () => {
    expect(() => montarCheckout({ id: id(61), visita_id: id(50), agora: o.agora, resultado: 'sem_pedido' })).toThrow();
    expect(() => montarCheckout({ id: id(62), visita_id: id(50), agora: o.agora, resultado: 'pedido' })).toThrow();
    expect(montarCheckout({ id: id(63), visita_id: id(50), agora: o.agora, resultado: 'atendido' }).resultado).toBe('atendido');
  });
});

describe('modo avião: abrir a rota, check-in e checkout; sincronizar depois sem duplicar (critério 1 da T-0018)', () => {
  const linhas: Record<string, LinhaSync[]> = {
    cliente: linhasBase.clientes,
    carteira: [],
    cliente_contato: [],
    cliente_financeiro: [],
    titulo: [],
    historico_compra: [],
    motivo: [motivo],
    rota: [rota],
    rota_parada: linhasBase.paradas,
    visita: [],
  };
  const registro = () => {
    const r = criarRegistroSync([manifest]);
    for (const e of [...entidadesCliente, ...entidadesRota]) r.registrar(e);
    return r;
  };
  const agora = () => new Date('2026-10-31T15:00:00Z');

  it('a rota abre offline; check-in e checkout ficam na fila; a tela mostra a parada feita; ao voltar o sinal, 1 check-in + 1 checkout no servidor, mesmo reenviando', async () => {
    const reg = registro();
    const servidor = criarServidorSyncSimulado(reg, { modulosAtivos: ['core'], linhas });
    const armazenamento = criarArmazenamentoEmMemoria();
    const abrir = () => criarMotorSync({ registro: reg, armazenamento, transporte: servidor, agora, online: () => servidor.online });
    const m1 = abrir();
    await m1.aplicarModulosAtivos(['core']);
    expect(await m1.sincronizar()).toBe(true);

    servidor.online = false; // modo avião
    const motor = abrir();
    await motor.carregar();
    const ler = async () =>
      montarEstadoLocal(
        {
          clientes: await motor.linhas<ClienteSync & LinhaSync>('cliente'),
          financeiros: [],
          titulos: [],
          historico: [],
          rotas: await motor.linhas<RotaSync & LinhaSync>('rota'),
          paradas: await motor.linhas<RotaParadaSync & LinhaSync>('rota_parada'),
          visitas: await motor.linhas<VisitaSync & LinhaSync>('visita'),
          motivos: await motor.linhas<MotivoSync & LinhaSync>('motivo'),
        },
        motor.estado().fila,
        o,
      );
    expect((await ler()).rota?.stops.map((s) => s.status)).toEqual(['next', 'pending', 'pending']);

    const vid = id(500);
    const ci = montarCheckin({ id: vid, cliente: { id: id(1), lat: -3.1, lng: -60.0 }, rota_parada_id: id(11), agora: new Date('2026-10-31T14:00:00Z'), posicao: { lat: -3.1, lng: -60.0 }, extra: false });
    if (!ci.ok) throw new Error('check-in deveria valer');
    await motor.enfileirar({ id: vid, entidade: 'visita', payload: ci.payload });
    let e = await ler();
    expect(e.rota?.stops[0]?.status).toBe('in_progress');
    expect(e.visitas.filter((v) => !v.checkout_at)).toHaveLength(1);

    const cmd = id(600);
    await motor.enfileirar({ id: cmd, entidade: 'visita_checkout', payload: montarCheckout({ id: cmd, visita_id: vid, agora: new Date('2026-10-31T14:30:00Z'), resultado: 'atendido' }) });
    e = await ler();
    expect(e.rota?.stops.map((s) => s.status)).toEqual(['done', 'next', 'pending']);
    expect(e.visitas[0]).toMatchObject({ resultado: 'atendido', closed_by: 'seller' });
    expect(pendentesDaFila(motor.estado().fila).map((p) => p.tipo)).toEqual(['checkin', 'checkout']);
    expect(await motor.sincronizar()).toBe(false); // sem sinal: nada sai, nada se perde
    expect(motor.estado().fila).toHaveLength(2);

    servidor.online = true;
    expect(await motor.sincronizar()).toBe(true);
    expect(motor.estado().fila).toHaveLength(0);
    expect([...servidor.recebidos.keys()].sort()).toEqual([vid, cmd].sort());
    // reenviar o mesmo item (fila antiga reaproveitada) não duplica no servidor: o id é a chave
    servidor.recebidos.clear();
    await motor.enfileirar({ id: vid, entidade: 'visita', payload: ci.payload });
    await motor.sincronizar();
    expect(servidor.recebidos.size).toBe(1);
  });
});

describe('D-3: check-in aceito pelo servidor continua no aparelho até o pull trazer a linha', () => {
  const linhas: Record<string, LinhaSync[]> = {
    cliente: linhasBase.clientes,
    carteira: [],
    cliente_contato: [],
    cliente_financeiro: [],
    titulo: [],
    historico_compra: [],
    motivo: [motivo],
    rota: [rota],
    rota_parada: linhasBase.paradas,
    visita: [],
  };

  it('RN-CORE-11 (D-3): após motor.enviar() aceito, sobreposicao() ainda devolve o check-in e um 2º check-in em outro cliente é bloqueado', async () => {
    const reg = criarRegistroSync([manifest]);
    for (const e of [...entidadesCliente, ...entidadesRota]) reg.registrar(e);
    const servidor = criarServidorSyncSimulado(reg, { modulosAtivos: ['core'], linhas });
    const motor = criarMotorSync({ registro: reg, armazenamento: criarArmazenamentoEmMemoria(), transporte: servidor, agora: () => new Date('2026-10-31T15:00:00Z'), online: () => servidor.online });
    await motor.aplicarModulosAtivos(['core']);
    expect(await motor.sincronizar()).toBe(true);

    const vid = id(700);
    const ci = montarCheckin({ id: vid, cliente: { id: id(1), lat: -3.1, lng: -60.0 }, rota_parada_id: id(11), agora: new Date('2026-10-31T14:00:00Z'), posicao: { lat: -3.1, lng: -60.0 }, extra: false });
    if (!ci.ok) throw new Error('check-in deveria valer');
    await motor.enfileirar({ id: vid, entidade: 'visita', payload: ci.payload });
    await motor.enviar();

    expect(servidor.recebidos.has(vid)).toBe(true);
    expect(motor.estado().fila).toHaveLength(0); // aceito saiu da fila de envio...
    const sobre = motor.sobreposicao();
    expect(pendentesDaFila(sobre).map((p) => p.tipo)).toEqual(['checkin']); // ...mas segue sobreposto até o pull

    const estado = montarEstadoLocal(
      {
        clientes: await motor.linhas<ClienteSync & LinhaSync>('cliente'),
        financeiros: [],
        titulos: [],
        historico: [],
        rotas: await motor.linhas<RotaSync & LinhaSync>('rota'),
        paradas: await motor.linhas<RotaParadaSync & LinhaSync>('rota_parada'),
        visitas: await motor.linhas<VisitaSync & LinhaSync>('visita'),
        motivos: await motor.linhas<MotivoSync & LinhaSync>('motivo'),
      },
      sobre,
      o,
    );
    expect(estado.visitas.filter((v) => !v.checkout_at)).toHaveLength(1);
    expect(checkCheckin(estado.visitas, U, id(2), o.agora, FUSO)).toMatchObject({ ok: false });
  });
});
