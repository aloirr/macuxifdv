/**
 * Regras de tela da aba Metas e RV › Produtividade (RN-CORE-45; desenho `docs/desenho/performance-produtividade.md` §6.5),
 * puras: rótulos, a máscara de cada unidade (§1.5: hh:mm, min, %, número com 1 casa, m, km), a linha própria do alvo,
 * o que o Salvar manda (um `PUT` com as metas alteradas e o "voltar a herdar" das apagadas) e os erros no campo.
 * Qual meta vale e as faixas ficam no domain (`metasProdutividadeVigentes`, `validarMetaProdutividade`); a API revalida.
 */
import { ApiRequestError, errorMessage } from '@macuxi/platform-sdk/web';
import { parseDecimalInput } from '@macuxi/ui/web';
import {
  INDICADORES_PRODUTIVIDADE,
  SENTIDO_PRODUTIVIDADE,
  UNIDADES_PRODUTIVIDADE,
  type EscopoMetaProdutividade,
  type IndicadorProdutividade,
  type MetaProdutividade,
  type MetasProdutividadePut,
  type OrigemMetaProdutividade,
} from '../../../contracts/performance';
import { ERRO_HORA_HHMM, minutoDoTextoHora, textoDoMinuto } from '../../../contracts';
import type { EquipeArvore, ErroMetaProdutividade } from '../../../domain/performance/metas-produtividade';

/** Ordem da §3.1. */
export const ROTULO_INDICADOR_PRODUTIVIDADE: Record<IndicadorProdutividade, string> = {
  primeiro_checkin: '1º check-in',
  ultimo_checkin: 'Último check-in',
  tma: 'Tempo médio de atendimento',
  tmd: 'Tempo médio de deslocamento',
  almoco: 'Almoço',
  jornada_liquida: 'Jornada líquida',
  fora_rota: 'Fora de rota',
  visitas_dia: 'Visitas por dia',
  cobertura_rota: 'Cobertura de rota',
  raio_checkin: 'Raio médio do check-in',
  km_dia: 'Km por dia',
  km_cliente: 'Km por cliente',
};

export const ROTULO_SENTIDO = { ate: 'até', a_partir_de: 'a partir de' } as const;
export const regraDo = (i: IndicadorProdutividade) => ROTULO_SENTIDO[SENTIDO_PRODUTIVIDADE[i]];

const ehKm = (i: IndicadorProdutividade) => i === 'km_dia' || i === 'km_cliente';

/** Sufixo do campo (o que se digita); vazio no horário (hh:mm) e no número de visitas. */
export function sufixoDo(i: IndicadorProdutividade): string {
  switch (UNIDADES_PRODUTIVIDADE[i]) {
    case 'minutos':
      return 'min';
    case 'pontos_base':
      return '%';
    case 'metros':
      return ehKm(i) ? 'km' : 'm';
    default:
      return '';
  }
}

const umaCasa = (n: number) => n.toFixed(1).replace('.', ',');
const semZero = (s: string) => s.replace(/,0$/, '');

/** Valor guardado (unidade da §1.5) → texto do campo, sem o sufixo. */
export function textoDoCampo(i: IndicadorProdutividade, valor: number): string {
  switch (UNIDADES_PRODUTIVIDADE[i]) {
    case 'minuto_do_dia':
      return textoDoMinuto(valor);
    case 'minutos':
      return String(valor);
    case 'pontos_base':
      return semZero(umaCasa(valor / 100));
    case 'decimos':
      return umaCasa(valor / 10);
    case 'metros':
      return ehKm(i) ? semZero(umaCasa(valor / 1000)) : String(valor);
  }
}

/** Valor guardado → texto da coluna "Vale hoje" (com a unidade). */
export function formatarMeta(i: IndicadorProdutividade, valor: number): string {
  const s = sufixoDo(i);
  const t = textoDoCampo(i, valor);
  return !s ? t : s === '%' ? `${t}%` : `${t} ${s}`;
}

/** Texto do campo → valor guardado. Vazio = herda (`null`). A faixa é conferida no domain (`validarMetaProdutividade`). */
export function lerMeta(i: IndicadorProdutividade, texto: string): { ok: true; valor: number | null } | { ok: false; erro: string } {
  const t = texto.trim();
  if (!t) return { ok: true, valor: null };
  const unidade = UNIDADES_PRODUTIVIDADE[i];
  if (unidade === 'minuto_do_dia') {
    const min = minutoDoTextoHora(t);
    return min === null ? { ok: false, erro: ERRO_HORA_HHMM } : { ok: true, valor: min };
  }
  const n = parseDecimalInput(t);
  if (n === null || n < 0) return { ok: false, erro: 'Use um número.' };
  if ((unidade === 'minutos' || (unidade === 'metros' && !ehKm(i))) && !Number.isInteger(n)) return { ok: false, erro: 'Use um número inteiro.' };
  const fator = unidade === 'pontos_base' ? 100 : unidade === 'decimos' ? 10 : unidade === 'metros' && ehKm(i) ? 1000 : 1;
  return { ok: true, valor: Math.round(n * fator) };
}

// ---- Alvo e linhas próprias ----

export interface AlvoEscolhido {
  escopo: EscopoMetaProdutividade;
  equipe_id: string | null;
  usuario_id: string | null;
}

