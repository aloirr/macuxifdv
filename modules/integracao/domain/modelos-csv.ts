/**
 * Modelos de arquivo da carga por CSV (RF-INT-03): para cada entidade, um CSV de exemplo (2 linhas válidas) e o dicionário de campos,
 * ambos GERADOS de `SCHEMA_REGISTRO` (ou do schema passado): colunas, ordem, obrigatoriedade, tipos e limites vêm do contrato, nunca de
 * lista manual. Só os VALORES de exemplo realistas vêm de um mapa por nome de campo; campo sem exemplo no mapa recebe um gerado do tipo.
 *
 * Formato do arquivo (o que o parser de `carga-arquivo.ts` lê sem ambiguidade):
 *  - UTF-8 com BOM (o Excel pt-BR só reconhece acentos assim) e separador `;` (o `,` é o decimal do Excel pt-BR);
 *  - quebras CRLF: é o que o Excel/Bloco de Notas do Windows (o ambiente de quem prepara a planilha) grava, e o RFC 4180; o parser normaliza
 *    CRLF e LF igual, então a escolha só afeta quem abre o arquivo;
 *  - obrigatórios primeiro (ordem do contrato), depois opcionais; listas de objetos (`contatos`, `paradas`) ficam de fora; listas simples liberadas (`parcelas_dias`, `formas_pagamento`) vão numa célula, itens separados por `/` (vêm pelo Conector);
 *  - dinheiro em centavos inteiros; números sem separador de milhar (evita `NUMERO_AMBIGUO`); decimais com vírgula; datas `AAAA-MM-DD`;
 *    datas-hora ISO UTC com `Z`; booleanos `sim`/`não`; aspas duplas quando a célula tem `;`, aspas ou quebra de linha.
 * Dica de planilha: formate as colunas de código (documento, CEP, EAN) como Texto para o Excel não cortar zeros nem usar notação científica.
 */
import { z } from 'zod';
import { SCHEMA_REGISTRO, type CampoDicionario, type DicionarioModelo, type Entidade } from '../contracts';
import { defDe, desembrulhar, estruturaDoSchema } from './carga-arquivo';
import { ordemDeCargaDoPortal } from './portal-carga';

const BOM = String.fromCharCode(0xfeff);
const CRLF = '\r\n';
const SEPARADOR = ';';

// ---------------------------------------------------------------------------------------------------------------- ordem de carga

/** Entidades na ordem de carga inicial (RN-INT-04): a MESMA do portal (`ordemDeCargaDoPortal`), sem segunda lista. */
export const ENTIDADES_ORDEM_CARGA: readonly Entidade[] = ordemDeCargaDoPortal().map((i) => i.entidade);

export interface ResumoModelo {
  entidade: Entidade;
  arquivo: string;
  /** 1 = primeira a carregar. */
  ordem: number;
  depende_de: Entidade[];
  opcional: boolean;
}
export const nomeArquivoModelo = (entidade: Entidade): string => `${entidade}.csv`;
export const RESUMO_MODELOS: readonly ResumoModelo[] = ordemDeCargaDoPortal().map((i) => ({ entidade: i.entidade, arquivo: nomeArquivoModelo(i.entidade), ordem: i.posicao, depende_de: [...i.depende_de], opcional: i.opcional }));

// ---------------------------------------------------------------------------------------------------------------- exemplos

type Exemplo = readonly [string, string];
const UUID_1 = '3f2b8a52-6d1e-4c7a-9b0e-5a1d2c3e4f60';
const ENDERECO: Record<string, Exemplo> = {
  logradouro: ['Rua das Palmeiras', 'Avenida Ville Roy'],
  numero: ['100', '2500'],
  complemento: ['Sala 2', ''],
  bairro: ['Centro', 'São Pedro'],
  cidade: ['Boa Vista', 'Boa Vista'],
  uf: ['RR', 'RR'],
  cep: ['69301-000', '69306-000'],
};

