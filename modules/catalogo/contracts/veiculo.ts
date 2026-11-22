/**
 * Filtro de veículo em cascata (RN-CAT-22; spec `docs/design/filtro-veiculo/spec.md`; desenho `docs/desenho/filtro-veiculo.md` §1).
 * Consulta `catalogo.veiculos@1` (a cascata montadora › modelo › ano › motor › versão) e o aditivo de `catalogo.busca_produtos@1`
 * (`veiculo` na entrada; a saída não traz campo de veículo por item: o item ou está na lista ou não está). Tudo sai das aplicações em texto do catálogo; o veículo é só filtro: não vai ao pedido.
 * A regra mora em `../domain/veiculo-*.ts`; aqui só a forma.
 */
import { z } from 'zod';
import { definirConsulta } from '@macuxi/platform-sdk';
import { Id } from '@macuxi/core/contracts';

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

export const VeiculoRecente = z.object({ veiculo: VeiculoEscolhido, rotulos: RotulosVeiculo }).strict();
export type VeiculoRecente = z.infer<typeof VeiculoRecente>;

export const VeiculosEntradaSchema = z
  .object({
    escolha: VeiculoParcial.default({}),
    busca: z.string().trim().max(60).optional(),
    /**
     * Escopo opcional (aditivo, mesma semântica de `catalogo.busca_produtos@1`): `produto_ids` restringe aos produtos dados; `cliente_id`
     * restringe aos vendáveis na tabela de preço do cliente (RN-CAT-06, RN-CAT-22), filtrados dentro da consulta. Com os dois, vale
     * `produto_ids`. Sem nenhum = o catálogo inteiro. A cascata, a `busca` e `disponivel` só contam o que está no escopo; os Recentes não.
     */
    produto_ids: z.array(Id).max(5000).optional(),
    cliente_id: Id.optional(),
  })
  .strict();
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

// ---------- apoios puros da folha Veículo (RD-2573): o Catálogo e o Vendedor passam `NAVEGACAO_VEICULO` e `TEXTOS_VEICULO` à `FolhaVeiculo` do kit ----------

/** A escolha da folha (só o que já tem) vira veículo quando há modelo. */
export function veiculoDaEscolha(p: VeiculoParcial): VeiculoEscolhido | null {
  if (!p.modelo) return null;
  return { montadora: p.montadora ?? null, modelo: p.modelo, ano: p.ano ?? null, motor: p.motor ?? null, versao: p.versao ?? null };
}

export const parcialDoVeiculo = (v: VeiculoEscolhido): VeiculoParcial => ({ ...v });

/** Voltar pela trilha: os passos ANTES do `indice` (os automáticos voltam sozinhos na consulta seguinte). */
export function escolhaAntesDoPasso(trilha: readonly PassoTrilha[], indice: number): VeiculoParcial {
  const escolha: VeiculoParcial = {};
  for (const p of trilha.slice(0, Math.max(0, indice))) {
    // RN-CAT-22: ano, motor e versão preenchidos sozinhos não viram escolha (só o escolhido filtra); montadora e modelo seguem
    if (p.automatico && (p.nivel === 'ano' || p.nivel === 'motor' || p.nivel === 'versao')) continue;
    if (p.nivel === 'ano') escolha.ano = Number(p.valor);
    else escolha[p.nivel] = p.valor;
  }
  return escolha;
}

/** Escolhe a opção `valor` do `nivel` sobre a escolha de agora. */
export function escolherOpcao(escolha: VeiculoParcial, nivel: NivelVeiculo, valor: string): VeiculoParcial {
  return nivel === 'ano' ? { ...escolha, ano: Number(valor) } : { ...escolha, [nivel]: valor };
}

/** O que a busca da folha escolheu: montadora leva ao Modelo; modelo (com a montadora do apoio) leva ao Ano. */
export function escolhaDoResultadoDaBusca(r: OpcaoVeiculo): VeiculoParcial {
  return r.nivel === 'montadora' ? { montadora: r.valor } : { ...(r.apoio ? { montadora: r.apoio } : {}), modelo: r.valor };
}

/** No formato `NavegacaoCascata` do kit (`@macuxi/ui/mobile`), sem importá-lo: o contrato é só estrutural. */
export const NAVEGACAO_VEICULO = {
  vazia: {} as VeiculoParcial,
  doVeiculo: parcialDoVeiculo,
  veiculoDe: veiculoDaEscolha,
  antesDoPasso: escolhaAntesDoPasso,
  escolher: escolherOpcao,
  daBusca: escolhaDoResultadoDaBusca,
  /** Grade de 4 colunas só no Ano. */
  nivelEmGrade: 'ano' as const,
  /** Níveis com o principal "Ver peças" no pé, fora o último (lá, tocar já aplica e fecha). */
  niveisComVerPecas: ['ano', 'motor', 'versao'] as readonly NivelVeiculo[],
};

/** No formato `TextosFolhaVeiculo` do kit (mais o `botao`, do botão Veículo da tela). */
export const TEXTOS_VEICULO = {
  botao: 'Veículo',
  titulo: 'Veículo',
  fechar: 'Fechar',
  buscaPlaceholder: 'Modelo ou montadora',
  buscaLimpar: 'Limpar a busca',
  recentes: 'Recentes',
  verPecas: 'Ver peças',
  rotuloDoNivel: { montadora: 'Montadora', modelo: 'Modelo', ano: 'Ano', motor: 'Motor', versao: 'Versão' } as Readonly<Record<NivelVeiculo, string>>,
  nenhumModeloCom: (texto: string): string => `Nenhum modelo com "${texto}".`,
  /** Sem resultado com veículo (Catálogo e Vendedor): a ação de tirar o veículo, o título sem filtros e o título com busca. */
  tirar: 'Tirar o veículo',
  semFiltros: 'Nenhum produto com esses filtros',
  nadaEncontradoPara: (texto: string): string => `Nada encontrado para "${texto}"`,
  /** Campo de busca do Catálogo e do Vendedor com o botão Veículo visível, e a dica embaixo dele em foco e vazio (spec §3). */
  placeholderBusca: 'Peça ou código…',
  dicaBusca: 'Também acha por marca, aplicação e referência cruzada.',
};

/** Leitor de tela do botão Veículo: com veículo aplicado, diz qual (`rotulos` vem do domain ou da folha). */
export const leituraDoBotaoVeiculo = (r: RotulosVeiculo | null): string => (r ? `Veículo: ${r.completo}` : TEXTOS_VEICULO.botao);
export const leituraDaEtiquetaVeiculo = (r: RotulosVeiculo): string => `Remover veículo ${r.completo}`;

/** RF-CAT-01 (T-0167): a busca só roda com 3 caracteres ou mais; com 2 letras o ranking fica pesado e o resultado, largo demais. */
export const MINIMO_CARACTERES_BUSCA = 3;
export const buscaPodeRodar = (q: string): boolean => q.replace(/\s+/g, '').length >= MINIMO_CARACTERES_BUSCA;

/** RN-CAT-22: com veículo, texto de menos de 3 caracteres vale como sem texto (a lista é a das peças do veículo); sem veículo, o texto é o que veio. */
export const textoDaBuscaComVeiculo = (q: string, veiculo: unknown): string => (veiculo && !buscaPodeRodar(q) ? '' : q);
