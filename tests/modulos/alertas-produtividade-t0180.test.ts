/**
 * T-0180 (alertas de produtividade e Parâmetros › Alertas, v1.0.13): costura entre o Core e o Gestor, valor × regra (D1, D5, D6),
 * licença do módulo (RN-CORE-03) e permissão nas rotas novas. Os testes de unidade de cada regra ficam nos módulos; aqui fica o que
 * só aparece quando os dois PRs se encontram: o Gestor monta a tela e grava no parâmetro do Core, então os dois precisam falar o
 * MESMO contrato (`alertas.produtividade`, `inicio.parado_min` e a rota `PUT /core/parametros/parado-min`).
 * Vale nos dois estados do repositório: sem os PRs do T-0180 no main, cada bloco afirma que nada disso existe ainda.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { criarPermissoes, verificarAcao, PERFIS, type ModuloId } from '@macuxi/platform-sdk';
import { describe, expect, it } from 'vitest';
import { manifest as core } from '../../modules/core/manifest';
import { manifest as gestor } from '../../modules/gestor/manifest';
import { ALERTAS_CORE_T0180 as comCore, ALERTAS_GESTOR_T0180 as comGestor } from './apoio/estado-prs';

const RAIZ = join(__dirname, '..', '..');
const ler = (p: string) => readFileSync(join(RAIZ, p), 'utf8');
const TENANT = '0a000000-0000-4000-8000-0000000000aa';
type Qualquer = Record<string, unknown>;
type Schema = { safeParse: (v: unknown) => { success: boolean; error?: { issues: { path: (string | number)[] }[] } } };
type Rota = { metodo: string; caminho: string; acao?: string; superficie?: string };

/** Módulo carregado sem tipo: os nomes novos não existem no main antes dos PRs. */
const carregar = async (m: string): Promise<Qualquer> => (await import(/* @vite-ignore */ m)) as Qualquer;
const CONTRATOS_CORE = '../../modules/core/contracts';
const TELA_GESTOR = '../../modules/gestor/domain/produtividade-do-dia';
const quemPode = (manifestos: Parameters<typeof criarPermissoes>[0], acao: string, modulos: ModuloId[]) => {
  const p = criarPermissoes(manifestos);
  return PERFIS.filter((perfil) => verificarAcao({ id: 'x', tenant_id: TENANT, perfil, modulos }, p, acao).ok);
};
const hh = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