/** Valores de exemplo por campo. Chave `entidade.campo` vale mais que `campo`; para colunas aninhadas vale também o último trecho. */
const EXEMPLOS: Record<string, Exemplo> = {
  alterado_em: ['2026-11-01T12:00:00Z', '2026-11-01T12:05:00Z'],
  ativo: ['sim', 'sim'],
  email: ['contato@exemplo.com.br', 'vendas@exemplo.com.br'],
  telefone: ['(95) 99999-0001', '(95) 99999-0002'],
  inscricao_estadual: ['ISENTO', '240123456'],
  latitude: ['2,8235', '2,8190'],
  longitude: ['-60,6753', '-60,6710'],
  ...ENDERECO,
  'vendedor.external_id': ['VEN-001', 'VEN-002'],
  'vendedor.nome': ['Maria Silva', 'João Souza'],
  'cliente.external_id': ['CLI-001', 'CLI-002'],
  'cliente.razao_social': ['Mercadinho Boa Vista Ltda', 'Padaria Pão Quente ME'],
  'cliente.nome_fantasia': ['Mercadinho Boa Vista', 'Pão Quente'],
  'cliente.documento': ['11222333000181', '44555666000172'],
  'cliente.limite_credito_cents': ['500000', '250000'],
  'cliente.observacao': ['', 'Entregar após as 14h'],
  'cliente.bloqueado': ['não', 'não'],
  'produto.external_id': ['PRO-001', 'PRO-002'],
  'produto.sku': ['SKU-001', 'SKU-002'],
  'produto.ean': ['7891234567895', '78912345'],
  'produto.nome': ['Refrigerante Cola 2L', 'Água Mineral 500ml'],
  'produto.marca': ['Marca Alfa', 'Marca Beta'],
  'produto.categoria': ['Bebidas', 'Bebidas'],
  'produto.unidade': ['UN', 'UN'],
  'produto.embalagem_medida': ['CX', ''],
  'produto.embalagem_quantidade': ['12', ''],
  'produto.catalogo_no_external_id': ['CAT-001', 'CAT-002'],
  'produto.custo_cents': ['850', '120'],
  'produto.preco_venda_cents': ['1290', '250'],
  'produto.desconto_maximo_pct': ['10', '7,5'],
  'preco.external_id': ['TAB-01:PRO-001', 'TAB-01:PRO-002'],
  'preco.tabela_external_id': ['TAB-01', 'TAB-01'],
  'preco.tabela_nome': ['Tabela Varejo', 'Tabela Varejo'],
  'preco.vigencia_inicio': ['2026-11-01', '2026-11-01'],
  'preco.vigencia_fim': ['', '2026-12-31'],
  'preco.preco_cents': ['1290', '250'],
  'preco.unidade': ['UN', 'UN'],
  'estoque.external_id': ['DEP-01:PRO-001', 'DEP-01:PRO-002'],
  'estoque.deposito_external_id': ['DEP-01', 'DEP-01'],
  'estoque.deposito_nome': ['Depósito Central', 'Depósito Central'],
  'estoque.saldo': ['120', '35,5'],
  'titulo.external_id': ['TIT-1001-1', 'TIT-1002-1'],
  'titulo.numero': ['1001', '1002'],
  'titulo.parcela': ['1', '2'],
  'titulo.emissao': ['2026-10-05', '2026-09-20'],
  'titulo.vencimento': ['2026-11-05', '2026-10-20'],
  'titulo.valor_cents': ['150000', '75000'],
  'titulo.saldo_cents': ['150000', '0'],
  'titulo.baixado_em': ['', '2026-10-20T15:30:00Z'],
  'nota.external_id': ['NF-5001', 'NF-5002'],
  'nota.numero': ['5001', '5002'],
  'nota.serie': ['1', '1'],
  'nota.emitida_em': ['2026-10-30T13:20:00Z', '2026-10-31T09:45:00Z'],
  'nota.total_cents': ['250000', '12000'],
  'nota.quantidade_itens': ['10', '1'],
  'nota.pedido_uuid': [UUID_1, ''],
  'nota.cancelada': ['não', 'não'],
  'rota.external_id': ['ROT-001', 'ROT-002'],
  'rota.nome': ['Rota Centro - Segunda', 'Rota Zona Oeste - Terça'],
  'rota.dia_semana': ['1', '2'],
  'catalogo_no.external_id': ['CAT-001', 'CAT-002'],
  'catalogo_no.codigo': ['BEB', 'BEB-REF'],
  'catalogo_no.nome': ['Bebidas', 'Refrigerantes'],
  'catalogo_no.pai_external_id': ['', 'CAT-001'],
  'catalogo_no.ordem': ['0', '1'],
  'produto_unidade.external_id': ['PRO-001:UN', 'PRO-001:CX'],
  'produto_unidade.unidade': ['UN', 'CX'],
  'produto_unidade.fator': ['1', '12'],
  'produto_unidade.ean': ['', '17891234567892'],
  'produto_unidade.padrao': ['sim', 'não'],
  'cliente_endereco.external_id': ['END-001', 'END-002'],
  'cliente_endereco.descricao': ['Matriz', 'Depósito'],
  'cliente_endereco.principal': ['sim', 'não'],
  'forma_pagamento.external_id': ['FPG-001', 'FPG-002'],
  'forma_pagamento.codigo': ['PIX', 'BOLETO'],
  'forma_pagamento.nome': ['PIX', 'Boleto bancário'],
  'forma_pagamento.ordem': ['1', '2'],
  'prazo_pagamento.external_id': ['PRZ-001', 'PRZ-002'],
  'prazo_pagamento.forma_external_id': ['FPG-002', 'FPG-002'],
  'prazo_pagamento.codigo': ['30-60-90', '28-56'],
  'prazo_pagamento.descricao': ['30/60/90 dias', '28/56 dias'],
  'prazo_pagamento.parcelas_dias': ['30/60/90', '28/56'],
  'prazo_pagamento.prazo_medio_dias': ['60', '42'],
  'prazo_pagamento.ordem': ['1', '2'],
  'cliente.prazo_medio_max_dias': ['60', ''],
  'cliente.formas_pagamento': ['PIX/BOLETO', 'PIX'],
  'tabela_escalonada.external_id': ['ESC-001', 'ESC-002'],
  'tabela_escalonada.medida': ['UN', 'UN'],
  'tabela_escalonada.quantidade_minima': ['10', '50'],
  'tabela_escalonada.preco_unidade_cents': ['1200', '1100'],
  'tabela_escalonada.vigencia_inicio': ['2026-11-01', '2026-11-01'],
  'tabela_escalonada.vigencia_fim': ['', '2026-12-31'],
  'tabela_escalonada.tabela_external_id': ['TAB-01', 'TAB-01'],
  'transportadora.external_id': ['TRA-001', 'TRA-002'],
  'transportadora.nome': ['Transportes Norte Ltda', 'Rápido Roraima'],
  'transportadora.documento': ['12345678000195', '98765432000110'],
};
// referências *_external_id coerentes com a ordem de carga: todas apontam para os ids dos exemplos das entidades anteriores
for (const [campo, ids] of [
  ['vendedor_external_id', ['VEN-001', 'VEN-002']],
  ['cliente_external_id', ['CLI-001', 'CLI-002']],
  ['produto_external_id', ['PRO-001', 'PRO-002']],
] as const) {
  EXEMPLOS[campo] = ids;
}
EXEMPLOS['external_id'] = ['REG-001', 'REG-002'];

