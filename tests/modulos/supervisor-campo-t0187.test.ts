/**
 * T-0187 (v1.0.16) — supervisor em campo no Gestão: portão do rastreamento (RN-CORE-13), permissões dos manifestos e funções puras
 * do pedido em nome, sem banco. Desenho: docs/desenho/T-0187.md §1.2, §1.4, §2 e §4. Matriz: docs/testes/T-0187.md.
 *
 * Convenção: `it` = vale no `main` hoje; `it.runIf(<código entregue>)` = liga sozinho quando o símbolo do dono chegar ao `main`
 * (portão novo do modulo-core, ação `visita.registrar_gestao`, funções puras do modulo-vendedor e do modulo-gestor); `it.todo` = só na tela do aparelho (roteiro manual da matriz).
 *
 * Instante fixo: qua 18/11/2026 11h em Manaus (15h UTC), dia útil dentro do expediente padrão (seg–sex 08h–18h).
 */
import * as contratosCore from '@macuxi/core/contracts';
import { PARAMETROS_RASTREAMENTO_PADRAO, podeRastrear } from '@macuxi/core/contracts';
import { manifest as manifestoCore } from '@macuxi/core/manifest';
import { manifest as manifestoVendedor } from '@macuxi/vendedor/manifest';
import { describe, expect, it } from 'vitest';
import * as dominioCore from '../../modules/core/domain';
import * as dominioGestor from '../../modules/gestor/domain';
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
  | ((e: { clienteId: string; carteira: readonly VinculoCarteira[]; usuarios: readonly UsuarioEquipe[] }) => OpcaoEmNome[])
  | undefined;
type MembroEmNome = { usuario_id: string; nome: string; perfil: string; equipe_id: string | null; equipe_nome: string | null; ativo: boolean };
const equipeEmNomeDosMembros = (dominioVendedor as Record<string, unknown>).equipeEmNomeDosMembros as
  | ((e: { autor: { id: string; perfil: string }; membros: readonly MembroEmNome[] }) => UsuarioEquipe[])
  | undefined;
type EntradaRodape = { temPesquisa: boolean; atendimentoAqui: boolean; checkinPermitido: boolean; visitadoHoje: boolean; registraVisita?: boolean };
const botoesDoRodapeCliente = dominioCore.botoesDoRodapeCliente as unknown as (e: EntradaRodape) => { checkin: boolean; checkout: boolean; pesquisa: boolean };
const BASE_RODAPE: EntradaRodape = { temPesquisa: true, atendimentoAqui: false, checkinPermitido: true, visitadoHoje: false };
/** O Core entregou o `registraVisita` (Gestão sem `visita.registrar_gestao` = sem Check-in e sem Checkout). */
const TEM_RODAPE_GESTAO = botoesDoRodapeCliente({ ...BASE_RODAPE, registraVisita: false }).checkin === false;