describe('T-0180 — D6: os padrões em todo lugar (valor × regra)', () => {
  if (!comCore) {
    it('antes do PR do modulo-core: o Core não declara a ação dos parâmetros de produtividade', () => {
      expect(Object.keys(core.acoes ?? {})).not.toContain('parametro.alertas_produtividade');
    });
    return;
  }

  it('Core: almoço 10 min antes; parado com gestor +30 min; sem check-in até 10:00; rota às 16:00; visita aberta 120 min; envio 4 h; teto 4', async () => {
    const c = await carregar(CONTRATOS_CORE);
    expect(c.PARAMETROS_ALERTAS_PRODUTIVIDADE_PADRAO).toEqual({
      fim_almoco: { ativa: true, antecedencia_min: 10, vendedor: true },
      parado_entre_visitas: { ativa: true, vendedor: true, gestor: true, gestor_depois_min: 30 },
      sem_checkin_inicio: { ativa: true, ate_min: 600, vendedor: true, gestor: true },
      rota_incompleta: { ativa: true, as_min: 960, vendedor: true },
      visita_aberta: { ativa: true, apos_min: 120, vendedor: true },
      envio_pendente: { ativa: true, apos_h: 4, vendedor: true },
      teto_lembretes_dia: 4,
    });
    // a tela abre sem configuração prévia e o padrão passa no próprio contrato
    expect((c.ParametrosAlertasProdutividadeSchema as Schema).safeParse(c.PARAMETROS_ALERTAS_PRODUTIVIDADE_PADRAO).success).toBe(true);
  });

  it('D5: almoço padrão da empresa 12:00 às 13:00; D1: "parado" 60 min num valor só (inicio.parado_min)', async () => {
    const c = await carregar(CONTRATOS_CORE);
    expect(c.ALMOCO_PADRAO_EMPRESA).toEqual({ inicio_min: 720, fim_min: 780 });
    expect(c.PARADO_MIN_PADRAO).toBe(60);
    expect(c.PARAMETRO_PARADO_MIN).toBe('inicio.parado_min');
    // o parâmetro de produtividade NÃO carrega o "parado" (D1: um valor num lugar só)
    expect(JSON.stringify(c.PARAMETROS_ALERTAS_PRODUTIVIDADE_PADRAO)).not.toContain('parado_min');
  });

  it('D1: o campo do "parado" sumiu do painel Parâmetros › Início do BKO', () => {
    expect(ler('modules/core/web/components/metas/inicio-parametros-panel.tsx')).not.toContain('data-testid="inicio-params.parado"');
  });

  if (!comGestor) return;

  it('Gestor: a tela mostra os MESMOS números do Core (10, +30, 10:00, 16:00, 120, 4 h, teto 4; parado 60)', async () => {
    const c = await carregar(CONTRATOS_CORE);
    const g = await carregar(TELA_GESTOR);
    const campos = g.CAMPOS_PRODUTIVIDADE as Record<string, { id: string; padrao: number | string }[]>;
    const padroes = (regra: string) => (campos[regra] ?? []).map((x) => x.padrao);
    const p = c.PARAMETROS_ALERTAS_PRODUTIVIDADE_PADRAO as Record<string, Record<string, number>>;
    // valores campo a campo, qualquer que seja o nome de cada lado
    expect(padroes('fim_almoco')).toEqual([p.fim_almoco!.antecedencia_min]);
    expect(padroes('parado_entre_visitas')).toEqual([c.PARADO_MIN_PADRAO, p.parado_entre_visitas!.gestor_depois_min]);
    expect(padroes('sem_checkin_inicio')).toEqual([hh(p.sem_checkin_inicio!.ate_min!)]);
    expect(padroes('rota_incompleta')).toEqual([hh(p.rota_incompleta!.as_min!)]);
    expect(padroes('visita_aberta')).toEqual([p.visita_aberta!.apos_min]);
    expect(padroes('envio_pendente')).toEqual([p.envio_pendente!.apos_h]);
    expect((g.PARAMETROS_PRODUTIVIDADE_PADRAO as Qualquer).teto_lembretes_dia).toBe((p as Qualquer).teto_lembretes_dia);
  });
});

