/**
 * T-0124 / RD-0001 — cartão "Meta de hoje" do Início (Campo e Gestão): valor × regra e rótulo × valor, sem banco (roda local e no CI).
 *
 * Defeito do teste de campo de 08/11/2026 (domingo): o cartão "META DE HOJE" mostrou R$ 553, que é o REALIZADO do mês
 * (meta R$ 180.000, faltam R$ 179.447). RN-CORE-26: meta do dia = (meta do mês − realizado até ontem) ÷ dias úteis restantes,
 * contando hoje, no calendário do tenant [`metas.dias_uteis_semana` = segunda a sábado]; em dia não útil NÃO há meta do dia.
 *
 * Cadeia exercitada de ponta (tudo REAL, nada copiado à mão):
 *   linhas do pull + cópia de GET /v1/core/inicio → `montarInicio` (modules/core/app/lib/inicio-local.ts, que chama o domain
 *   `metaDoDia` de modules/core/domain/meta-do-dia.ts) → `VisaoInicio` → componente `MetaDoMes`
 *   (apps/mobile/src/components/inicio.tsx, que usa `desenhoMetaDoMes` de apps/mobile/src/lib/inicio.ts) renderizado com
 *   react-dom/server (react-native e o kit simulados, como no teste de componente do shell).
 * O valor esperado sai de um ORÁCULO independente (`metaDoDiaPelaRegra`, escrito aqui a partir do texto da RN), nunca da
 * função que está sendo testada.
 *
 * M5 e M6 (o RD-0001) nasceram em `it.fails`, vermelhos antes da correção ("Meta de hoje" mostrando R$ 553 de R$ 180.000 no
 * mês em dia sem meta do dia). Voltaram para `it` em 08/11 com a correção do shell (engenheiro-apps: rótulo "Meta do mês" em
 * dia não útil), na mesma rodada.
 * RD-0002 (08/11, decisão do gerente R-20261108-161557): o cartão passa a ser SEMPRE "Meta do mês" ("R$ realizado do mês de
 * R$ meta do mês"); no dia útil a meta do dia da RN-CORE-26 aparece só na última linha, "Meta de hoje R$ X". O realizado de
 * hoje e o "Faltam … hoje" saíram do Início. M1, M2 e M8 foram atualizados para esses textos (recado R-20261108-171541).
 * Matriz e resultados: docs/testes/T-0124.md.
 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import type { Inicio, InicioUsuario, MetaSync, ParametroSync, VisaoInicio } from '../../modules/core/contracts';
import { montarInicio, type LinhasInicio } from '../../modules/core/app/lib/inicio-local';

vi.mock('react-native', async () => {
  const { createElement: ce } = await import('react');
  const h = (tag: string) => (p: { children?: import('react').ReactNode; testID?: string }) => ce(tag, p.testID ? { 'data-testid': p.testID } : {}, p.children);
  return { View: h('div'), Text: h('span'), Pressable: h('button'), StyleSheet: { create: <T,>(s: T) => s }, Platform: { OS: 'android' } };
});
vi.mock('@macuxi/ui/mobile', async () => {
  const { createElement: ce } = await import('react');
  const h = (tag: string) => (p: { children?: import('react').ReactNode; testID?: string }) => ce(tag, p.testID ? { 'data-testid': p.testID } : {}, p.children);
  return {
    colors: new Proxy({}, { get: () => '#000' }),
    fonte: new Proxy({}, { get: () => ({}) }),
    type: new Proxy({}, { get: () => ({}) }),
    initials: (n: string) => n.slice(0, 2),
    Cartao: h('section'),
    Icon: () => null,
    ProgressBar: ({ pct }: { pct: number }) => ce('progress', { value: pct, max: 100 }),
  };
});
// o componente importa a lib pelo alias do Metro (`@/lib/inicio`); aqui aponta para o arquivo real
vi.mock('@/lib/inicio', () => import('../../apps/mobile/src/lib/inicio'));

import { MetaDoMes } from '../../apps/mobile/src/components/inicio';

// ---------- oráculo da RN-CORE-26 (independente do domain) ----------
const SEG_A_SAB = [1, 2, 3, 4, 5, 6];
function diasUteisRestantesPelaRegra(hoje: string, semana = SEG_A_SAB): number {
  const [a, m] = hoje.split('-').map(Number) as [number, number];
  const ultimo = new Date(Date.UTC(a, m, 0)).getUTCDate();
  let n = 0;
  for (let d = Number(hoje.slice(8, 10)); d <= ultimo; d++) if (semana.includes(new Date(Date.UTC(a, m - 1, d, 12)).getUTCDay())) n++;
  return n;
}
const ehUtilPelaRegra = (hoje: string, semana = SEG_A_SAB) => semana.includes(new Date(`${hoje}T12:00:00Z`).getUTCDay());
/** RN-CORE-26: ⌈(meta − realizado até ontem) ÷ dias úteis restantes contando hoje⌉; null em dia não útil. */
function metaDoDiaPelaRegra(o: { hoje: string; meta: number; ateOntem: number; semana?: number[] }): number | null {
  if (!ehUtilPelaRegra(o.hoje, o.semana)) return null;
  return Math.max(0, Math.ceil((o.meta - o.ateOntem) / diasUteisRestantesPelaRegra(o.hoje, o.semana)));
}
/** Hoje no fuso do tenant (Manaus, UTC−4 o ano todo), conta própria. */
const hojeEmManaus = (agora: Date) => new Date(agora.getTime() - 4 * 3_600_000).toISOString().slice(0, 10);
/** "R$ 9.969" → 9969 (reais inteiros, como o cartão mostra). */
const reais = (s: string | null): number | null => (s && /R\$/.test(s) ? Number(s.replace(/[^\d]/g, '')) : null);