const OBSERVACOES: Record<string, string> = {
  'produto.embalagem_medida': 'Informe junto com embalagem_quantidade (as duas preenchidas ou as duas vazias).',
  'produto.embalagem_quantidade': 'Informe junto com embalagem_medida (as duas preenchidas ou as duas vazias).',
  'preco.vigencia_fim': 'Não pode ser anterior a vigencia_inicio. Vazio = sem data de fim.',
  alterado_em: 'Pode ficar de fora ou vazia: vale o instante do envio.',
  'cliente.formas_pagamento': 'Códigos das formas de pagamento permitidas (as do modelo forma_pagamento), separados por /. Vazio = não altera.',
  'cliente.prazo_medio_max_dias': 'Prazo médio máximo aceito pelo cliente, em dias. Vazio = não altera.',
  'prazo_pagamento.parcelas_dias': 'Dias de cada parcela, em ordem crescente (0 = à vista): 30/60/90 vale, 60/30 não.',
  'prazo_pagamento.forma_external_id': 'external_id de uma forma do modelo forma_pagamento (carregue a forma antes).',
  'prazo_pagamento.prazo_medio_dias': 'Informativo: o Macuxi calcula o prazo médio; valor diferente gera aviso.',
  'tabela_escalonada.preco_unidade_cents': 'Preço da unidade base na faixa. Faixas do mesmo produto: quantidade_minima maior, preço igual ou menor.',
  'tabela_escalonada.tabela_external_id': 'Vazio = vale para todas as tabelas de preço.',
  external_id: 'Código do registro no ERP; é a chave da carga (repetir atualiza, não duplica).',
};

