/**
 * Apresentação da própria RV no app Campo (T-0082; RN-CORE-29/30). Função pura: recebe a cópia guardada no aparelho
 * (`RvLocal`, vinda de `GET /v1/core/rv`) e devolve os textos prontos. A conta da RV é do servidor (domain `calcularRvDaPessoa`);
 * aqui só se escolhe o que mostrar. Offline: vale o último cálculo recebido, sempre com a data dele.
 */
import { formatBRL0 } from '@macuxi/comum';
import { desenhoBotaoSincronizar } from '@macuxi/ui/mobile/puro';

import { ROTULO_INDICADOR_META, RvLocalSchema, type RvLocal } from '../../contracts';
import { formatarIndicador } from './metas-formato';

export type TomRv = 'sucesso' | 'aviso' | 'neutro';

export interface LinhaMinhaRv {
  indicador: string;
  rotulo: string;
  /** "Meta 100 · realizado 80" ou "Sem meta definida" */
  detalhe: string;
  /** atingimento (projetado no mês aberto) em % com 1 casa, ex.: "92,5%"; "—" sem meta */
  atingimento: string;
  /** barra de progresso, 0 a 100+ */
  progresso_pct: number;
  /** faixa atingida: "Faixa atingida: paga 100%" / "Abaixo da primeira faixa" */
  faixa: string;
  valor: string;
  gatilho: boolean;
  /** só gatilho: ver `textoDoGatilhoRv` */
  gatilho_texto: string | null;
  tom: TomRv;
}

export type VisaoMinhaRv =
  | { tipo: 'sem_calculo'; titulo: string; texto: string }
  | { tipo: 'sem_plano'; titulo: string; texto: string; calculado_em: string }
  | {
      tipo: 'ok';
      periodo: string;
      parcial: boolean;
      /** "RV projetada" (mês aberto) ou "RV do mês" (fechado) */
      rotulo: string;
      valor: string;
      /** "No ritmo" / "Ainda não atingido" (mês aberto); "Atingida" / "Não atingida" (fechado) */
      estado: string;
      tom: TomRv;
      /** Mês aberto sem gatilho barrando: o que o chip significa; senão null */
      explicacao_estado: string | null;
      /** Mês aberto: "Gatilho de X ainda não atingido: se o mês fechar assim, a RV zera."; fechado: "Gatilho não atingido em X: a RV está zerada."; ou null */
      aviso_gatilho: string | null;
      /** "Bruta seria R$ …" quando o gatilho zerou */
      bruta: string | null;
      nota: string;
      calculado_em: string;
      linhas: LinhaMinhaRv[];
    };

/**
 * Texto da linha do gatilho. Mesmos textos aprovados do BKO (`textoDoGatilho` em web/lib/plano-rv.ts; a equivalência é fixada
 * em minha-rv.test.ts). No mês aberto é projeção, não fato; só o mês fechado diz que a RV zerou.
 */
export function textoDoGatilhoRv(ok: boolean | null, bloqueado: boolean, parcial: boolean): string {
  if (ok === null) return 'Sem meta: não bloqueia a RV';
  if (ok) return parcial ? 'No ritmo: mantém a RV se o mês fechar assim' : 'Atingido';
  if (parcial) return 'Ainda não atingido: se o mês fechar assim, a RV zera';
  return bloqueado ? 'Não atingido (RV zerada)' : 'Não atingido';
}

/**
 * Toque em Sincronizar do cartão (estados "sem cálculo" e "erro"): sem sinal não chama o motor e devolve o aviso padrão do
 * botão Sincronizar do app (`desenhoBotaoSincronizar`); com sinal devolve null. O último cálculo guardado não é tocado.
 */
export function avisoAoSincronizarRv(semSinal: boolean): string | null {
  return desenhoBotaoSincronizar({ semSinal, recente: false, sincronizadoEm: null, naFila: 0 }).aviso;
}

const pctTexto = (v: number): string => (Number.isInteger(v) ? String(v) : v.toFixed(1).replace('.', ','));
const pbp = (v: number): string => `${(v / 100).toFixed(1).replace('.', ',')}%`;

