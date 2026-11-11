/**
 * T-0001 critério 1 — S0-002, S0-003, S0-005 (versão estática e rápida; roda sem a Fase M na máquina).
 * A prova por execução e POR NOME é `tests/scripts/comparar-testes-fase-m.mjs` (relatórios JSON do Vitest);
 * este teste trava o mapa origem → destino (desenho T-0001 §3–§8) para que nenhum caso suma depois.
 *
 * Referência: tests/fundacao/fase-m/referencia.json — 277 casos da Fase M executados numa CÓPIA
 * descartável da árvore de trabalho (S0-001), nunca na pasta original.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const raiz = resolve(__dirname, '..', '..');

interface CasoRef {
  arquivo: string;
  describes: string[];
  titulo: string;
  status: string;
  literal: boolean;
}
const referencia = JSON.parse(readFileSync(join(__dirname, 'fase-m', 'referencia.json'), 'utf8')) as {
  total: number;
  casos: CasoRef[];
};

/**
 * Mapa executável: arquivo de origem (Fase M) → [destino, nº de casos da Fase M nesse destino].
 * No aceite da T-0001 (Fase D) cada destino tinha SÓ casos da Fase M. Depois disso os módulos evoluem:
 * o destino pode GANHAR casos (contagem >= n), mas nenhum título da Fase M some sem estar em
 * SUBSTITUIDOS_POR_DECISAO com a decisão que mudou o comportamento e o título do teste que o substitui.
 */
const MAPA: Record<string, [string, number][]> = {
  'packages/domain/src/money.test.ts': [['packages/comum/src/money.test.ts', 11]],
  'packages/domain/src/calendar.test.ts': [['packages/comum/src/calendar.test.ts', 5]],
  'packages/domain/src/analytics.test.ts': [['modules/core/domain/analytics.test.ts', 6]],
  'packages/domain/src/incentive.test.ts': [['modules/core/domain/incentive.test.ts', 20]],
  'packages/domain/src/visit.test.ts': [['modules/core/domain/visit.test.ts', 12]],
  'packages/domain/src/route.test.ts': [['modules/core/domain/route.test.ts', 6]],
  'packages/domain/src/order.test.ts': [['modules/vendedor/domain/order.test.ts', 32]],
  'packages/contracts/src/index.test.ts': [
    ['modules/core/contracts/index.test.ts', 1],
    ['modules/vendedor/contracts/index.test.ts', 5],
  ],
  'apps/web/lib/format.test.ts': [['packages/ui/src/web/format.test.ts', 21]],
  'apps/web/lib/rules.test.ts': [
    ['packages/ui/src/web/tones.test.ts', 11],
    ['modules/core/web/lib/rules.test.ts', 8],
  ],
  'apps/web/lib/api.test.ts': [['packages/platform-sdk/src/web/api.test.ts', 4]],
  'apps/web/lib/routes.test.ts': [['modules/core/web/lib/routes.test.ts', 40]],
  'apps/web/lib/plan-form.test.ts': [['modules/core/web/lib/plan-form.test.ts', 11]],
  'apps/web/lib/policy-form.test.ts': [['modules/vendedor/web/lib/policy-form.test.ts', 7]],
  'apps/web/lib/csv.test.ts': [['modules/vendedor/web/lib/csv.test.ts', 4]],
  'apps/web/lib/audit.test.ts': [['apps/web/lib/audit.test.ts', 7]],
  'apps/mobile/src/lib/helpers.test.ts': [
    ['apps/mobile/src/lib/api-url.test.ts', 2],
    ['modules/core/app/lib/rota.test.ts', 5],
    ['modules/vendedor/app/lib/helpers.test.ts', 6],
  ],
  // T-0029 E5 (engenheiro-software): os casos de datas no fuso foram para `@macuxi/comum/fuso`
  'apps/mobile/src/lib/time.test.ts': [['packages/comum/src/fuso.test.ts', 4]],
  'apps/mobile/src/lib/visit.test.ts': [['modules/core/app/lib/visit.test.ts', 13]],
  // RD-0135 (corretor R-20261111-150701): "subtotal − desconto = total" só conferia a própria fixture e saiu; 10 → 9
  'apps/mobile/src/lib/order-pdf.test.ts': [['modules/vendedor/app/lib/order-pdf.test.ts', 9]],
  'apps/mobile/src/lib/order-prefill.test.ts': [['modules/vendedor/app/lib/order-prefill.test.ts', 2]],
  'apps/mobile/src/lib/outbox.test.ts': [
    ['packages/platform-sdk/src/motor-sync.fase-m.test.ts', 4],
    ['modules/vendedor/app/lib/pedidos.test.ts', 2],
  ],
  'apps/mock-api/test/api.test.ts': [['apps/mock-api/test/api.test.ts', 18]],
};