/** Linha viva do próprio alvo que vale no mês (maior vigência ≤ mês), por indicador. É a que o campo mostra e o "voltar a herdar" apaga. */
export function linhasDoAlvo(linhas: readonly MetaProdutividade[], alvo: AlvoEscolhido, mes: string): Partial<Record<IndicadorProdutividade, MetaProdutividade>> {
  const out: Partial<Record<IndicadorProdutividade, MetaProdutividade>> = {};
  for (const l of linhas) {
    if (l.deleted_at || l.escopo !== alvo.escopo || l.vigencia_inicio > mes) continue;
    if (alvo.escopo === 'equipe' && l.equipe_id !== alvo.equipe_id) continue;
    if (alvo.escopo === 'usuario' && l.usuario_id !== alvo.usuario_id) continue;
    const atual = out[l.indicador];
    if (!atual || l.vigencia_inicio > atual.vigencia_inicio) out[l.indicador] = l;
  }
  return out;
}

export type TextosMetas = Record<IndicadorProdutividade, string>;

export const textosDasLinhas = (proprias: Partial<Record<IndicadorProdutividade, MetaProdutividade>>): TextosMetas =>
  Object.fromEntries(INDICADORES_PRODUTIVIDADE.map((i) => [i, proprias[i] ? textoDoCampo(i, proprias[i].valor) : ''])) as TextosMetas;

export type ErrosMetas = Partial<Record<IndicadorProdutividade | 'vigencia_inicio' | 'alvo', string>>;

/** O que o Salvar grava: o `PUT` em lote com as metas alteradas e os ids das linhas apagadas ("voltar a herdar"). */
export function mudancas(
  textos: TextosMetas,
  proprias: Partial<Record<IndicadorProdutividade, MetaProdutividade>>,
  alvo: AlvoEscolhido,
  vigencia: string,
): { ok: true; put: MetasProdutividadePut | null; herdar: string[] } | { ok: false; erros: ErrosMetas } {
  const erros: ErrosMetas = {};
  const metas: MetasProdutividadePut['metas'] = [];
  const herdar: string[] = [];
  for (const i of INDICADORES_PRODUTIVIDADE) {
    const lido = lerMeta(i, textos[i]);
    if (!lido.ok) {
      erros[i] = lido.erro;
      continue;
    }
    const propria = proprias[i];
    if (lido.valor === null) {
      if (propria) herdar.push(propria.id);
    } else if (!propria || propria.valor !== lido.valor) metas.push({ indicador: i, valor: lido.valor });
  }
  if (Object.keys(erros).length > 0) return { ok: false, erros };
  const put = metas.length > 0 ? { escopo: alvo.escopo, equipe_id: alvo.equipe_id, usuario_id: alvo.usuario_id, vigencia_inicio: vigencia, metas } : null;
  return { ok: true, put, herdar };
}

/** Erros do domain (`validarMetaProdutividade`) ou do 422 `META_PRODUTIVIDADE_INVALIDA` (`detalhes.erros` ou `detalhes.campo`) no campo. */
export function errosNoCampo(erros: readonly ErroMetaProdutividade[]): { campos: ErrosMetas; soltos: string[] } {
  const campos: ErrosMetas = {};
  const soltos: string[] = [];
  for (const e of erros) {
    const campo = (INDICADORES_PRODUTIVIDADE as readonly string[]).includes(e.campo) || e.campo === 'vigencia_inicio' ? (e.campo as keyof ErrosMetas) : e.campo === 'equipe_id' || e.campo === 'usuario_id' || e.campo === 'escopo' ? 'alvo' : null;
    if (campo) campos[campo] = campos[campo] ? `${campos[campo]} ${e.mensagem}` : e.mensagem;
    else soltos.push(e.mensagem);
  }
  return { campos, soltos };
}

export function errosDaApi(e: unknown): { campos: ErrosMetas; soltos: string[] } {
  if (e instanceof ApiRequestError && e.status === 422 && e.code === 'META_PRODUTIVIDADE_INVALIDA') {
    const lista = Array.isArray(e.details?.erros)
      ? e.details.erros.filter((x): x is ErroMetaProdutividade => typeof x?.campo === 'string' && typeof x?.mensagem === 'string')
      : typeof e.details?.campo === 'string'
        ? [{ campo: e.details.campo, mensagem: e.message }]
        : [];
    if (lista.length > 0) return errosNoCampo(lista);
  }
  return { campos: {}, soltos: [errorMessage(e)] };
}

// ---- Origem ("Vale hoje") ----

/**
 * Nome da origem da meta que vale: "Padrão do FDV", "Empresa", "Usuário" ou "Equipe <nome>". Na origem equipe, a equipe é a
 * mais próxima do alvo, subindo a árvore, com linha viva do indicador no mês (a mesma subida do domain).
 */
export function rotuloOrigem(
  origem: OrigemMetaProdutividade,
  ctx: { indicador: IndicadorProdutividade; equipeDoAlvo: string | null; linhas: readonly MetaProdutividade[]; equipes: readonly (EquipeArvore & { nome: string })[]; mes: string },
): string {
  if (origem === 'padrao_fdv') return 'Padrão do FDV';
  if (origem === 'tenant') return 'Empresa';
  if (origem === 'usuario') return 'Usuário';
  const porId = new Map(ctx.equipes.map((e) => [e.id, e]));
  const visitadas = new Set<string>();
  for (let id = ctx.equipeDoAlvo; id && !visitadas.has(id); id = porId.get(id)?.equipe_pai_id ?? null) {
    visitadas.add(id);
    const tem = ctx.linhas.some((l) => !l.deleted_at && l.escopo === 'equipe' && l.equipe_id === id && l.indicador === ctx.indicador && l.vigencia_inicio <= ctx.mes);
    if (tem) return porId.get(id)?.nome ?? 'Equipe';
  }
  return 'Equipe';
}
