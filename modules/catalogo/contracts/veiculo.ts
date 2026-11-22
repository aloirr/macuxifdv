/**
 * Filtro de veículo em cascata (RN-CAT-22; spec `docs/design/filtro-veiculo/spec.md`; desenho `docs/desenho/filtro-veiculo.md` §1).
 * Consulta `catalogo.veiculos@1` (a cascata montadora › modelo › ano › motor › versão) e o aditivo de `catalogo.busca_produtos@1`
 * (`veiculo` na entrada e na saída). Tudo sai das aplicações em texto do catálogo; o veículo é só filtro: não vai ao pedido.
 * A regra mora em `../domain/veiculo-*.ts`; aqui só a forma.
 */
import { z } from 'zod';
import { definirConsulta } from '@macuxi/platform-sdk';
import { TrechoBusca, type ItemVitrine } from './busca';

export const NivelVeiculo = z.enum(['montadora', 'modelo', 'ano', 'motor', 'versao']);
export type NivelVeiculo = z.infer<typeof NivelVeiculo>;

const Texto = z.string().trim().min(1).max(80);

/** Veículo escolhido: cada texto é o `valor` devolvido pela cascata (nome de exibição). `montadora` nula = modelo achado sem montadora. */
export const VeiculoEscolhido = z
  .object({
    montadora: Texto.nullable(),
    modelo: Texto,
    ano: z.number().int().min(1950).max(2100).nullable(),
    motor: Texto.nullable(),
    versao: Texto.nullable(),
  })
  .strict();
export type VeiculoEscolhido = z.infer<typeof VeiculoEscolhido>;

/** O que já foi escolhido na folha: todos opcionais. */
export const VeiculoParcial = z
  .object({
    montadora: Texto.nullable().optional(),
    modelo: Texto.nullable().optional(),
    ano: z.number().int().min(1950).max(2100).nullable().optional(),
    motor: Texto.nullable().optional(),
    versao: Texto.nullable().optional(),
  })
  .strict();
export type VeiculoParcial = z.infer<typeof VeiculoParcial>;

/** `curto` = etiqueta (`Gol 2018 1.0 Trendline`); `completo` = leitor de tela e ficha (`Volkswagen Gol 2018 1.0`). Montados no domain. */
export const RotulosVeiculo = z.object({ curto: z.string(), completo: z.string() }).strict();
export type RotulosVeiculo = z.infer<typeof RotulosVeiculo>;

/** `apoio` = montadora, na busca da folha e nos Recentes. */
export const OpcaoVeiculo = z
  .object({
    /** Nível `ano`: o ano como texto (`Number(valor)`). Nos demais, o nome de exibição, que a consulta aceita de volta em `escolha`. */
    valor: z.string(),
    rotulo: z.string(),
    apoio: z.string().nullable(),
    /** Só nos resultados da `busca` da folha: o que o resultado é (montadora leva ao nível Modelo; modelo, ao Ano). Aditivo. */
    nivel: NivelVeiculo.optional(),
  })
  .strict();
export type OpcaoVeiculo = z.infer<typeof OpcaoVeiculo>;

/** `automatico` = nível de uma opção só, preenchido sozinho (a tela mostra em `ink2`). */
export const PassoTrilha = z.object({ nivel: NivelVeiculo, valor: z.string(), rotulo: z.string(), automatico: z.boolean() }).strict();
export type PassoTrilha = z.infer<typeof PassoTrilha>;

/** "Não serve" não existe no contrato: o item sai da lista. */
export const CompatibilidadeVeiculo = z.enum(['compativel', 'conferir']);
export type CompatibilidadeVeiculo = z.infer<typeof CompatibilidadeVeiculo>;

/** `serve_em` nulo quando o trecho é só o nome do modelo (spec §5) ou quando o item é `compativel`. */
export const ResultadoVeiculoItem = z.object({ compatibilidade: CompatibilidadeVeiculo, serve_em: TrechoBusca.nullable() }).strict();
export type ResultadoVeiculoItem = z.infer<typeof ResultadoVeiculoItem>;

export const VeiculoRecente = z.object({ veiculo: VeiculoEscolhido, rotulos: RotulosVeiculo }).strict();
export type VeiculoRecente = z.infer<typeof VeiculoRecente>;

export const VeiculosEntradaSchema = z.object({ escolha: VeiculoParcial.default({}), busca: z.string().trim().max(60).optional() }).strict();
export type VeiculosEntrada = z.infer<typeof VeiculosEntradaSchema>;

export const VeiculosSaidaSchema = z.object({
  /** Falso = o catálogo não tem veículo nas aplicações, ou ainda não está no aparelho: o botão Veículo não aparece (spec §2, §9). */
  disponivel: z.boolean(),
  trilha: z.array(PassoTrilha),
  /** Nulo = não há mais nível a escolher (aplica e fecha). */
  nivel: NivelVeiculo.nullable(),
  opcoes: z.array(OpcaoVeiculo),
  /** Tocar numa opção deste nível aplica e fecha (sem `Ver peças`). */
  ultimo: z.boolean(),
  /** A escolha, com os níveis de uma opção só já preenchidos. */
  escolha: VeiculoParcial,
  /** Os rótulos da `escolha`; nulo sem modelo. */
  rotulos: RotulosVeiculo.nullable(),
  /** Só quando a entrada tem `busca`: modelos e montadoras pelo nome e pelos apelidos; `[]` = `Nenhum modelo com "<texto>".` */
  busca: z.array(OpcaoVeiculo).nullable(),
  /** Até 3, só no aparelho (a API devolve `[]`). */
  recentes: z.array(VeiculoRecente).max(3),
});
export type VeiculosSaida = z.infer<typeof VeiculosSaidaSchema>;

/**
 * `catalogo.veiculos@1` (RN-CAT-22): a cascata de veículo do Catálogo. Sem preço e sem estoque: responde a todo perfil com o Catálogo
 * efetivo (promotor incluído). Mesmo contrato e mesmo resultado no aparelho e na API (ADR 0012).
 */
export const CONSULTA_VEICULOS = definirConsulta({
  nome: 'catalogo.veiculos@1',
  entrada: VeiculosEntradaSchema,
  saida: VeiculosSaidaSchema,
});

// ---------- folha Filtrar com contagem (D1) ----------
export const GrupoFiltro = z.enum(['sistema', 'familia', 'linha', 'categoria']);
export type GrupoFiltro = z.infer<typeof GrupoFiltro>;

export const ChipFiltro = z.object({ grupo: GrupoFiltro, id: z.string(), nome: z.string(), contagem: z.number().int().min(0), marcado: z.boolean() }).strict();
export type ChipFiltro = z.infer<typeof ChipFiltro>;

/** Só os grupos com 2+ chips; chip com contagem 0 sai, salvo o marcado. */
export const GruposFiltro = z.array(z.object({ grupo: GrupoFiltro, rotulo: z.string(), chips: z.array(ChipFiltro) }).strict());
export type GruposFiltro = z.infer<typeof GruposFiltro>;

/** O item da vitrine com o que o veículo escolhido disse dele (`veiculo` só existe com veículo escolhido). */
export type ItemVitrineComVeiculo = ItemVitrine & { veiculo?: ResultadoVeiculoItem };