// ---------------------------------------------------------------------------------------------------------------- leitura do contrato

interface Check {
  kind: string;
  value?: number;
  inclusive?: boolean;
  regex?: RegExp;
}
const checksDe = (t: z.ZodTypeAny): Check[] => ((t._def as { checks?: Check[] }).checks ?? []) as Check[];
const FONTE_DATA_CIVIL = '^\\d{4}-\\d{2}-\\d{2}$';
const REGEX_CONHECIDAS: Record<string, string> = {
  '^\\d{8}$|^\\d{12,14}$': '8, 12, 13 ou 14 dígitos',
  '^\\d{14}$': '14 dígitos',
  '^[A-Z]{1,4}$': '1 a 4 letras maiúsculas',
};

/** Valor padrão declarado (`.default(x)`) em qualquer ponto da cadeia de wrappers. */
function valorPadrao(t: z.ZodTypeAny): unknown {
  let atual: z.ZodTypeAny | undefined = t;
  for (let i = 0; i < 12 && atual; i++) {
    const d = atual._def as { typeName?: string; innerType?: z.ZodTypeAny; schema?: z.ZodTypeAny; defaultValue?: () => unknown };
    if (d.typeName === 'ZodDefault') return d.defaultValue?.();
    atual = d.innerType ?? d.schema;
  }
  return undefined;
}

interface Folha {
  tipo: CampoDicionario['tipo'];
  tamanhoMax: number | null;
  formato: string | null;
  /** Opções do enum / limites inteiros, para o gerador de exemplo. */
  opcoes: string[];
  inteiro: boolean;
  minimo: number | null;
  maximo: number | null;
  exatos: number | null;
  uuid: boolean;
  /** Lista numa célula (itens separados por /): `lista_numeros` / `lista_textos`. */
  lista: 'numeros' | 'textos' | null;
}

function faixa(checks: Check[], inteiro: boolean): { minimo: number | null; maximo: number | null; exclusivo: boolean } {
  let minimo: number | null = null;
  let maximo: number | null = null;
  let exclusivo = false;
  for (const c of checks) {
    if (c.kind === 'min' && typeof c.value === 'number') {
      const v = c.inclusive === false && inteiro ? c.value + 1 : c.value;
      if (minimo === null || v > minimo) {
        minimo = v;
        exclusivo = c.inclusive === false && !inteiro;
      }
    }
    if (c.kind === 'max' && typeof c.value === 'number' && (maximo === null || c.value < maximo)) maximo = c.value;
  }
  return { minimo, maximo, exclusivo };
}