// ---------- dados ----------
const FUSO = 'America/Manaus';
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const ANA = id(1);
const BRUNO = id(2);
const SUP = id(9);
const base = { updated_at: '2026-11-08T10:00:00.000000Z', deleted_at: null, external_id: null };
const META_CAMPO = 18_000_000; // R$ 180.000 (caso do teste de campo)
const ATE_ONTEM_CAMPO = 55_300; // R$ 553
const meta = (usuario: string, periodo: string, indicador: MetaSync['indicador'], valor: number): MetaSync => ({ ...base, id: id(100 + valor % 800 + usuario.length), usuario_id: usuario, periodo, indicador, valor });
const usuario = (uid: string, nome: string, venda: InicioUsuario['venda_cents']): InicioUsuario => ({ usuario_id: uid, nome, perfil: 'vendedor', equipe_id: null, tipo_meta_venda: 'pedido', venda_cents: venda, positivacao: null });
const copia = (dia: string, usuarios: InicioUsuario[], escopo: Inicio['escopo'] = 'proprio'): Inicio => ({ dia, periodo: dia.slice(0, 7), calculado_em: `${dia}T14:00:00.000Z`, escopo, usuarios, metas_do_dia: [] });
const vazio: LinhasInicio = { metas: [], paradas: [], visitas: [], notificacoes: [], parametros: [], clientes: [] };

function visaoDaAna(agora: Date, o: { periodo?: string; metaMes?: number; venda?: InicioUsuario['venda_cents']; diaCopia?: string; parametros?: ParametroSync[] } = {}): VisaoInicio {
  const hoje = hojeEmManaus(agora);
  const periodo = o.periodo ?? hoje.slice(0, 7);
  return montarInicio(
    { ...vazio, metas: [meta(ANA, periodo, 'venda_cents', o.metaMes ?? META_CAMPO)], parametros: o.parametros ?? [] },
    copia(o.diaCopia ?? hoje, [usuario(ANA, 'Ana', o.venda === undefined ? { ate_ontem: ATE_ONTEM_CAMPO, hoje: 0 } : o.venda)]),
    [],
    { usuarioId: ANA, perfil: 'vendedor', fuso: FUSO, agora },
  );
}

