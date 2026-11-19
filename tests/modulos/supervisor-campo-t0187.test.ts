/**
 * T-0187 (v1.0.16) — supervisor em campo no Gestão: portão do rastreamento (RN-CORE-13), permissões dos manifestos e funções puras
 * do pedido em nome, sem banco. Desenho: docs/desenho/T-0187.md §1.2, §1.4, §2 e §4. Matriz: docs/testes/T-0187.md.
 *
 * Convenção: `it` = vale no `main` hoje; `it.runIf(<código entregue>)` = liga sozinho quando o símbolo do dono chegar ao `main`
 * (portão novo do modulo-core, ação `visita.registrar_gestao`, funções puras do modulo-vendedor); `it.todo` = sem como testar daqui.
 *
 * Instante fixo: qua 18/11/2026 11h em Manaus (15h UTC), dia útil dentro do expediente padrão (seg–sex 08h–18h).
 */
import * as contratosCore from '@macuxi/core/contracts';
import { PARAMETROS_RASTREAMENTO_PADRAO, podeRastrear } from '@macuxi/core/contracts';
import { manifest as manifestoCore } from '@macuxi/core/manifest';
import { manifest as manifestoVendedor } from '@macuxi/vendedor/manifest';
import { describe, expect, it } from 'vitest';
import * as dominioCore from '../../modules/core/domain';
import * as dominioVendedor from '../../modules/vendedor/domain';

const TEM_PORTAO_NOVO = 'APP_RASTREADO_DO_CARGO' in contratosCore;
const acoesCore = manifestoCore.acoes as Readonly<Record<string, { perfis: readonly string[] } | undefined>>;
const TEM_ACAO_GESTAO = acoesCore['visita.registrar_gestao'] !== undefined;
const nivelMinimoDoAutor = (dominioVendedor as Record<string, unknown>).nivelMinimoDoAutor as ((perfil: string) => string) | undefined;
interface UsuarioEquipe { id: string; nome: string; ativo: boolean; perfil: string; grupo?: string | null }
interface VinculoCarteira { usuario_id: string; cliente_id: string }
type OpcaoEmNome = { id: string; nome: string; da_carteira: boolean; desligado: boolean; motivo: string | null; grupo: string | null };
const vendedorPadraoEmNome = (dominioVendedor as Record<string, unknown>).vendedorPadraoEmNome as
  | ((e: { clienteId: string; carteira: readonly VinculoCarteira[]; equipe: readonly UsuarioEquipe[] }) => string | null)
  | undefined;
const opcoesEmNome = (dominioVendedor as Record<string, unknown>).opcoesEmNome as
  | ((e: { autor: { id: string; perfil: string }; clienteId: string; carteira: readonly VinculoCarteira[]; usuarios: readonly UsuarioEquipe[]; visiveis: ReadonlySet<string> | 'tenant' }) => OpcaoEmNome[])
  | undefined;
type EntradaRodape = { temPesquisa: boolean; atendimentoAqui: boolean; checkinPermitido: boolean; visitadoHoje: boolean; registraVisita?: boolean };
const botoesDoRodapeCliente = dominioCore.botoesDoRodapeCliente as unknown as (e: EntradaRodape) => { checkin: boolean; checkout: boolean; pesquisa: boolean };
const BASE_RODAPE: EntradaRodape = { temPesquisa: true, atendimentoAqui: false, checkinPermitido: true, visitadoHoje: false };
/** O Core entregou o `registraVisita` (Gestão sem `visita.registrar_gestao` = sem Check-in e sem Checkout). */
const TEM_RODAPE_GESTAO = botoesDoRodapeCliente({ ...BASE_RODAPE, registraVisita: false }).checkin === false;

/** Massa: equipe do supervisor s1 (v1, v2 ativos; v3 inativo; p1 promotor), v9 de outra equipe; cliente c1 na carteira de v1 e p1. */
const EQUIPE: UsuarioEquipe[] = [
  { id: 's1', nome: 'Sara Supervisora', ativo: true, perfil: 'supervisor' },
  { id: 'v2', nome: 'Bruno', ativo: true, perfil: 'vendedor', grupo: 'Equipe Norte' },
  { id: 'v1', nome: 'Ana', ativo: true, perfil: 'vendedor', grupo: 'Equipe Norte' },
  { id: 'v3', nome: 'Carla', ativo: false, perfil: 'vendedor', grupo: 'Equipe Norte' },
  { id: 'p1', nome: 'Paulo Promotor', ativo: true, perfil: 'promotor', grupo: 'Equipe Norte' },
  { id: 'v9', nome: 'Davi', ativo: true, perfil: 'vendedor', grupo: 'Equipe Sul' },
];
const CARTEIRA: VinculoCarteira[] = [
  { usuario_id: 'v1', cliente_id: 'c1' },
  { usuario_id: 'p1', cliente_id: 'c1' },
  { usuario_id: 'v1', cliente_id: 'c2' },
  { usuario_id: 'v2', cliente_id: 'c2' },
  { usuario_id: 'v3', cliente_id: 'c3' },
];

