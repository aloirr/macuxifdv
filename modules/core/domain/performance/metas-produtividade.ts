/**
 * RN-CORE-45: metas de produtividade (T-0170 §6). Funções puras: qual meta vale (`metaProdutividadeVigente`) e a validação
 * da edição do BKO (`validarMetaProdutividade`). A API revalida com a mesma função; a existência do alvo e o escopo de quem
 * edita (RN-CORE-04) ficam na API, que lê o banco.
 *
 * Ordem: usuário > equipe dele, ou a mais próxima subindo a árvore de `core.equipe` > tenant > padrão do FDV (D5). Em cada
 * nível vale a linha viva de maior `vigencia_inicio` ≤ mês.
 */
import {
  ESCOPOS_META_PRODUTIVIDADE,
  FAIXA_META_PRODUTIVIDADE,
  INDICADORES_PRODUTIVIDADE,
  META_PRODUTIVIDADE_PADRAO,
  UNIDADES_PRODUTIVIDADE,
  type EscopoMetaProdutividade,
  type IndicadorProdutividade,
  type OrigemMetaProdutividade,
} from '../../contracts/performance';

/** Linha de `core.meta_produtividade` (pull `meta_produtividade` ou banco). */
export interface LinhaMetaProdutividade {
  escopo: EscopoMetaProdutividade;
  equipe_id: string | null;
  usuario_id: string | null;
  indicador: IndicadorProdutividade;
  valor: number;
  /** AAAA-MM. */
  vigencia_inicio: string;
  deleted_at?: string | null;
}

/** Nó da árvore de `core.equipe`. */
export interface EquipeArvore {
  id: string;
  equipe_pai_id: string | null;
}

export interface MetaResolvida {
  valor: number;
  origem: OrigemMetaProdutividade;
}
/** Meta por indicador; ausente = sem meta (`sem_meta`, só se a D5 fosse recusada). */
export type MetasProdutividadeResolvidas = Partial<Record<IndicadorProdutividade, MetaResolvida>>;

/** Para quem a meta é resolvida: o usuário (com a equipe dele), uma equipe, ou o tenant (os dois nulos). */
export interface AlvoMetaProdutividade {
  usuario_id?: string | null;
  equipe_id?: string | null;
}

export interface EntradaMetaVigente {
  linhas: readonly LinhaMetaProdutividade[];
  equipes: readonly EquipeArvore[];
  alvo: AlvoMetaProdutividade;
  /** Último mês do período (AAAA-MM). */
  mes: string;
}

/** D5: as 12 metas do padrão do FDV. */
export function metasPadrao(): Record<IndicadorProdutividade, MetaResolvida> {
  return Object.fromEntries(
    INDICADORES_PRODUTIVIDADE.map((i) => [i, { valor: META_PRODUTIVIDADE_PADRAO[i], origem: 'padrao_fdv' }]),
  ) as Record<IndicadorProdutividade, MetaResolvida>;
}

/** Equipe do alvo e as de cima, da mais próxima à raiz (ciclo na árvore termina a subida). */
function cadeiaDeEquipes(equipeId: string | null | undefined, equipes: readonly EquipeArvore[]): string[] {
  const pai = new Map(equipes.map((e) => [e.id, e.equipe_pai_id]));
  const out: string[] = [];
  for (let id = equipeId ?? null; id !== null && !out.includes(id); id = pai.get(id) ?? null) out.push(id);
  return out;
}

/** RN-CORE-45: a meta que vale para o alvo, num indicador e num mês, com a origem. */
export function metaProdutividadeVigente(
  e: EntradaMetaVigente & { indicador: IndicadorProdutividade },
): MetaResolvida {
  return metasProdutividadeVigentes(e)[e.indicador];
}