/**
 * Casos da Fase M cujo comportamento mudou por decisão registrada depois da T-0001.
 * [origem, título da Fase M] → título do teste que o substitui no destino e a decisão.
 * `removido`: o caso saiu sem teste próprio no lugar (o `novo` cobre a regra); a contagem do MAPA desconta esses casos.
 */
const SUBSTITUIDOS_POR_DECISAO: { origem: string; titulo: string; novo: string; decisao: string; removido?: true }[] = [
  {
    origem: 'packages/domain/src/order.test.ts',
    titulo: 'integrado explica que é preciso duplicar',
    novo: 'RN-VEN-31 / matriz §2: integrado mostra a mensagem de cancelar no ERP e continua duplicável',
    decisao: 'doc 03 §4 — a partir de enviado, cancelar só no ERP ("Pedido já enviado ao ERP — cancele no ERP"); R-20261031-102322',
  },
  {
    origem: 'apps/mobile/src/lib/helpers.test.ts',
    titulo: 'prioriza EXPO_PUBLIC_API_URL e normaliza /v1',
    novo: 'padrão do build: EXPO_PUBLIC_API_URL completado com /v1 (não foi digitado)',
    decisao: 'R-20261101-065547-alexandre — endereço digitado fica exatamente como digitado; só o padrão do build (EXPO_PUBLIC_API_URL) é completado com /v1',
  },
  {
    origem: 'apps/mobile/src/lib/order-pdf.test.ts',
    titulo: 'pedido excluído mostra "Excluído" e o motivo',
    novo: 'recusa aparece só no Histórico, com o texto vindo do histórico',
    decisao: 'PDF v3 do dono do produto (R-20261111-090118 / R-20261111-094836) e RD-0134 — o PDF não tem mais o campo do motivo; a recusa aparece só no Histórico do escritório',
  },
  {
    origem: 'apps/mobile/src/lib/order-pdf.test.ts',
    titulo: 'mostra subtotal de tabela, desconto em R$ e %, total, alçada, status, motivo e histórico',
    novo: 'mostra subtotal de tabela, desconto em R$ e %, total e histórico',
    decisao: 'T-0159 e RD-0135 (corretor R-20261111-150701) — o PDF do escritório não traz mais alçada, status nem motivo (avisos só em Alertas, eventos só no Histórico; PDF v3, R-20261111-090118)',
  },
  {
    origem: 'apps/mobile/src/lib/order-pdf.test.ts',
    titulo: 'subtotal − desconto = total',
    novo: 'mostra subtotal de tabela, desconto em R$ e %, total e histórico',
    decisao: 'RD-0135 (corretor R-20261111-150701) — o teste só conferia a própria fixture, sem chamar código, e foi apagado; subtotal R$ 1.034,00, desconto − R$ 72,38 e total R$ 961,62 no HTML gerado seguem cobertos pelo caso novo',
    removido: true,
  },
];
const substituido = (arquivo: string, titulo: string) => SUBSTITUIDOS_POR_DECISAO.some((x) => x.origem === arquivo && x.titulo === titulo);

const destinos = Object.values(MAPA).flat();

function contagemEstatica(arquivos: string[]): Map<string, { casos: number; avisos: string[] }> {
  const r = spawnSync(process.execPath, [join(raiz, 'scripts', 'contar-testes.mjs'), ...arquivos.map((a) => join(raiz, a, '..')), '--json'], {
    cwd: raiz,
    encoding: 'utf8',
  });
  const saida = JSON.parse(r.stdout) as { arquivos: { arquivo: string; casos: number; avisos: string[] }[] };
  return new Map(saida.arquivos.map((a) => [a.arquivo, { casos: a.casos, avisos: a.avisos }]));
}

