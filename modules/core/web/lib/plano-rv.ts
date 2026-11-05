/**
 * Visão da tela "Plano de RV" do BKO (RN-CORE-29/30; T-0082): funções puras sobre `/v1/core/plano-rv` e `/v1/core/rv`.
 * Sem React e sem rede. As regras (pesos, faixas, cálculo) moram no domain; aqui só formulário, texto, simulador e CSV.
 */
import { formatBRL } from '@macuxi/comum';
import { INDICADORES_META, type PlanoRvDto, type PlanoRvPut, type RvPainel } from '../../contracts';
import { calcularRvDaPessoa, validarPlanoRv, type FaixaRv, type IndicadorRv, type PerfilRv, type PlanoRv, type SituacaoRv } from '../../domain';

const BOM = String.fromCharCode(0xfeff); // o Excel abre o CSV em UTF-8
/** Célula de CSV: texto que começaria com `=`, `+`, `-`, `@`, TAB ou CR ganha um apóstrofo na frente (o Excel não o executa como fórmula). */
export const protegerFormula = (v: string): string => (/^[=+\-@\t\r]/.test(v) ? `'${v}` : v);
const aspas = (v: string) => `"${protegerFormula(v).replace(/"/g, '""')}"`;

export const ROTULO_INDICADOR_RV: Record<IndicadorRv, string> = {
  venda_cents: 'Venda',
  positivacao: 'Positivação',
  cobertura_pct: 'Cobertura de rota',
  visitas: 'Visitas',
};
export const ROTULO_PERFIL_RV: Record<PerfilRv, string> = { vendedor: 'Vendedor', promotor: 'Promotor' };
export const ROTULO_MODO: Record<FaixaRv['modo'], string> = { zero: 'Não paga', proporcional: 'Igual ao atingimento (85% paga 85%)', fixo: 'Percentual fixo' };

/** Troca o código do indicador (venda_cents...) pelo rótulo em erros do domain e da API: a tela não mostra nome de campo técnico. */
export function textoDoErroRv(msg: string): string {
  let t = msg;
  for (const [cod, rot] of Object.entries(ROTULO_INDICADOR_RV)) {
    t = t.replace(new RegExp(`^${cod}: (.)`, 'm'), (_m, c: string) => `${rot}: ${c.toLowerCase()}`);
    t = t.replace(new RegExp(`\\b${cod}\\b`, 'g'), rot);
  }
  return t;
}

export interface FormFaixa {
  de: string;
  modo: FaixaRv['modo'];
  pagamento: string;
}
export interface FormRegra {
  indicador: IndicadorRv;
  ativo: boolean;
  gatilho: boolean;
  peso: string;
  faixas: FormFaixa[];
}
export interface FormPlano {
  nome: string;
  vigencia_inicio: string;
  perfis: Record<PerfilRv, boolean>;
  /** reais, como digitado: "2.000,00" */
  valor_maximo: string;
  regras: FormRegra[];
}

const FAIXAS_PADRAO: FormFaixa[] = [
  { de: '0', modo: 'zero', pagamento: '0' },
  { de: '80', modo: 'proporcional', pagamento: '0' },
  { de: '100', modo: 'fixo', pagamento: '100' },
];
const copiaFaixas = (f: FormFaixa[]): FormFaixa[] => f.map((x) => ({ ...x }));

/** Plano novo: venda 70% e positivação 30% com as faixas usuais; os outros indicadores ficam desligados. */
export function formNovo(vigenciaInicio: string): FormPlano {
  return {
    nome: '',
    vigencia_inicio: vigenciaInicio,
    perfis: { vendedor: true, promotor: false },
    valor_maximo: '',
    regras: INDICADORES_META.map((indicador) => ({
      indicador,
      ativo: indicador === 'venda_cents' || indicador === 'positivacao',
      gatilho: false,
      peso: indicador === 'venda_cents' ? '70' : indicador === 'positivacao' ? '30' : '0',
      faixas: copiaFaixas(FAIXAS_PADRAO),
    })),
  };
}