/** RN-CORE-45: as 12 metas que valem para o alvo no mês, com a origem de cada uma. */
export function metasProdutividadeVigentes(
  e: EntradaMetaVigente,
): Record<IndicadorProdutividade, MetaResolvida> {
  const vivas = e.linhas.filter((l) => !l.deleted_at && l.vigencia_inicio <= e.mes);
  const maisRecente = (
    filtro: (l: LinhaMetaProdutividade) => boolean,
    indicador: IndicadorProdutividade,
  ): LinhaMetaProdutividade | null =>
    vivas
      .filter((l) => l.indicador === indicador && filtro(l))
      .reduce<LinhaMetaProdutividade | null>(
        (m, l) => (m === null || l.vigencia_inicio > m.vigencia_inicio ? l : m),
        null,
      );
  const cadeia = cadeiaDeEquipes(e.alvo.equipe_id, e.equipes);
  const out = metasPadrao();
  for (const indicador of INDICADORES_PRODUTIVIDADE) {
    const usuario = e.alvo.usuario_id
      ? maisRecente((l) => l.escopo === 'usuario' && l.usuario_id === e.alvo.usuario_id, indicador)
      : null;
    if (usuario) {
      out[indicador] = { valor: usuario.valor, origem: 'usuario' };
      continue;
    }
    let achou = false;
    for (const equipeId of cadeia) {
      const equipe = maisRecente((l) => l.escopo === 'equipe' && l.equipe_id === equipeId, indicador);
      if (equipe) {
        out[indicador] = { valor: equipe.valor, origem: 'equipe' };
        achou = true;
        break;
      }
    }
    if (achou) continue;
    const tenant = maisRecente((l) => l.escopo === 'tenant', indicador);
    if (tenant) out[indicador] = { valor: tenant.valor, origem: 'tenant' };
  }
  return out;
}

// ---- Validação da edição (§6.4) ----

export interface EdicaoMetasProdutividade {
  escopo: string;
  equipe_id: string | null;
  usuario_id: string | null;
  vigencia_inicio: string;
  metas: readonly { indicador: string; valor: number }[];
}

export interface EntradaValidacaoMetaProdutividade {
  edicao: EdicaoMetasProdutividade;
  /** Mês de hoje (AAAA-MM) no fuso do tenant. */
  mes_hoje: string;
  /** Linhas vivas do tenant, para conferir a ordem dos check-ins na meta resolvida do alvo. */
  linhas: readonly LinhaMetaProdutividade[];
  equipes: readonly EquipeArvore[];
  /** Equipe do usuário-alvo (escopo usuário), para a meta herdada. */
  equipe_do_usuario?: string | null;
}

export interface ErroMetaProdutividade {
  /** `vigencia_inicio`, `escopo`, `equipe_id`, `usuario_id`, `metas` ou a chave do indicador. */
  campo: string;
  mensagem: string;
}
export type ValidacaoMetaProdutividade =
  { ok: true } | { ok: false; codigo: 'META_PRODUTIVIDADE_INVALIDA'; erros: ErroMetaProdutividade[] };

const ANO_MES = /^\d{4}-(0[1-9]|1[0-2])$/;
const ehIndicador = (s: string): s is IndicadorProdutividade =>
  (INDICADORES_PRODUTIVIDADE as readonly string[]).includes(s);
const ehEscopo = (s: string): s is EscopoMetaProdutividade =>
  (ESCOPOS_META_PRODUTIVIDADE as readonly string[]).includes(s);