type Membro = { id: string; nome: string; perfil: string; superior_id: string | null; ativo: boolean };
const visitaContaParaCampo = (dominioGestor as Record<string, unknown>).visitaContaParaCampo as ((m: readonly Membro[], u: string) => boolean) | undefined;
const pessoasDoTrajeto = (dominioGestor as Record<string, unknown>).pessoasDoTrajeto as ((e: { viewer: { id: string; perfil: string }; membros: readonly Membro[] }) => Membro[]) | undefined;
/** Massa do Gestor: g1 (gerente) > s1 (supervisor) > v1, v2 (vendedores), p1 (promotor), v3 inativo. */
const ROSTER: Membro[] = [
  { id: 'g1', nome: 'Gil Gerente', perfil: 'gerente', superior_id: null, ativo: true },
  { id: 's1', nome: 'Sara Supervisora', perfil: 'supervisor', superior_id: 'g1', ativo: true },
  { id: 'v2', nome: 'Bruno', perfil: 'vendedor', superior_id: 's1', ativo: true },
  { id: 'v1', nome: 'Ana', perfil: 'vendedor', superior_id: 's1', ativo: true },
  { id: 'p1', nome: 'Paulo', perfil: 'promotor', superior_id: 's1', ativo: true },
  { id: 'v3', nome: 'Caio', perfil: 'vendedor', superior_id: 's1', ativo: false },
];

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
  // v1.0.16: o filtro (só vendedor, sem o autor) passou ao `equipeEmNomeDosMembros`, e o escopo (sem outra equipe) vem do slot
  // `pedido.equipe_em_nome` do Gestor; o `opcoesEmNome` ordena e marca. O critério vale para a cadeia que a tela usa
  // (modules/vendedor/app/screens/new-order-screen.tsx).
  it.runIf(typeof opcoesEmNome === 'function' && typeof equipeEmNomeDosMembros === 'function')('14. equipeEmNomeDosMembros + opcoesEmNome (P3 A): só vendedores do escopo do slot, em ordem alfabética, sem o autor e sem promotor; inativo desligado com "Saiu da equipe"; o gerente vê as equipes abaixo com o grupo', () => {
    const membro = (u: UsuarioEquipe): MembroEmNome => ({ usuario_id: u.id, nome: u.nome, perfil: u.perfil, equipe_id: u.grupo ? `eq-${u.grupo}` : null, equipe_nome: u.grupo ?? null, ativo: u.ativo });
    const cadeia = (autor: { id: string; perfil: string }, escopo: readonly string[]) =>
      opcoesEmNome!({ clienteId: 'c1', carteira: CARTEIRA, usuarios: equipeEmNomeDosMembros!({ autor, membros: EQUIPE.filter((u) => escopo.includes(u.id)).map(membro) }) });
    // o slot do supervisor s1 traz a equipe dele (com ele mesmo e o promotor); o v9 é de outra equipe e não vem
    const sup = cadeia({ id: 's1', perfil: 'supervisor' }, ['s1', 'v1', 'v2', 'v3', 'p1']);
    expect(sup.map((o) => o.nome)).toEqual(['Ana', 'Bruno', 'Carla']);
    expect(sup.every((o) => o.grupo === null)).toBe(true);
    expect(sup.find((o) => o.id === 'v1')).toMatchObject({ da_carteira: true, desligado: false, motivo: null });
    expect(sup.find((o) => o.id === 'v2')).toMatchObject({ da_carteira: false, desligado: false });
    expect(sup.find((o) => o.id === 'v3')).toMatchObject({ desligado: true, motivo: 'Saiu da equipe' });
    // o slot do gerente g1 traz as equipes abaixo
    const ger = cadeia({ id: 'g1', perfil: 'gerente' }, ['v1', 'v2', 'v3', 'v9', 'p1', 's1']);
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
  it.todo('1 (tela). a aba Rota do Gestão (rota-gestao, ação visita.registrar_gestao) mostra só as paradas do supervisor, nunca as dos vendedores que estão no aparelho pelo sync — filtro na tela (react-native); roteiro manual em docs/testes/T-0187.md');
});

describe('T-0187 — visita de apoio e trajeto visível só acima (modulo-gestor)', () => {
  it.runIf(typeof visitaContaParaCampo === 'function')('6. RN-GES-05 (P2 A): o check-in de supervisor ou gerente não conta na cobertura nem na meta de visitas; o do vendedor e o do promotor contam; quem não está no cadastro conta', () => {
    const f = visitaContaParaCampo!;
    expect(['g1', 's1', 'v1', 'p1', 'fora-do-cadastro'].map((u) => [u, f(ROSTER, u)])).toEqual([
      ['g1', false],
      ['s1', false],
      ['v1', true],
      ['p1', true],
      ['fora-do-cadastro', true],
    ]);
  });
  it.runIf(typeof pessoasDoTrajeto === 'function')('9/10. RN-CORE-13: o supervisor escolhe só vendedores e promotores ativos; o gerente vê também o supervisor; ninguém vê o próprio trajeto', () => {
    const ids = (viewer: { id: string; perfil: string }) => pessoasDoTrajeto!({ viewer, membros: ROSTER }).map((m) => m.id);
    expect(ids({ id: 's1', perfil: 'supervisor' })).toEqual(['v1', 'v2', 'p1']);
    expect(ids({ id: 'g1', perfil: 'gerente' })).toEqual(['v1', 'v2', 'p1', 's1']);
    expect(ids({ id: 'g1', perfil: 'gerente' })).not.toContain('g1');
    expect(ids({ id: 's1', perfil: 'supervisor' })).not.toContain('s1');
  });
});