describe('S0-001 — referência da Fase M', () => {
  it('277 casos em 23 arquivos, todos verdes na cópia', () => {
    expect(referencia.total).toBe(277);
    expect(new Set(referencia.casos.map((c) => c.arquivo)).size).toBe(23);
    expect(referencia.casos.filter((c) => c.status !== 'passed')).toEqual([]);
  });

  it('o mapa cobre os 23 arquivos e a soma por arquivo bate com a referência', () => {
    const porOrigem = new Map<string, number>();
    for (const c of referencia.casos) porOrigem.set(c.arquivo, (porOrigem.get(c.arquivo) ?? 0) + 1);
    expect(Object.keys(MAPA).sort()).toEqual([...porOrigem.keys()].sort());
    for (const [origem, dests] of Object.entries(MAPA)) {
      const removidos = SUBSTITUIDOS_POR_DECISAO.filter((x) => x.origem === origem && x.removido).length;
      expect(dests.reduce((s, [, n]) => s + n, 0), origem).toBe((porOrigem.get(origem) ?? 0) - removidos);
    }
  });
});

describe('S0-002 / S0-005 — os 277 estão nos novos locais', () => {
  const estatico = contagemEstatica(destinos.map(([d]) => d));

  it.each(destinos)('%s tem ao menos %i casos (os da Fase M; contagem estática com it.each expandido)', (destino, n) => {
    expect(estatico.get(destino)?.casos, destino).toBeGreaterThanOrEqual(n);
  });

  it('soma nos destinos >= 277', () => {
    expect(destinos.reduce((s, [d]) => s + (estatico.get(d)?.casos ?? 0), 0)).toBeGreaterThanOrEqual(277);
  });

  it('todo título literal da Fase M aparece no(s) destino(s) do seu arquivo de origem (ou foi substituído por decisão registrada)', () => {
    const faltando: string[] = [];
    for (const c of referencia.casos.filter((x) => x.literal)) {
      const fontes = (MAPA[c.arquivo] ?? []).map(([d]) => readFileSync(join(raiz, d), 'utf8'));
      if (!fontes.some((f) => f.includes(c.titulo)) && !substituido(c.arquivo, c.titulo)) faltando.push(`${c.arquivo}: ${c.titulo}`);
    }
    expect(faltando).toEqual([]);
  });

  it.each(SUBSTITUIDOS_POR_DECISAO.map((x) => [x.titulo, x]))('substituído por decisão: "%s" — o teste novo existe no destino', (_t, x) => {
    const ref = referencia.casos.find((c) => c.arquivo === x.origem && c.titulo === x.titulo);
    expect(ref, 'o caso precisa existir na referência da Fase M').toBeDefined();
    expect(x.decisao).toMatch(/R-\d{8}-\d{6}/);
    const fontes = (MAPA[x.origem] ?? []).map(([d]) => readFileSync(join(raiz, d), 'utf8'));
    expect(fontes.some((f) => f.includes(x.novo)), x.novo).toBe(true);
  });

  it('cada describe de origem continua existindo no destino (exceção registrada: outbox → "outbox (pedidos)")', () => {
    const faltando: string[] = [];
    for (const c of referencia.casos) {
      const fontes = (MAPA[c.arquivo] ?? []).map(([d]) => readFileSync(join(raiz, d), 'utf8')).join('\n');
      for (const d of c.describes) if (!fontes.includes(`'${d}`) && !fontes.includes(`"${d}`)) faltando.push(`${c.arquivo}: ${d}`);
    }
    expect([...new Set(faltando)]).toEqual([]);
  });
});

describe('S0-003 — nada mascarado nos destinos', () => {
  it.each(destinos.map(([d]) => [d]))('%s sem .skip/.only/.todo/xit', (destino) => {
    const fonte = readFileSync(join(raiz, destino), 'utf8');
    expect(fonte).not.toMatch(/\b(it|test|describe)\.(skip|only|todo)\b|\bx(it|describe)\s*\(/);
  });
});