function lerFolha(caminho: string, campo: z.ZodTypeAny): Folha {
  const base = desembrulhar(campo);
  const nome = defDe(base).typeName;
  const vazio: Folha = { tipo: 'texto', tamanhoMax: null, formato: null, opcoes: [], inteiro: false, minimo: null, maximo: null, exatos: null, uuid: false, lista: null };
  if (nome === 'ZodArray') {
    const d = base._def as { type?: z.ZodTypeAny; minLength?: { value: number } | null; maxLength?: { value: number } | null };
    const item = d.type ? desembrulhar(d.type) : undefined;
    const itens = [d.minLength ? `no mínimo ${d.minLength.value}` : null, d.maxLength ? `até ${d.maxLength.value}` : null].filter((x) => x !== null).join(' e ');
    const qtd = itens === '' ? '' : `, ${itens} ${(d.maxLength?.value ?? d.minLength?.value) === 1 ? 'item' : 'itens'}`;
    if (item && defDe(item).typeName === 'ZodNumber') {
      const { minimo, maximo } = faixa(checksDe(item), true);
      const cada = minimo !== null && maximo !== null ? `, cada um de ${minimo} a ${maximo}` : '';
      return { ...vazio, tipo: 'lista de números', lista: 'numeros', formato: `lista de números inteiros separados por / (ex.: 30/60/90)${cada}${qtd}` };
    }
    const max = item ? checksDe(item).find((c) => c.kind === 'max')?.value : undefined;
    return { ...vazio, tipo: 'lista de textos', lista: 'textos', formato: `lista de códigos separados por / (ex.: PIX/BOLETO)${max !== undefined ? `, cada um com até ${max} caracteres` : ''}${qtd}` };
  }
  if (nome === 'ZodBoolean') return { ...vazio, tipo: 'sim/não', formato: 'sim ou não' };
  if (nome === 'ZodEnum') {
    const opcoes = ((base._def as { values: string[] }).values ?? []).map(String);
    return { ...vazio, tipo: 'enum', opcoes, formato: `uma destas opções: ${opcoes.join(', ')}` };
  }
  if (nome === 'ZodNumber') {
    const checks = checksDe(base);
    const inteiro = checks.some((c) => c.kind === 'int');
    const { minimo, maximo, exclusivo } = faixa(checks, inteiro);
    const nomeNum = inteiro ? 'inteiro' : 'número';
    let intervalo: string;
    if (minimo !== null && maximo !== null) intervalo = `${nomeNum} de ${minimo} a ${maximo}`;
    else if (minimo !== null) intervalo = `${nomeNum} ${exclusivo ? 'maior que' : 'maior ou igual a'} ${minimo}`;
    else if (maximo !== null) intervalo = `${nomeNum} até ${maximo}`;
    else intervalo = inteiro ? 'inteiro' : 'número (decimal com vírgula, sem separador de milhar)';
    const centavos = caminho.split('.').pop()?.endsWith('_cents') === true;
    return {
      ...vazio,
      tipo: centavos ? 'centavos' : 'número',
      inteiro,
      minimo,
      maximo,
      formato: centavos ? `centavos inteiros, sem separador (R$ 15,00 = 1500)${minimo === 0 ? '; 0 ou mais' : ''}` : intervalo,
    };
  }
  // texto
  const checks = checksDe(base);
  const max = checks.filter((c) => c.kind === 'max').map((c) => c.value as number);
  const exato = checks.find((c) => c.kind === 'length')?.value ?? null;
  const tamanhoMax = exato ?? (max.length > 0 ? Math.min(...max) : null);
  const f: Folha = { ...vazio, tamanhoMax, exatos: exato };
  if (exato !== null) f.formato = `exatamente ${exato} caracteres`;
  if (checks.some((c) => c.kind === 'datetime')) return { ...f, tipo: 'data-hora', formato: 'AAAA-MM-DDTHH:MM:SSZ (UTC, terminando em Z)' };
  if (checks.some((c) => c.kind === 'uuid')) return { ...f, uuid: true, formato: 'UUID (xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx)' };
  const regex = checks.find((c) => c.kind === 'regex')?.regex;
  if (regex) {
    if (regex.source === FONTE_DATA_CIVIL) return { ...f, tipo: 'data', formato: 'AAAA-MM-DD' };
    return { ...f, formato: REGEX_CONHECIDAS[regex.source] ?? `padrão ${regex.source}` };
  }
  return f;
}

// ---------------------------------------------------------------------------------------------------------------- exemplos gerados

function exemploGerado(f: Folha, linha: 0 | 1): string {
  switch (f.tipo) {
    case 'sim/não':
      return linha === 0 ? 'sim' : 'não';
    case 'lista de números':
      return linha === 0 ? '30/60/90' : '28/56';
    case 'lista de textos':
      return linha === 0 ? 'PIX/BOLETO' : 'PIX';
    case 'enum':
      return f.opcoes[Math.min(linha, f.opcoes.length - 1)] ?? '';
    case 'data':
      return linha === 0 ? '2026-11-01' : '2026-11-02';
    case 'data-hora':
      return linha === 0 ? '2026-11-01T12:00:00Z' : '2026-11-01T12:05:00Z';
    case 'centavos':
    case 'número': {
      const piso = f.minimo ?? (f.inteiro ? 1 : 10);
      const v = Math.min(piso + linha, f.maximo ?? Number.MAX_SAFE_INTEGER);
      return String(v);
    }
    default: {
      if (f.uuid) return linha === 0 ? UUID_1 : '9c1d7e44-2b3a-4f58-8a6d-0e7f1b2c3d4e';
      const n = f.exatos;
      if (n !== null) return 'A'.repeat(n);
      const t = `Exemplo ${linha + 1}`;
      return f.tamanhoMax !== null ? t.slice(0, f.tamanhoMax) : t;
    }
  }
}

