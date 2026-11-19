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
import * as dominioVendedor from '../../modules/vendedor/domain';

const TEM_PORTAO_NOVO = 'APP_RASTREADO_DO_CARGO' in contratosCore;
const acoesCore = manifestoCore.acoes as Readonly<Record<string, { perfis: readonly string[] } | undefined>>;
const TEM_ACAO_GESTAO = acoesCore['visita.registrar_gestao'] !== undefined;
const nivelMinimoDoAutor = (dominioVendedor as Record<string, unknown>).nivelMinimoDoAutor as ((perfil: string) => string) | undefined;

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
  it.todo('13. vendedorPadraoEmNome: o único vendedor ativo da equipe com o cliente na carteira; 0 ou 2 vendedores = null (campo vazio, "Escolher") — aguardando modulo-vendedor (domain/pedido-em-nome.ts; assinatura final)');
  it.todo('14. opcoesEmNome: só vendedores ativos da equipe, em ordem alfabética, sem o autor, sem promotor e sem outra equipe; "Saiu da equipe" desligado; o gerente agrupa por equipe — aguardando modulo-vendedor');
  it.todo('12. rodapé da ficha no Gestão: Check-in, Pesquisa e Novo pedido; sem a licença da Pesquisa, dois botões; sem o Vendedor ou sem pedido.criar_em_nome, sem "Novo pedido" — aguardando modulo-core (cliente.tsx) e modulo-vendedor (item cliente.acoes)');
  it.todo('1. a aba Rota do Gestão mostra só as paradas do supervisor, nunca as dos vendedores que estão no aparelho pelo sync — aguardando modulo-core (app/index.ts, filtro por usuario_id)');
});