export const reaisDoCents = (cents: number): string => (cents / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Plano gravado -> formulário (nova versão parte de uma cópia: troque o mês de início). */
export function formDoPlano(p: PlanoRvDto | PlanoRv): FormPlano {
  const base = formNovo(p.vigencia_inicio);
  return {
    nome: p.nome,
    vigencia_inicio: p.vigencia_inicio,
    perfis: { vendedor: p.perfis.includes('vendedor'), promotor: p.perfis.includes('promotor') },
    valor_maximo: reaisDoCents(p.valor_maximo_cents),
    regras: base.regras.map((vazia) => {
      const r = p.regras.find((x) => x.indicador === vazia.indicador);
      if (!r) return { ...vazia, ativo: false, peso: '0' };
      return {
        indicador: r.indicador,
        ativo: true,
        gatilho: r.gatilho,
        peso: String(r.peso_pct),
        faixas: r.faixas.length > 0 ? r.faixas.map((f) => ({ de: String(f.de_pct), modo: f.modo, pagamento: String(f.pagamento_pct) })) : copiaFaixas(FAIXAS_PADRAO),
      };
    }),
  };
}

/** O formulário mudou em relação ao que foi aberto? (para pedir confirmação ao sair com o editor aberto). */
export function formularioAlterado(inicial: FormPlano, atual: FormPlano): boolean {
  return JSON.stringify(inicial) !== JSON.stringify(atual);
}

/**
 * RN-CORE-30: o primeiro plano do tenant com início antes do mês aberto vale para meses já fechados e nasce sem edição nem exclusão.
 * Qualquer outro caso com início no passado a API já recusa (reescreveria mês fechado).
 */
export function avisoDoPrimeiroPlanoNoPassado(vigenciaInicio: string, hoje: string, planosExistentes: number): string | null {
  if (planosExistentes > 0 || vigenciaInicio >= hoje.slice(0, 7)) return null;
  return `Este plano começa em ${textoDoMes(vigenciaInicio)} e vai valer para meses já fechados. Depois de salvo, não poderá ser alterado nem excluído; só dá para criar uma versão nova a partir do mês aberto. Salvar mesmo assim?`;
}

/** "2.000,00" ou "2000" -> centavos; texto inválido = null. */
export function centavosDoTexto(texto: string): number | null {
  const limpo = texto.trim().replace(/\./g, '').replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(limpo)) return null;
  return Math.round(Number(limpo) * 100);
}

const inteiro = (t: string): number | null => (/^\d{1,3}$/.test(t.trim()) ? Number(t.trim()) : null);

/** Soma dos pesos dos indicadores ligados que não são gatilho (RN-CORE-30: deve fechar 100). */
export function somaDosPesos(f: FormPlano): number {
  return f.regras.filter((r) => r.ativo && !r.gatilho).reduce((s, r) => s + (inteiro(r.peso) ?? 0), 0);
}

export function textoDosPesos(f: FormPlano): string {
  const s = somaDosPesos(f);
  return s === 100 ? 'Pesos somam 100%.' : `Pesos somam ${s}%: ajuste até fechar 100%.`;
}

export type ResultadoForm = { ok: true; corpo: PlanoRvPut } | { ok: false; erros: string[] };