const ligado = (cargo: string, app: string) =>
  podeRastrear({ ativo: true, cargo, app, expediente: PARAMETROS_RASTREAMENTO_PADRAO.expediente, feriados: [], ausencias: [], instante: '2026-11-18T15:00:00.000Z', fuso: 'America/Manaus' });

describe('T-0187 — rastreamento do supervisor: interno e desligado de fábrica (RN-CORE-13)', () => {
  it('7/8. desligado de fábrica: com o padrão (rastreamento.ativo = false) ninguém é rastreado, nem o supervisor', () => {
    expect(PARAMETROS_RASTREAMENTO_PADRAO.ativo).toBe(false);
    for (const cargo of ['vendedor', 'promotor', 'supervisor', 'gerente']) {
      for (const app of ['campo', 'gestao']) {
        const r = podeRastrear({ ativo: PARAMETROS_RASTREAMENTO_PADRAO.ativo, cargo, app, expediente: PARAMETROS_RASTREAMENTO_PADRAO.expediente, feriados: [], ausencias: [], instante: '2026-11-18T15:00:00.000Z', fuso: 'America/Manaus' });
        expect(r, `${cargo}/${app}`).toEqual({ pode: false, motivo: 'desligado' });
      }
    }
  });

  it('7/8. o gerente nunca é rastreado, em app nenhum (motivo cargo)', () => {
    for (const app of ['campo', 'gestao']) expect(ligado('gerente', app), app).toEqual({ pode: false, motivo: 'cargo' });
  });

  it('7. contraprova do Campo: vendedor no Campo pode; vendedor no Gestão não (app)', () => {
    expect(ligado('vendedor', 'campo')).toEqual({ pode: true });
    expect(ligado('vendedor', 'gestao')).toEqual({ pode: false, motivo: 'app' });
  });

  it.runIf(TEM_PORTAO_NOVO)('7. os 4 casos do desenho §1.2: supervisor/gestao pode; supervisor/campo = app; vendedor/gestao = app; gerente = cargo', () => {
    expect(ligado('supervisor', 'gestao')).toEqual({ pode: true });
    expect(ligado('supervisor', 'campo')).toEqual({ pode: false, motivo: 'app' });
    expect(ligado('vendedor', 'gestao')).toEqual({ pode: false, motivo: 'app' });
    expect(ligado('gerente', 'gestao')).toEqual({ pode: false, motivo: 'cargo' });
    const mapa = (contratosCore as Record<string, unknown>).APP_RASTREADO_DO_CARGO as Record<string, string>;
    expect(mapa).toEqual({ vendedor: 'campo', promotor: 'campo', supervisor: 'gestao' });
  });
});

describe('T-0187 — permissões por perfil nos manifestos (regra 6 e 7 do CLAUDE.md)', () => {
  it('12/14/21. pedido.criar_em_nome é só de supervisor e gerente: vendedor, promotor e analista não fazem pedido em nome', () => {
    const perfis = (manifestoVendedor.acoes as Record<string, { perfis: readonly string[] }>)['pedido.criar_em_nome']!.perfis;
    expect([...perfis].sort()).toEqual(['gerente', 'supervisor']);
  });

  it('20. nenhuma ação de escrita de pedido do Vendedor tem o promotor (RN-PRO-01)', () => {
    for (const [acao, def] of Object.entries(manifestoVendedor.acoes as Record<string, { perfis: readonly string[] }>)) {
      if (/^(pedido|orcamento)\.(criar|editar|cancelar|enviar|aprovar|rejeitar|recusar|criar_em_nome)/.test(acao)) expect(def.perfis, acao).not.toContain('promotor');
    }
  });

  it.runIf(TEM_ACAO_GESTAO)('5/21. a ação nova core.visita.registrar_gestao é só de supervisor e gerente (vendedor e promotor seguem no Campo)', () => {
    expect([...acoesCore['visita.registrar_gestao']!.perfis].sort()).toEqual(['gerente', 'supervisor']);
  });
});