describe('T-0180 — o Gestor grava no contrato do Core (alertas.produtividade e parado-min)', () => {
  if (!comCore || !comGestor) {
    it('sem os dois PRs (core e gestor) no main, a costura ainda não existe', () => {
      expect(comCore && comGestor).toBe(false);
    });
    return;
  }

  it('o padrão que a tela do Gestor envia no PUT passa no schema estrito do Core (senão o Salvar dá 400)', async () => {
    const c = await carregar(CONTRATOS_CORE);
    const g = await carregar(TELA_GESTOR);
    const r = (c.ParametrosAlertasProdutividadeSchema as Schema).safeParse(g.PARAMETROS_PRODUTIVIDADE_PADRAO);
    expect(r.error?.issues.map((i) => i.path.join('.') || '(raiz)') ?? []).toEqual([]);
  });

  it('o valor salvo no Core volta para a tela: a leitura do Gestor entende o JSON do Core (teto salvo = 5 aparece 5)', async () => {
    const c = await carregar(CONTRATOS_CORE);
    const g = await carregar(TELA_GESTOR);
    const salvo = { ...(c.PARAMETROS_ALERTAS_PRODUTIVIDADE_PADRAO as Qualquer), teto_lembretes_dia: 5, visita_aberta: { ativa: false, apos_min: 90, vendedor: true } };
    // a tela lê com `{ ...PADRAO_DO_GESTOR, ...resposta }` (modules/gestor/web/lib/parametros-alertas.ts) e mostra `regras.<regra>`
    const lido = { ...(g.PARAMETROS_PRODUTIVIDADE_PADRAO as Qualquer), ...salvo } as { regras?: Record<string, Qualquer>; visita_aberta?: Qualquer };
    const visita = (lido.regras?.visita_aberta ?? lido.visita_aberta) as Qualquer;
    expect(visita.ativa).toBe(false);
    expect(Object.values(visita)).toContain(90);
  });

  it('as faixas da tela são as do Core (fim do almoço 5 a 30; gestor 5 a 240; visita aberta 30 a 480; envio 1 a 48 h; teto 1 a 10)', async () => {
    const c = await carregar(CONTRATOS_CORE);
    const g = await carregar(TELA_GESTOR);
    const F = c.FAIXAS_ALERTAS_PRODUTIVIDADE as Record<string, { min: number; max: number }>;
    const campos = g.CAMPOS_PRODUTIVIDADE as Record<string, { min: number; max: number }[]>;
    const faixa = (regra: string, i: number) => ({ min: campos[regra]![i]!.min, max: campos[regra]![i]!.max });
    expect(faixa('fim_almoco', 0)).toEqual(F.antecedencia_min);
    expect(faixa('parado_entre_visitas', 1)).toEqual(F.gestor_depois_min);
    expect(faixa('visita_aberta', 0)).toEqual(F.visita_aberta_min);
    expect(faixa('envio_pendente', 0)).toEqual(F.envio_pendente_h);
    expect({ min: g.TETO_LEMBRETES_MIN, max: g.TETO_LEMBRETES_MAX }).toEqual(F.teto_lembretes_dia);
  });

  it('D1: a tela grava o "parado" pela rota própria do Core (PUT /core/parametros/parado-min), não pelo PUT do Início', () => {
    const web = ler('modules/gestor/web/lib/parametros-alertas.ts');
    expect(web).toContain('parametros/parado-min');
    expect(web).not.toMatch(/body: \{ dias_uteis_semana/);
  });

  it('o Gestor usa o tipo e o padrão do contrato do Core (sem espelho local)', () => {
    expect(ler('modules/gestor/domain/produtividade-do-dia.ts')).not.toContain('export interface ParametrosAlertasProdutividade');
  });
});

describe('T-0180 — permissão e licença nas rotas novas (RN-CORE-03, RN-CORE-26, RN-CORE-44)', () => {
  if (!comCore) {
    it('antes do PR do modulo-core: não há rota de parâmetros de produtividade nem de jornada', () => {
      expect(comCore).toBe(false);
    });
    return;
  }

  it('Core: as rotas novas existem, são do BKO e usam a ação certa', async () => {
    const a = await carregar('../../modules/core/api/parametros-alertas');
    const j = await carregar('../../modules/core/api/parametros-jornada');
    const rotas = [...(a.rotasDeParametrosAlertas as Rota[]), ...(j.rotasDeParametrosJornada as Rota[])];
    expect(rotas.map((r) => `${r.metodo} ${r.caminho} ${r.acao} ${r.superficie}`)).toEqual([
      'GET parametros/alertas-produtividade parametro.alertas_produtividade bko',
      'PUT parametros/alertas-produtividade parametro.alertas_produtividade bko',
      'PUT parametros/parado-min parametro.alertas_produtividade bko',
      'GET parametros/jornada parametro.inicio bko',
      'PUT parametros/jornada parametro.inicio bko',
    ]);
  });

  it('Core: só analista e admin; sem o módulo licenciado, ninguém (RN-CORE-03)', () => {
    for (const acao of ['parametro.alertas_produtividade', 'parametro.inicio']) {
      expect(quemPode([core], acao, ['core'])).toEqual(['analista', 'admin']);
      expect(quemPode([core], acao, [])).toEqual([]);
    }
  });

  if (!comGestor) return;

  it('Parâmetros › Alertas tem o mesmo público nas duas metades da tela (alerta_regra.gerenciar = parametro.alertas_produtividade)', () => {
    const modulos: ModuloId[] = ['core', 'gestor'];
    expect(quemPode([core, gestor], 'alerta_regra.gerenciar', modulos)).toEqual(quemPode([core, gestor], 'parametro.alertas_produtividade', modulos));
  });

  it('sem o Gestor licenciado, as regras da equipe não se editam (RN-CORE-03); a Produtividade do dia continua com o Core', () => {
    expect(quemPode([core, gestor], 'alerta_regra.gerenciar', ['core'])).toEqual([]);
    expect(quemPode([core, gestor], 'parametro.alertas_produtividade', ['core'])).toEqual(['analista', 'admin']);
  });
});