/** Formulário -> corpo do PUT. Os erros são os do domain (RN-CORE-30), em português, mais os de digitação. */
export function corpoDoFormulario(f: FormPlano): ResultadoForm {
  const erros: string[] = [];
  const nome = f.nome.trim();
  if (!nome) erros.push('Dê um nome ao plano.');
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(f.vigencia_inicio)) erros.push('Informe o mês de início da vigência.');
  const valor = centavosDoTexto(f.valor_maximo);
  if (valor === null || valor <= 0) erros.push('Informe o valor da RV com 100% em tudo, em reais, maior que zero.');
  const perfis = (['vendedor', 'promotor'] as const).filter((p) => f.perfis[p]);
  const regras: PlanoRv['regras'] = [];
  for (const r of f.regras.filter((x) => x.ativo)) {
    const peso = r.gatilho ? 0 : inteiro(r.peso);
    if (peso === null) {
      erros.push(`${ROTULO_INDICADOR_RV[r.indicador]}: informe o peso, de 0 a 100.`);
      continue;
    }
    const faixas: FaixaRv[] = [];
    if (!r.gatilho) {
      for (const x of r.faixas) {
        const de = inteiro(x.de);
        const pg = x.modo === 'fixo' ? inteiro(x.pagamento) : 0;
        if (de === null || pg === null) {
          erros.push(`${ROTULO_INDICADOR_RV[r.indicador]}: preencha o "a partir de" e o percentual das faixas com números inteiros.`);
          break;
        }
        faixas.push({ de_pct: de, modo: x.modo, pagamento_pct: pg });
      }
    }
    regras.push({ indicador: r.indicador, peso_pct: peso, gatilho: r.gatilho, faixas });
  }
  if (erros.length > 0 || valor === null) return { ok: false, erros };
  const plano: PlanoRv = { id: 'novo', nome, vigencia_inicio: f.vigencia_inicio, perfis, valor_maximo_cents: valor, regras };
  const doDomain = validarPlanoRv(plano);
  if (doDomain.length > 0) return { ok: false, erros: doDomain.map(textoDoErroRv) };
  return { ok: true, corpo: { nome, vigencia_inicio: f.vigencia_inicio, perfis, valor_maximo_cents: valor, regras } };
}

/** Descrição das faixas de um indicador, em frases: "Abaixo de 80%: não paga · de 80% a 99%: paga o mesmo % do atingimento · a partir de 100%: paga 100% do peso". */
export function textoDasFaixas(faixas: FormFaixa[]): string {
  const validas = faixas
    .flatMap((x) => {
      const de = inteiro(x.de);
      const pg = x.modo === "fixo" ? inteiro(x.pagamento) : 0;
      return de === null || pg === null ? [] : [{ de, modo: x.modo, pg }];
    })
    .sort((p, q) => p.de - q.de);
  if (validas.length === 0) return "Sem faixas.";
  return validas
    .map((f, i) => {
      const prox = validas[i + 1];
      const faixa = prox ? (f.de === 0 ? `Abaixo de ${prox.de}%` : `de ${f.de}% a ${prox.de - 1}%`) : `a partir de ${f.de}%`;
      const paga = f.modo === "zero" ? "não paga" : f.modo === "proporcional" ? "paga o mesmo % do atingimento" : `paga ${f.pg}% do peso`;
      return `${faixa}: ${paga}`;
    })
    .join(" · ")
    .replace(/^./, (c) => c.toUpperCase());
}

export interface LinhaSimulada {
  indicador: IndicadorRv;
  gatilho: boolean;
  pagamento_pct: number;
  valor_cents: number;
  gatilho_ok: boolean | null;
}

/**
 * Simulador (mês fechado): atingimento digitado por indicador (em %) -> RV pelo MESMO domain da API, sem chamada.
 * Atingimento vazio = indicador sem meta (paga 0; gatilho não bloqueia).
 */
export function simularRv(plano: PlanoRv, atingimentos: Partial<Record<IndicadorRv, string>>): { rv_cents: number; linhas: LinhaSimulada[]; bloqueada: boolean } {
  const metas: Partial<Record<IndicadorRv, number>> = {};
  const realizados: Partial<Record<IndicadorRv, number>> = {};
  for (const r of plano.regras) {
    const t = (atingimentos[r.indicador] ?? '').trim().replace(',', '.');
    if (!/^\d+(\.\d+)?$/.test(t)) continue;
    metas[r.indicador] = 100;
    realizados[r.indicador] = Number(t);
  }
  const situacao: SituacaoRv = 'fechado';
  const rv = calcularRvDaPessoa(plano, metas, realizados, { total: 1, elapsed: 1, remaining: 0 }, situacao);
  return {
    rv_cents: rv.rv_cents,
    bloqueada: rv.bloqueada_por.length > 0,
    linhas: rv.indicadores.map((l) => ({ indicador: l.indicador, gatilho: l.gatilho, pagamento_pct: l.pagamento_pct, valor_cents: l.valor_cents, gatilho_ok: l.gatilho_ok })),
  };
}