describe('T-0187 — funções puras do pedido em nome (modulo-vendedor)', () => {
  it.runIf(typeof nivelMinimoDoAutor === 'function')('17. nivelMinimoDoAutor (P4 A, RN-VEN-10): o pedido do supervisor nunca fica no nível dele; o do gerente nunca no do gerente', () => {
    const f = nivelMinimoDoAutor!;
    expect(f('supervisor')).not.toBe('supervisor');
    expect(f('supervisor')).not.toBe('vendedor');
    expect(['supervisor', 'vendedor']).not.toContain(f('gerente'));
    expect(f('gerente')).not.toBe('gerente');
  });
  it.runIf(typeof vendedorPadraoEmNome === 'function')('13. vendedorPadraoEmNome (RN-VEN-35, RN-CORE-04): o único vendedor ativo da equipe com o cliente na carteira; 0 ou 2 vendedores = null (campo vazio, "Escolher"); o promotor da carteira não conta (RN-PRO-01)', () => {
    const f = vendedorPadraoEmNome!;
    expect(f({ clienteId: 'c1', carteira: CARTEIRA, equipe: EQUIPE })).toBe('v1');
    expect(f({ clienteId: 'c2', carteira: CARTEIRA, equipe: EQUIPE })).toBeNull();
    expect(f({ clienteId: 'c3', carteira: CARTEIRA, equipe: EQUIPE })).toBeNull();
    expect(f({ clienteId: 'c4', carteira: CARTEIRA, equipe: EQUIPE })).toBeNull();
  });
  it.runIf(typeof opcoesEmNome === 'function')('14. opcoesEmNome (P3 A): só vendedores da equipe, em ordem alfabética, sem o autor, sem promotor e sem outra equipe; inativo desligado com "Saiu da equipe"; o gerente vê as equipes abaixo com o grupo', () => {
    const f = opcoesEmNome!;
    const sup = f({ autor: { id: 's1', perfil: 'supervisor' }, clienteId: 'c1', carteira: CARTEIRA, usuarios: EQUIPE, visiveis: new Set(['s1', 'v1', 'v2', 'v3', 'p1']) });
    expect(sup.map((o) => o.nome)).toEqual(['Ana', 'Bruno', 'Carla']);
    expect(sup.find((o) => o.id === 'v1')).toMatchObject({ da_carteira: true, desligado: false, motivo: null });
    expect(sup.find((o) => o.id === 'v2')).toMatchObject({ da_carteira: false, desligado: false });
    expect(sup.find((o) => o.id === 'v3')).toMatchObject({ desligado: true, motivo: 'Saiu da equipe' });
    const ger = f({ autor: { id: 'g1', perfil: 'gerente' }, clienteId: 'c1', carteira: CARTEIRA, usuarios: EQUIPE, visiveis: new Set(['v1', 'v2', 'v3', 'v9', 'p1', 's1']) });
    expect(ger.map((o) => o.id)).toEqual(['v1', 'v2', 'v3', 'v9']);
    expect(ger.find((o) => o.id === 'v9')!.grupo).toBe('Equipe Sul');
  });
  it.runIf(TEM_RODAPE_GESTAO)('12 (parcial, domínio do Core). rodapé da ficha no Gestão: com visita.registrar_gestao, Check-in e Pesquisa; sem ela, só Pesquisa; sem a Pesquisa, sem o botão dela (RN-CORE-51/13)', () => {
    expect(botoesDoRodapeCliente({ ...BASE_RODAPE, registraVisita: true })).toEqual({ checkin: true, checkout: false, pesquisa: true });
    expect(botoesDoRodapeCliente({ ...BASE_RODAPE, registraVisita: false })).toEqual({ checkin: false, checkout: false, pesquisa: true });
    expect(botoesDoRodapeCliente({ ...BASE_RODAPE, atendimentoAqui: true, registraVisita: false })).toEqual({ checkin: false, checkout: false, pesquisa: true });
    expect(botoesDoRodapeCliente({ ...BASE_RODAPE, temPesquisa: false, registraVisita: true })).toEqual({ checkin: true, checkout: false, pesquisa: false });
    // o Campo não passa registraVisita: segue como antes
    expect(botoesDoRodapeCliente(BASE_RODAPE)).toEqual({ checkin: true, checkout: false, pesquisa: true });
  });
  it.todo('12 (tela). o "Novo pedido" do rodapé só aparece com o Vendedor licenciado e pedido.criar_em_nome (extensão cliente.acoes/novo-pedido-em-nome, só Gestão; leitura do fonte em promotor-sem-pedido.test.ts) — conferir no aparelho (roteiro manual)');
  it.todo('1. a aba Rota do Gestão mostra só as paradas do supervisor, nunca as dos vendedores que estão no aparelho pelo sync — aguardando modulo-core (app/index.ts, filtro por usuario_id)');
});
