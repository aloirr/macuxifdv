/**
 * Catálogo de exemplo dos planos (spec docs/design/telas/portal-config-enxuto.md §11.3 e §11.9; seed do banco-dados, ADR 0047):
 * Light, PME, Enterprise e Corporate, com os números da tabela da spec. Só para teste e para o modo falso; a tela lê sempre o
 * `GET ROTA_PORTAL_PLANOS`. Ficha de exemplo: Distribuidora Uma, PME em teste, Promotor 3 e Pesquisa 10 (simulação 03-aba-empresa).
 */
import { ITENS_CONTADOS, licencasContratadas, PlanoSchema, valorDaAssinatura, type AdicionalContratado, type FichaAssinatura, type ItemContado, type Plano } from '@macuxi/platform-sdk';

const ADICIONAIS_DO_PLANO = [
  { adicional: 'promotor' as const, preco_unitario_centavos: 8_000, incluidos: 0 },
  { adicional: 'pesquisa' as const, preco_unitario_centavos: 1_000, incluidos: 0 },
  { adicional: 'treinamento' as const, preco_unitario_centavos: 1_000, incluidos: 0 },
];

const plano = (n: number, codigo: string, nome: string, preco: number, vendedor: number, gestor: number, bko: number): Plano =>
  PlanoSchema.parse({
    id: `7c1a5f00-0000-4000-8000-00000000000${n}`,
    codigo,
    nome,
    ordem: n,
    preco_mensal_centavos: preco,
    licencas: { vendedor, gestor, bko, promotor: 0 },
    modulos: ['core', 'catalogo', 'vendedor', 'gestor', 'integracao'],
    adicionais: ADICIONAIS_DO_PLANO,
    meses_gratis_anual: 2,
    dias_teste: 14,
    ativo: true,
  });

export const PLANOS_EXEMPLO: readonly Plano[] = Object.freeze([
  plano(1, 'light', 'Light', 61_000, 10, 1, 1),
  plano(2, 'pme', 'PME', 119_700, 20, 2, 3),
  plano(3, 'enterprise', 'Enterprise', 171_900, 30, 3, 5),
  plano(4, 'corporate', 'Corporate', 259_250, 50, 5, 5),
]);

export const planoExemplo = (codigo: string): Plano => {
  const p = PLANOS_EXEMPLO.find((x) => x.codigo === codigo);
  if (!p) throw new Error(`plano de exemplo ausente: ${codigo}`);
  return p;
};

/** Ficha montada como a API monta (licenças na ordem de `ITENS_CONTADOS`, valor pelo `valorDaAssinatura`). */
export function fichaExemplo(o: {
  tenant_id: string;
  plano?: string;
  ciclo?: 'mensal' | 'anual';
  adicionais?: AdicionalContratado[];
  emUso?: Partial<Record<ItemContado, number>>;
  teste_ate?: string | null;
  paga?: boolean;
}): FichaAssinatura {
  const p = planoExemplo(o.plano ?? 'pme');
  const adicionais = o.adicionais ?? [
    { adicional: 'promotor', quantidade: 3 },
    { adicional: 'pesquisa', quantidade: 10 },
  ];
  const ciclo = o.ciclo ?? 'mensal';
  const contratadas = licencasContratadas(p, adicionais);
  const emUso = o.emUso ?? { vendedor: 14, gestor: 2, bko: 1, promotor: 3, pesquisa: 6 };
  return {
    tenant_id: o.tenant_id,
    plano: p,
    ciclo,
    adicionais,
    teste_ate: o.teste_ate === undefined ? '2026-11-27' : o.teste_ate,
    paga: o.paga ?? false,
    licencas: ITENS_CONTADOS.map((item) => ({ item, contratadas: contratadas[item], em_uso: emUso[item] ?? 0 })),
    valor: valorDaAssinatura(p, adicionais, ciclo),
    desde: '2026-11-14T12:00:00.000Z',
    atualizada_em: '2026-11-14T12:00:00.000Z',
  };
}