/** Pontos-base (10000 = 100%) para texto: 8500 -> "85%"; 8525 -> "85,25%". */
export function textoDePbp(pbp: number): string {
  const pct = pbp / 100;
  return `${Number.isInteger(pct) ? pct : pct.toFixed(2).replace('.', ',')}%`;
}

export function textoDaMeta(indicador: IndicadorRv, v: number | null): string {
  if (v === null) return 'Sem meta';
  if (indicador === 'venda_cents') return formatBRL(v);
  if (indicador === 'cobertura_pct') return textoDePbp(v);
  return String(v);
}

export function textoDoMes(ym: string): string {
  return `${ym.slice(5, 7)}/${ym.slice(0, 4)}`;
}

const dataBr = (iso: string): string => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
const MESES = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
/** "2026-11" -> "Novembro 2026". */
export const nomeDoMes = (ym: string): string => `${MESES[Number(ym.slice(5, 7)) - 1] ?? ym.slice(5, 7)} ${ym.slice(0, 4)}`;

export const textoDaSituacao = (s: RvPainel["situacao"], fechamentoEm: string, periodo?: string): string => {
  const mes = periodo ? nomeDoMes(periodo) : "O mês";
  return s === "fechado"
    ? `${mes} fechado: a RV usa o realizado final.`
    : `${mes} fecha em ${dataBr(fechamentoEm)}. Até lá a RV é uma estimativa: venda e visitas são projetadas pelo ritmo dos dias úteis, e o valor muda a cada dia.`;
};

export function textoDoGatilho(ok: boolean | null, bloqueado: boolean, situacao: RvPainel['situacao'] = 'fechado'): string {
  if (ok === null) return '—';
  if (ok) return situacao === 'parcial' ? 'No ritmo: mantém a RV se o mês fechar assim' : 'Atingido';
  if (situacao === 'parcial') return 'Ainda não atingido: se o mês fechar assim, a RV zera';
  return bloqueado ? 'Não atingido (RV zerada)' : 'Não atingido';
}

const cabecalhoCsv = (parcial: boolean) => ['Pessoa', 'Indicador', 'Meta', 'Realizado', parcial ? 'Atingimento projetado' : 'Atingimento', 'Pago (%)', 'Valor (R$)', 'Gatilho', 'RV da pessoa (R$)'];

/** Uma linha por pessoa e indicador (a tela mostra o mesmo recorte). */
export function csvDeRv(p: RvPainel): string {
  const linhas = p.pessoas.flatMap((pessoa) =>
    pessoa.indicadores.map((i) =>
      [
        pessoa.nome,
        ROTULO_INDICADOR_RV[i.indicador],
        textoDaMeta(i.indicador, i.meta),
        textoDaMeta(i.indicador, i.realizado),
        i.sem_meta ? '—' : textoDePbp(p.situacao === 'parcial' ? i.projetado_pbp : i.atingimento_pbp),
        String(i.pagamento_pct).replace('.', ','),
        (i.valor_cents / 100).toFixed(2).replace('.', ','),
        i.gatilho ? textoDoGatilho(i.gatilho_ok, pessoa.bloqueada_por.includes(i.indicador), p.situacao) : '',
        (pessoa.rv_cents / 100).toFixed(2).replace('.', ','),
      ]
        .map(aspas)
        .join(';'),
    ),
  );
  return BOM + [cabecalhoCsv(p.situacao === 'parcial').map(aspas).join(';'), ...linhas].join('\r\n');
}