const hhmm = (min: number) =>
  `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
/** Uma casa com vírgula, sem depender do Intl do aparelho. */
const decimal = (n: number, div: number) => (n / div).toFixed(1).replace('.', ',');

/** Faixa aceita na unidade que o BKO mostra (§6.4). */
function faixaLegivel(i: IndicadorProdutividade): string {
  const [min, max] = FAIXA_META_PRODUTIVIDADE[i];
  switch (UNIDADES_PRODUTIVIDADE[i]) {
    case 'minuto_do_dia':
      return `de ${hhmm(min)} a ${hhmm(max)}`;
    case 'minutos':
      return `de ${min} a ${max} min`;
    case 'pontos_base':
      return `de ${min / 100}% a ${max / 100}%`;
    case 'decimos':
      return `de ${decimal(min, 10)} a ${decimal(max, 10)}`;
    case 'metros':
      return i === 'raio_checkin'
        ? `de ${min} a ${max} m`
        : `de ${decimal(min, 1000)} a ${decimal(max, 1000)} km`;
  }
}

/** RN-CORE-45: valida a edição em lote do BKO (§6.4). A API devolve 422 `META_PRODUTIVIDADE_INVALIDA` com os erros. */
export function validarMetaProdutividade(e: EntradaValidacaoMetaProdutividade): ValidacaoMetaProdutividade {
  const erros: ErroMetaProdutividade[] = [];
  const { edicao } = e;
  if (!ANO_MES.test(edicao.vigencia_inicio))
    erros.push({ campo: 'vigencia_inicio', mensagem: 'Mês de início inválido. Use AAAA-MM.' });
  else if (edicao.vigencia_inicio < e.mes_hoje)
    erros.push({
      campo: 'vigencia_inicio',
      mensagem: 'Escolha o mês de hoje ou um mês seguinte. O mês que já começou não muda.',
    });

  if (!ehEscopo(edicao.escopo))
    erros.push({ campo: 'escopo', mensagem: 'Escolha Empresa, Equipe ou Usuário.' });
  if ((edicao.escopo === 'equipe') !== Boolean(edicao.equipe_id))
    erros.push({
      campo: 'equipe_id',
      mensagem: edicao.escopo === 'equipe' ? 'Escolha a equipe.' : 'Equipe só no escopo Equipe.',
    });
  if ((edicao.escopo === 'usuario') !== Boolean(edicao.usuario_id))
    erros.push({
      campo: 'usuario_id',
      mensagem: edicao.escopo === 'usuario' ? 'Escolha o usuário.' : 'Usuário só no escopo Usuário.',
    });

  if (edicao.metas.length === 0) erros.push({ campo: 'metas', mensagem: 'Preencha ao menos uma meta.' });
  const vistos = new Set<string>();
  const editadas = new Map<IndicadorProdutividade, number>();
  for (const m of edicao.metas) {
    if (!ehIndicador(m.indicador)) {
      erros.push({ campo: 'metas', mensagem: `Indicador desconhecido: ${m.indicador}.` });
      continue;
    }
    if (vistos.has(m.indicador)) {
      erros.push({ campo: m.indicador, mensagem: 'Indicador repetido.' });
      continue;
    }
    vistos.add(m.indicador);
    const [min, max] = FAIXA_META_PRODUTIVIDADE[m.indicador];
    if (!Number.isInteger(m.valor) || m.valor < min || m.valor > max) {
      erros.push({
        campo: m.indicador,
        mensagem: `Meta fora da faixa aceita: ${faixaLegivel(m.indicador)}.`,
      });
      continue;
    }
    editadas.set(m.indicador, m.valor);
  }

  // Último check-in ≥ 1º check-in, na meta resolvida do mesmo alvo (a edição vale no nível do alvo e vence o resto).
  if (erros.length === 0 && (editadas.has('primeiro_checkin') || editadas.has('ultimo_checkin'))) {
    const alvo: AlvoMetaProdutividade =
      edicao.escopo === 'usuario'
        ? { usuario_id: edicao.usuario_id, equipe_id: e.equipe_do_usuario ?? null }
        : edicao.escopo === 'equipe'
          ? { equipe_id: edicao.equipe_id }
          : {};
    const vigentes = metasProdutividadeVigentes({
      linhas: e.linhas,
      equipes: e.equipes,
      alvo,
      mes: edicao.vigencia_inicio,
    });
    const primeiro = editadas.get('primeiro_checkin') ?? vigentes.primeiro_checkin.valor;
    const ultimo = editadas.get('ultimo_checkin') ?? vigentes.ultimo_checkin.valor;
    if (ultimo < primeiro) {
      const campo = editadas.has('ultimo_checkin') ? 'ultimo_checkin' : 'primeiro_checkin';
      erros.push({
        campo,
        mensagem: `O último check-in (${hhmm(ultimo)}) não pode vir antes do 1º check-in (${hhmm(primeiro)}).`,
      });
    }
  }
  return erros.length === 0 ? { ok: true } : { ok: false, codigo: 'META_PRODUTIVIDADE_INVALIDA', erros };
}