/** "05/11 às 10:30" no fuso do tenant, a data do cálculo que o aparelho tem. */
export function dataDoCalculo(iso: string, fuso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'data desconhecida';
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('pt-BR', { timeZone: fuso, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(d).map((x) => [x.type, x.value]),
  );
  return `${p.day}/${p.month} às ${p.hour}:${p.minute}`;
}

const mesPorExtenso = (periodo: string): string => {
  const meses = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  return `${meses[Number(periodo.slice(5, 7)) - 1] ?? periodo} de ${periodo.slice(0, 4)}`;
};

export function montarMinhaRv(copia: RvLocal | null, usuarioId: string, fuso: string): VisaoMinhaRv {
  if (!copia) {
    return {
      tipo: 'sem_calculo',
      titulo: 'Sua RV ainda não foi calculada',
      texto: 'Conecte-se à internet e toque em Sincronizar. O último cálculo recebido fica guardado aqui.',
    };
  }
  const calculado_em = dataDoCalculo(copia.recebido_em, fuso);
  const p = copia.painel.pessoas.find((x) => x.usuario_id === usuarioId);
  if (!p) {
    return {
      tipo: 'sem_plano',
      titulo: 'Sem plano de RV para você neste mês',
      texto: 'O plano de RV da sua empresa não vale para o seu perfil neste mês. Fale com o seu gestor.',
      calculado_em,
    };
  }
  const parcial = copia.painel.situacao === 'parcial';
  const bloqueada = p.bloqueada_por.length > 0;
  const linhas: LinhaMinhaRv[] = p.indicadores.map((i) => {
    const ating = parcial ? i.projetado_pbp : i.atingimento_pbp;
    const rotulo = ROTULO_INDICADOR_META[i.indicador];
    const detalhe = i.sem_meta || i.meta === null ? 'Sem meta definida' : `Meta ${formatarIndicador(i.indicador, i.meta)} · realizado ${formatarIndicador(i.indicador, i.realizado)}`;
    const gatilho_texto = i.gatilho ? textoDoGatilhoRv(i.gatilho_ok, p.bloqueada_por.includes(i.indicador), parcial) : null;
    const tom: TomRv = i.gatilho ? (i.gatilho_ok === null ? 'neutro' : i.gatilho_ok ? 'sucesso' : 'aviso') : i.pagamento_pct > 0 ? 'sucesso' : 'neutro';
    return {
      indicador: i.indicador,
      rotulo,
      detalhe,
      atingimento: i.sem_meta ? '—' : parcial ? `${pbp(ating)} projetado` : pbp(ating),
      progresso_pct: i.sem_meta ? 0 : Math.min(ating / 100, 100),
      faixa: i.gatilho ? '' : i.sem_meta ? 'Sem meta: não paga' : i.pagamento_pct > 0 ? `Faixa atingida: paga ${pctTexto(i.pagamento_pct)}%` : 'Abaixo da primeira faixa: não paga',
      valor: i.gatilho ? '' : formatBRL0(i.valor_cents),
      gatilho: i.gatilho,
      gatilho_texto,
      tom,
    };
  });
  const noRitmo = !bloqueada && p.rv_cents > 0;
  const nomes = p.bloqueada_por.map((k) => ROTULO_INDICADOR_META[k]).join(', ');
  return {
    tipo: 'ok',
    periodo: copia.painel.periodo,
    parcial,
    rotulo: parcial ? 'RV projetada' : 'RV do mês',
    valor: formatBRL0(p.rv_cents),
    estado: parcial ? (noRitmo ? 'No ritmo' : 'Ainda não atingido') : noRitmo ? 'Atingida' : 'Não atingida',
    tom: noRitmo ? 'sucesso' : 'aviso',
    explicacao_estado: parcial && !bloqueada ? (noRitmo ? 'Mantém a RV se o mês fechar assim' : 'Se o mês fechar assim, a RV zera') : null,
    aviso_gatilho: bloqueada ? (parcial ? `Gatilho de ${nomes} ainda não atingido: se o mês fechar assim, a RV zera.` : `Gatilho não atingido em ${nomes}: a RV está zerada.`) : null,
    bruta: bloqueada ? `Sem o gatilho seria ${formatBRL0(p.rv_bruta_cents)}` : null,
    nota: parcial
      ? `${mesPorExtenso(copia.painel.periodo)} · parcial até o fechamento (${copia.painel.fechamento_em.split('-').reverse().join('/')})`
      : `${mesPorExtenso(copia.painel.periodo)} · mês fechado`,
    calculado_em,
    linhas,
  };
}

/** Cópia da RV lida do aparelho: inválida (outra versão do app, corrompida) vira `null` = "sem cálculo", nunca derruba a tela. */
export function validarCopiaRv(bruto: unknown): RvLocal | null {
  const r = RvLocalSchema.safeParse(bruto);
  return r.success ? r.data : null;
}