function exemploDe(entidade: Entidade, caminho: string, f: Folha, linha: 0 | 1, extra: Record<string, Exemplo>): string {
  const ultimo = caminho.split('.').pop() as string;
  const chaves = [`${entidade}.${caminho}`, caminho, `${entidade}.${ultimo}`, ultimo];
  for (const k of chaves) {
    const e = extra[k] ?? EXEMPLOS[k];
    if (e) return e[linha];
  }
  return exemploGerado(f, linha);
}

// ---------------------------------------------------------------------------------------------------------------- geração

function celulaCsv(valor: string): string {
  return /[;"\r\n]/.test(valor) ? `"${valor.replace(/"/g, '""')}"` : valor;
}

export interface ModeloCsv {
  entidade: Entidade;
  arquivo: string;
  /** Texto completo do arquivo: BOM + cabeçalho + 2 linhas, separador `;`, quebras CRLF. */
  csv: string;
  /** Uma entrada por coluna do cabeçalho, na mesma ordem. */
  campos: CampoDicionario[];
}

/**
 * Gera o modelo de uma entidade a partir do schema do contrato (padrão: `SCHEMA_REGISTRO[entidade]`; o parâmetro permite provar que
 * mudar o contrato muda o modelo). `exemplos` substitui valores de exemplo por campo (testes e ajustes finos).
 */
export function gerarModeloCsv(entidade: Entidade, schema: z.ZodTypeAny = SCHEMA_REGISTRO[entidade], exemplos: Record<string, Exemplo> = {}): ModeloCsv {
  const { estrutura, bases } = estruturaDoSchema(schema);
  // obrigatórios primeiro, mantendo a ordem do contrato dentro de cada grupo (sort estável)
  const colunas = [...estrutura.colunas].sort((a, b) => Number(b.obrigatoria) - Number(a.obrigatoria));
  const linhas: [string[], string[]] = [[], []];
  const campos: CampoDicionario[] = [];

  for (const col of colunas) {
    const declarado = bases.get(col.caminho) as z.ZodTypeAny;
    const f = lerFolha(col.caminho, declarado);
    const v0 = exemploDe(entidade, col.caminho, f, 0, exemplos);
    const v1 = exemploDe(entidade, col.caminho, f, 1, exemplos);
    linhas[0].push(celulaCsv(v0));
    linhas[1].push(celulaCsv(v1));
    const padrao = valorPadrao(declarado);
    const notas = [OBSERVACOES[`${entidade}.${col.caminho}`] ?? OBSERVACOES[col.caminho], typeof padrao === 'boolean' ? `Vazio = ${padrao ? 'sim' : 'não'}.` : typeof padrao === 'string' || typeof padrao === 'number' ? `Vazio = ${String(padrao)}.` : undefined].filter((x): x is string => x !== undefined);
    campos.push({
      campo: col.caminho,
      obrigatorio: col.obrigatoria,
      tipo: f.tipo,
      tamanho_max: f.tipo === 'texto' ? f.tamanhoMax : null,
      formato: f.formato,
      exemplo: v0 !== '' ? v0 : v1,
      observacao: notas.length > 0 ? notas.join(' ') : null,
    });
  }
  const cabecalho = colunas.map((c) => celulaCsv(c.caminho)).join(SEPARADOR);
  const csv = BOM + [cabecalho, linhas[0].join(SEPARADOR), linhas[1].join(SEPARADOR)].join(CRLF) + CRLF;
  return { entidade, arquivo: nomeArquivoModelo(entidade), csv, campos };
}

/** Dicionário de campos de uma entidade (o JSON que a página do BKO mostra). */
export function dicionarioDaEntidade(entidade: Entidade, schema: z.ZodTypeAny = SCHEMA_REGISTRO[entidade]): DicionarioModelo {
  const { arquivo, campos } = gerarModeloCsv(entidade, schema);
  const resumo = RESUMO_MODELOS.find((r) => r.entidade === entidade) as ResumoModelo;
  return { entidade, arquivo, ordem: resumo.ordem, depende_de: resumo.depende_de, opcional: resumo.opcional, campos };
}