// ---------- o cartão renderizado ----------
interface Cartao {
  html: string;
  rotulo: string | null;
  valor: string | null;
  de: string | null;
  apoio: string | null;
}
const limpo = (s: string | undefined) => (s === undefined ? null : s.replace(/\u00a0/g, ' ').replace(/&#x27;/g, "'"));
function cartao(v: VisaoInicio, equipe = false): Cartao {
  const html = limpo(renderToStaticMarkup(createElement(MetaDoMes, { metas: v.metas, pronto: v.meta_hoje, equipe })))!;
  return {
    html,
    rotulo: limpo(/data-testid="inicio\.meta"[^>]*><div><span>([^<]*)<\/span>/.exec(html)?.[1]),
    valor: limpo(/data-testid="inicio\.meta\.valor">([^<]*)</.exec(html)?.[1]),
    de: limpo(/data-testid="inicio\.meta\.valor">[^<]*<\/span><span>([^<]*)</.exec(html)?.[1]),
    apoio: limpo(/data-testid="inicio\.meta\.apoio">([^<]*)</.exec(html)?.[1]),
  };
}

/**
 * Rótulo × valor (regra permanente da T-0124):
 * - a linha "Meta de hoje R$ X" (apoio, RD-0002) só pode trazer a meta do DIA da RN-CORE-26 e não existe em dia não útil;
 * - um cartão rotulado "Meta de hoje…" (desenho anterior ao RD-0002) só pode mostrar como meta ("de R$ X") a meta do dia;
 *   em dia não útil, nenhum valor em R$ pode aparecer sob esse rótulo (não há meta do dia).
 */
function conferirRotuloValor(c: Cartao, metaDia: number | null) {
  if (metaDia === null) {
    expect(c.apoio ?? '', `linha "${c.apoio}" em dia sem meta do dia`).not.toMatch(/Meta de hoje/);
  } else if (c.apoio?.startsWith('Meta de hoje')) {
    expect(reais(c.apoio), `"${c.apoio}": a meta de hoje tem de ser a meta do dia da RN-CORE-26`).toBe(Math.round(metaDia / 100));
  }
  if (!c.rotulo?.startsWith('Meta de hoje')) return;
  if (metaDia === null) {
    expect(reais(c.valor), `"${c.rotulo}" mostrando ${c.valor} ${c.de ?? ''} em dia sem meta do dia`).toBeNull();
    expect(reais(c.de)).toBeNull();
  } else {
    expect(reais(c.de), `"${c.rotulo}": a meta mostrada (${c.de}) tem de ser a meta do dia da RN-CORE-26`).toBe(Math.round(metaDia / 100));
  }
}

describe('T-0124 / RD-0001 — "Meta de hoje": valor × regra (RN-CORE-26)', () => {
  it('M1. dia útil (terça 10/11, 9h em Manaus): cartão "Meta do mês" R$ 553 de R$ 180.000 e última linha "Meta de hoje R$ 9.969" = ⌈(180.000 − 553) ÷ 18⌉', () => {
    const agora = new Date('2026-11-10T13:00:00Z');
    const v = visaoDaAna(agora);
    const esperado = metaDoDiaPelaRegra({ hoje: '2026-11-10', meta: META_CAMPO, ateOntem: ATE_ONTEM_CAMPO })!;
    expect(diasUteisRestantesPelaRegra('2026-11-10')).toBe(18);
    expect(esperado).toBe(996_928);
    expect(v.hoje).toBe('2026-11-10');
    expect(v.dia_util).toBe(true);
    expect(v.metas[0]).toMatchObject({ indicador: 'venda_cents', situacao: 'a_cumprir', meta_dia: esperado, dias_uteis_restantes: 18, realizado_ate_ontem: ATE_ONTEM_CAMPO });
    expect(v.meta_hoje).toMatchObject({ meta_dia: esperado, faltam_hoje: esperado });
    const c = cartao(v);
    // rótulo × valor: "Meta do mês" mostra o realizado do MÊS (até ontem + hoje) de a meta do MÊS
    expect(c.rotulo).toBe('Meta do mês');
    expect(c.valor).toBe('R$ 553');
    expect(reais(c.valor)).toBe(Math.round((ATE_ONTEM_CAMPO + 0) / 100));
    expect(c.de).toBe('de R$ 180.000');
    expect(reais(c.de)).toBe(META_CAMPO / 100);
    // valor × regra: a meta de hoje é a da RN-CORE-26 e o "Faltam … hoje" saiu do Início
    expect(c.apoio).toBe('Meta de hoje R$ 9.969');
    expect(c.html).not.toMatch(/Faltam [^<]* hoje/);
    conferirRotuloValor(c, esperado);
  });

  it('M2. o realizado de HOJE não entra no "até ontem": vendeu R$ 1.240 hoje, o mês vai a R$ 1.793 e a meta de hoje continua R$ 9.969', () => {
    const v = visaoDaAna(new Date('2026-11-10T13:00:00Z'), { venda: { ate_ontem: ATE_ONTEM_CAMPO, hoje: 124_000 } });
    const esperado = metaDoDiaPelaRegra({ hoje: '2026-11-10', meta: META_CAMPO, ateOntem: ATE_ONTEM_CAMPO })!;
    expect(v.metas[0]!.meta_dia).toBe(esperado);
    const c = cartao(v);
    expect(c.rotulo).toBe('Meta do mês');
    // realizado do mês = até ontem + hoje = 553 + 1.240
    expect(c.valor).toBe('R$ 1.793');
    expect(reais(c.valor)).toBe(Math.round((ATE_ONTEM_CAMPO + 124_000) / 100));
    expect(c.de).toBe('de R$ 180.000');
    expect(c.apoio).toBe('Meta de hoje R$ 9.969');
    // o realizado de hoje e o "Faltam R$ 8.729 hoje" saíram do Início (RD-0002)
    expect(c.html).not.toContain('R$ 1.240');
    expect(c.html).not.toMatch(/Faltam [^<]* hoje/);
    conferirRotuloValor(c, esperado);
  });

  it('M3. calendário do tenant: com `metas.dias_uteis_semana` = segunda a sexta, a meta do dia usa 15 dias (e não 18)', () => {
    const parametros = [{ ...base, id: id(700), modulo: 'core', chave: 'metas.dias_uteis_semana', valor: [1, 2, 3, 4, 5] }] as ParametroSync[];
    const v = visaoDaAna(new Date('2026-11-10T13:00:00Z'), { parametros });
    const esperado = metaDoDiaPelaRegra({ hoje: '2026-11-10', meta: META_CAMPO, ateOntem: ATE_ONTEM_CAMPO, semana: [1, 2, 3, 4, 5] });
    expect(v.metas[0]).toMatchObject({ meta_dia: esperado, dias_uteis_restantes: 15 });
  });

  it('M4. dia não útil no domain (domingo 08/11): situação dia_nao_util, meta_dia nula, nada de "faltam hoje"', () => {
    const v = visaoDaAna(new Date('2026-11-08T18:00:00Z'));
    expect(metaDoDiaPelaRegra({ hoje: '2026-11-08', meta: META_CAMPO, ateOntem: ATE_ONTEM_CAMPO })).toBeNull();
    expect(v.dia_util).toBe(false);
    expect(v.metas[0]).toMatchObject({ situacao: 'dia_nao_util', meta_dia: null, realizado_ate_ontem: ATE_ONTEM_CAMPO, meta_mes: META_CAMPO });
    expect(v.meta_hoje).toMatchObject({ meta_dia: null, faltam_hoje: null });
  });

  it('M5. RD-0001 (domingo 08/11, 14h em Manaus): o cartão não pode mostrar o realizado do mês (R$ 553) como "Meta de hoje"; só a linha do mês', () => {
    const c = cartao(visaoDaAna(new Date('2026-11-08T18:00:00Z')));
    // linha do mês continua: R$ 553 de R$ 180.000
    expect(c.html).toContain('R$ 553');
    expect(c.html).toContain('R$ 180.000');
    expect(c.html).not.toMatch(/Faltam [^<]* hoje/);
    // antes da correção (08/11): rótulo "Meta de hoje", valor "R$ 553", "de R$ 180.000 no mês"
    conferirRotuloValor(c, null);
  });

  it('M6. RD-0001 na Gestão (domingo): "Meta de hoje da equipe" também não pode mostrar o realizado do mês da equipe', () => {
    const agora = new Date('2026-11-08T18:00:00Z');
    const v = montarInicio(
      { ...vazio, metas: [meta(ANA, '2026-11', 'venda_cents', 10_000_000), meta(BRUNO, '2026-11', 'venda_cents', 8_000_000)] },
      copia('2026-11-08', [usuario(ANA, 'Ana', { ate_ontem: 30_000, hoje: 0 }), usuario(BRUNO, 'Bruno', { ate_ontem: 25_300, hoje: 0 })], 'equipe'),
      [],
      { usuarioId: SUP, perfil: 'supervisor', fuso: FUSO, agora },
    );
    expect(v.metas[0]).toMatchObject({ situacao: 'dia_nao_util', meta_dia: null, realizado_ate_ontem: 55_300, meta_mes: 18_000_000 });
    const c = cartao(v, true);
    expect(c.html).toContain('R$ 180.000');
    conferirRotuloValor(c, null);
  });

  it('M7. fuso de Manaus: domingo 23h30 (segunda 03h30 em UTC) ainda é domingo — sem meta do dia', () => {
    const v = visaoDaAna(new Date('2026-11-09T03:30:00Z'));
    expect(v.hoje).toBe('2026-11-08');
    expect(v.dia_util).toBe(false);
    expect(v.metas[0]).toMatchObject({ situacao: 'dia_nao_util', meta_dia: null });
  });

  it('M8. fuso de Manaus: segunda 23h30 (terça 03h30 em UTC) ainda é segunda — 19 dias úteis restantes, não 18', () => {
    const v = visaoDaAna(new Date('2026-11-10T03:30:00Z'));
    expect(v.hoje).toBe('2026-11-09');
    const esperado = metaDoDiaPelaRegra({ hoje: '2026-11-09', meta: META_CAMPO, ateOntem: ATE_ONTEM_CAMPO });
    expect(v.metas[0]).toMatchObject({ situacao: 'a_cumprir', meta_dia: esperado, dias_uteis_restantes: 19 });
    const c = cartao(v);
    expect(c.apoio).toBe('Meta de hoje R$ 9.445');
    expect(c.apoio).toBe(`Meta de hoje R$ ${(Math.round(esperado! / 100)).toLocaleString('pt-BR')}`);
    conferirRotuloValor(c, esperado);
  });

  it('M9. virada de mês: 30/11 23h30 em Manaus (01/12 em UTC) ainda é novembro, último dia útil: meta do dia = tudo o que falta', () => {
    const v = visaoDaAna(new Date('2026-12-01T03:30:00Z'), { diaCopia: '2026-11-30' });
    expect(v.hoje).toBe('2026-11-30');
    expect(v.metas[0]).toMatchObject({ meta_dia: META_CAMPO - ATE_ONTEM_CAMPO, dias_uteis_restantes: 1 });
  });

  it('M10. virada de mês: 01/12 00h30 em Manaus, cópia de 30/11 — o realizado de novembro NÃO vai para dezembro (sem realizado até sincronizar)', () => {
    const agora = new Date('2026-12-01T04:30:00Z');
    const v = visaoDaAna(agora, { periodo: '2026-12', diaCopia: '2026-11-30', venda: { ate_ontem: 17_000_000, hoje: 900_000 } });
    expect(v.hoje).toBe('2026-12-01');
    expect(v.metas.find((m) => m.indicador === 'venda_cents')).toBeUndefined();
    expect(v.sem_realizado).toContain('venda_cents');
    // com a cópia de 01/12 (realizado zerado), meta do dia = ⌈180.000 ÷ 27⌉
    const v2 = visaoDaAna(agora, { periodo: '2026-12', venda: { ate_ontem: 0, hoje: 0 } });
    expect(diasUteisRestantesPelaRegra('2026-12-01')).toBe(27);
    expect(v2.metas[0]).toMatchObject({ meta_dia: metaDoDiaPelaRegra({ hoje: '2026-12-01', meta: META_CAMPO, ateOntem: 0 }), realizado_ate_ontem: 0 });
  });

  it('M11. meta do mês batida: mostra "batida", nunca valor negativo nem meta do dia', () => {
    const v = visaoDaAna(new Date('2026-11-10T13:00:00Z'), { venda: { ate_ontem: 18_500_000, hoje: 10_000 } });
    expect(v.metas[0]).toMatchObject({ situacao: 'mes_batido', meta_dia: 0 });
    const c = cartao(v);
    expect(c.html).toContain('batida');
    expect(c.html).not.toMatch(/-\s?R\$|R\$\s?-/);
  });
});
