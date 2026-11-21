/**
 * Início do BKO (T-0189; RN-CORE-64, RN-CORE-65, RN-CORE-66). Funções puras: saudação e data, % e barras do "Hoje", o horário esperado da
 * carga e a carga que não ocorreu, o cadastro incompleto e a montagem dos alertas do cartão "Precisa de você" (a única área de alertas).
 * A API e a tela usam as mesmas funções. Alerta de módulo sem licença nunca é montado.
 */
import {
  HORARIO_CARGA_PADRAO,
  HorarioCargaTexto,
  PARAMETRO_HORARIO_CARGA,
  type ErroHorarioCarga,
  type HorarioCarga,
  type HorarioCargaPut,
} from '../contracts/inicio-bko';
import { CAMPOS_CADASTRO_CLIENTE, ROTULO_CAMPO_CADASTRO, cadastroCompleto, type CampoCadastroCliente, type DadosCadastro } from './cadastro';

const DIAS_SEMANA = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

function partes(instante: Date, fuso: string): Record<string, string> {
  const f = new Intl.DateTimeFormat('en-CA', { timeZone: fuso, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  return Object.fromEntries(f.formatToParts(instante).map((p) => [p.type, p.value]));
}

/** Primeiro nome de um nome completo (espaços sobrando não contam). */
export const primeiroNome = (nome: string | null | undefined): string => (nome ?? '').trim().split(/\s+/)[0] ?? '';

/** RN-CORE-64: "Bom dia, Ana." (até 11h59), "Boa tarde" (até 17h59), "Boa noite", pela hora no fuso do tenant. Sem nome, só a saudação. */
export function saudacaoDoBko(agora: Date, fuso: string, nomeCompleto: string | null | undefined): string {
  const hora = Number(partes(agora, fuso).hour);
  const s = hora < 12 ? 'Bom dia' : hora < 18 ? 'Boa tarde' : 'Boa noite';
  const nome = primeiroNome(nomeCompleto);
  return nome ? `${s}, ${nome}.` : `${s}.`;
}

/** RN-CORE-64: "Sexta, 20 de novembro", no fuso do tenant. */
export function dataPorExtenso(agora: Date, fuso: string): string {
  const p = partes(agora, fuso);
  const dow = new Date(Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day))).getUTCDay();
  return `${DIAS_SEMANA[dow]}, ${Number(p.day)} de ${MESES[Number(p.month) - 1]}`;
}

/** RN-CORE-64: % inteiro do realizado sobre a meta; sem meta (nula ou zero) = null. Pode passar de 100. */
export function percentualDaMeta(realizado: number, meta: number | null | undefined): number | null {
  if (meta === null || meta === undefined || !(meta > 0)) return null;
  return Math.round((realizado / meta) * 100);
}

/** RN-CORE-64: largura da barra, de 0 a 100. */
export function larguraDaBarra(pct: number | null | undefined): number {
  if (pct === null || pct === undefined || Number.isNaN(pct)) return 0;
  return Math.min(100, Math.max(0, Math.round(pct)));
}

// ---------- RN-CORE-65: horário esperado da carga ----------

const HHMM = (v: unknown): v is string => HorarioCargaTexto.safeParse(v).success;
const CHAVE_ENTIDADE = /^[a-z_]{1,40}$/;

/** Chaves em ordem alfabética: o valor gravado e o lido comparam igual (idempotência do PUT). */
const ordenado = (o: Record<string, string | null>): Record<string, string | null> => Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b)));

type LinhaParametro = { modulo: string; chave: string; valor?: unknown; deleted_at?: string | null };

/** RN-CORE-65: valor efetivo do parâmetro `integracao.horario_carga`; ausente ou inválido = 06:00 para todas; override inválido é ignorado. */
export function horarioCargaDasLinhas(linhas: readonly LinhaParametro[]): HorarioCarga {
  const v = linhas.find((l) => l.modulo === 'core' && l.chave === PARAMETRO_HORARIO_CARGA && !l.deleted_at)?.valor;
  const o = v && typeof v === 'object' && !Array.isArray(v) ? (v as { padrao?: unknown; entidades?: unknown }) : {};
  const entidades: Record<string, string | null> = {};
  if (o.entidades && typeof o.entidades === 'object' && !Array.isArray(o.entidades)) {
    for (const [k, h] of Object.entries(o.entidades as Record<string, unknown>)) if (CHAVE_ENTIDADE.test(k) && (h === null || HHMM(h))) entidades[k] = h;
  }
  return { padrao: HHMM(o.padrao) ? o.padrao : HORARIO_CARGA_PADRAO, entidades: ordenado(entidades) };
}

export type ResultadoHorarioCarga = { ok: true; valores: HorarioCarga } | { ok: false; erros: ErroHorarioCarga[] };

/** RN-CORE-65: valida a edição (HH:MM de 00:00 a 23:59; `null` = sem horário). Mensagens em português com a ação seguinte. */
export function validarHorarioCarga(e: HorarioCargaPut): ResultadoHorarioCarga {
  const erros: ErroHorarioCarga[] = [];
  if (!HHMM(e.padrao)) erros.push({ campo: 'padrao', mensagem: 'Informe o horário padrão no formato HH:MM, de 00:00 a 23:59.' });
  const entidades: Record<string, string | null> = {};
  for (const [k, h] of Object.entries(e.entidades)) {
    if (!CHAVE_ENTIDADE.test(k)) erros.push({ campo: 'entidades', mensagem: `Entidade "${k}" desconhecida. Escolha uma da lista.` });
    else if (h !== null && !HHMM(h)) erros.push({ campo: 'entidades', mensagem: `Horário de ${rotuloDaEntidade(k)} inválido. Use HH:MM, de 00:00 a 23:59, ou deixe sem horário.` });
    else entidades[k] = h;
  }
  return erros.length > 0 ? { ok: false, erros } : { ok: true, valores: { padrao: e.padrao, entidades: ordenado(entidades) } };
}

/** Instante UTC da data civil `dia` (AAAA-MM-DD) às `hhmm` no fuso. */
export function instanteLocal(dia: string, hhmm: string, fuso: string): Date {
  const [a, m, d] = dia.split('-').map(Number) as [number, number, number];
  const [h, mi] = hhmm.split(':').map(Number) as [number, number];
  const alvo = Date.UTC(a, m - 1, d, h, mi);
  let t = alvo;
  for (let i = 0; i < 2; i++) {
    const p = partes(new Date(t), fuso);
    const local = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute));
    t += alvo - local;
  }
  return new Date(t);
}

export interface EntradaCargasAtrasadas {
  agora: Date;
  fuso: string;
  /** Hoje é dia útil do calendário do tenant (`calendarioDoTenant` + `ehDiaUtil`). */
  dia_util: boolean;
  horario: HorarioCarga;
  /** Última carga recebida por entidade (só entidades que já receberam carga). */
  ultimas: readonly { entidade: string; recebido_em: string }[];
}

/**
 * RN-CORE-65: entidades cuja carga não ocorreu. Só em dia útil; alerta quando agora ≥ horário de hoje (do override, ou o padrão) e a última carga
 * recebida é anterior a esse horário. Override `null` = sem horário = sem alerta.
 */
export function cargasAtrasadas(e: EntradaCargasAtrasadas): { entidade: string; ultima_em: string }[] {
  if (!e.dia_util) return [];
  const p = partes(e.agora, e.fuso);
  const hoje = `${p.year}-${p.month}-${p.day}`;
  const saida: { entidade: string; ultima_em: string }[] = [];
  for (const u of e.ultimas) {
    const h = u.entidade in e.horario.entidades ? e.horario.entidades[u.entidade] : e.horario.padrao;
    if (h === null || h === undefined) continue;
    const esperada = instanteLocal(hoje, h, e.fuso);
    if (e.agora.getTime() >= esperada.getTime() && new Date(u.recebido_em).getTime() < esperada.getTime()) saida.push({ entidade: u.entidade, ultima_em: u.recebido_em });
  }
  return saida.sort((a, b) => a.entidade.localeCompare(b.entidade));
}

// ---------- RN-CORE-66: cadastro incompleto ----------

/**
 * RN-CORE-66: conta os clientes (já ativos e do escopo) com cadastro incompleto pela lista efetiva da RN-CORE-16 (`camposExigidos`) e
 * indica o campo que mais falta (empate: a ordem canônica dos campos).
 */
export function cadastroIncompletoDoEscopo(
  clientes: readonly DadosCadastro[],
  exigidos: readonly CampoCadastroCliente[],
): { quantidade: number; campo: string | null; campo_codigo: string | null } {
  const falta = new Map<CampoCadastroCliente, number>();
  let quantidade = 0;
  for (const c of clientes) {
    const r = cadastroCompleto(c, exigidos);
    if (r.completo) continue;
    quantidade += 1;
    for (const f of r.campos_faltantes) falta.set(f, (falta.get(f) ?? 0) + 1);
  }
  let top: CampoCadastroCliente | null = null;
  for (const c of CAMPOS_CADASTRO_CLIENTE) if (falta.has(c) && (top === null || (falta.get(c) ?? 0) > (falta.get(top) ?? 0))) top = c;
  return { quantidade, campo: top ? ROTULO_CAMPO_CADASTRO[top] : null, campo_codigo: top };
}

// ---------- RN-CORE-64: alertas ----------

export type GravidadeAlertaInicio = 'falha' | 'atencao';
export interface ParteTexto {
  texto: string;
  negrito?: boolean;
}
export interface AlertaInicio {
  id: string;
  gravidade: GravidadeAlertaInicio;
  partes: ParteTexto[];
  acao: { rotulo: string; caminho: string };
}

export interface EntradaAlertasInicio {
  agora: Date;
  fuso: string;
  /** Licença dos módulos no tenant: alerta de módulo sem licença não aparece. */
  licencas: { integracao: boolean; gestor: boolean; vendedor: boolean };
  /** Cada assunto ausente (undefined/null) = sem dado ou sem permissão: não vira alerta. */
  mensagens_paradas?: { quantidade: number; desde: string | null } | null;
  lotes_falhos?: readonly { lote_id: string; entidade: string; quando: string; linhas: number }[] | null;
  cargas_atrasadas?: readonly { entidade: string; ultima_em: string | null }[] | null;
  aprovacoes?: { quantidade: number; mais_antigo_em: string | null } | null;
  alertas_abertos?: number | null;
  usuarios_senha_vencida?: number | null;
  cadastro_incompleto?: { quantidade: number; campo: string | null } | null;
}

const ROTULO_ENTIDADE: Record<string, string> = {
  vendedor: 'Vendedores',
  cliente: 'Clientes',
  produto: 'Produtos',
  preco: 'Preços',
  estoque: 'Estoque',
  titulo: 'Títulos',
  nota: 'Notas',
  rota: 'Rotas',
  catalogo_no: 'Catálogo',
  produto_unidade: 'Unidades de produto',
  cliente_endereco: 'Endereços de clientes',
  transportadora: 'Transportadoras',
  forma_pagamento: 'Formas de pagamento',
  prazo_pagamento: 'Prazos de pagamento',
  tabela_escalonada: 'Tabelas escalonadas',
  filial: 'Filiais',
};
/** Entidades da carga do ERP que o tenant pode ajustar em Parâmetros (RN-CORE-65). */
export const ENTIDADES_DE_CARGA: readonly string[] = Object.keys(ROTULO_ENTIDADE);
export const rotuloDaEntidade = (e: string): string => ROTULO_ENTIDADE[e] ?? e.charAt(0).toUpperCase() + e.slice(1).replace(/_/g, ' ');

const milhar = (n: number) => n.toLocaleString('pt-BR');
const plural = (n: number, um: string, varios: string) => `${milhar(n)} ${n === 1 ? um : varios}`;

/** "15/11 às 00:47" no fuso do tenant. */
export function dataHoraCurta(iso: string, fuso: string): string {
  const p = partes(new Date(iso), fuso);
  return `${p.day}/${p.month} às ${p.hour}:${p.minute}`;
}

function duracaoCurta(ms: number): string {
  const min = Math.max(0, Math.floor(ms / 60_000));
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  return h < 24 ? `${h} h` : `${Math.floor(h / 24)} d`;
}

/**
 * RN-CORE-64: do último lote de cada entidade, os que falharam (um já recuperado por lote posterior não alerta). `linhas` = linhas com erro,
 * ou as recebidas quando o lote falhou sem detalhar por linha.
 */
export function lotesFalhosParaOInicio(
  lotes: readonly { lote_id: string; entidade: string; status: string; recebido_em: string; com_erro: number; recebidas: number }[],
): { lote_id: string; entidade: string; quando: string; linhas: number }[] {
  const ultimo = new Map<string, (typeof lotes)[number]>();
  for (const l of lotes) {
    const atual = ultimo.get(l.entidade);
    if (!atual || new Date(l.recebido_em).getTime() > new Date(atual.recebido_em).getTime()) ultimo.set(l.entidade, l);
  }
  return [...ultimo.values()]
    .filter((l) => l.status === 'falhou')
    .map((l) => ({ lote_id: l.lote_id, entidade: l.entidade, quando: l.recebido_em, linhas: l.com_erro > 0 ? l.com_erro : l.recebidas }))
    .sort((a, b) => b.quando.localeCompare(a.quando) || a.entidade.localeCompare(b.entidade));
}

/**
 * RN-CORE-64: monta o cartão "Precisa de você". Falhas (vermelho) antes de atenção (amarelo); dentro de cada grupo, a ordem fixa abaixo; um
 * alerta por fato. Assunto sem quantidade, sem licença do módulo ou sem permissão não aparece; lista vazia = "Nada pendente.".
 */
export function montarAlertasInicio(e: EntradaAlertasInicio): AlertaInicio[] {
  const falhas: AlertaInicio[] = [];
  const atencao: AlertaInicio[] = [];
  const { agora, fuso, licencas } = e;
  const monitor = { rotulo: 'Integração ERP', caminho: '/integracao' };

  if (licencas.integracao) {
    const m = e.mensagens_paradas;
    if (m && m.quantidade > 0) {
      const desde: ParteTexto[] = m.desde ? [{ texto: ` desde ${dataHoraCurta(m.desde, fuso)}` }] : [];
      falhas.push({ id: 'mensagens_paradas', gravidade: 'falha', partes: [{ texto: 'Integração com o ERP: ' }, { texto: plural(m.quantidade, 'mensagem parada', 'mensagens paradas'), negrito: true }, ...desde], acao: monitor });
    }
    for (const l of e.lotes_falhos ?? []) {
      falhas.push({
        id: `lote_falhou:${l.lote_id}`,
        gravidade: 'falha',
        partes: [{ texto: `Lote de ${rotuloDaEntidade(l.entidade)} falhou em ${dataHoraCurta(l.quando, fuso)} — ` }, { texto: plural(l.linhas, 'linha com erro', 'linhas com erro'), negrito: true }],
        acao: { rotulo: 'Ver lote', caminho: `/integracao?lote=${l.lote_id}` },
      });
    }
    for (const c of e.cargas_atrasadas ?? []) {
      falhas.push({
        id: `carga_atrasada:${c.entidade}`,
        gravidade: 'falha',
        partes: [{ texto: 'Carga de ' }, { texto: rotuloDaEntidade(c.entidade), negrito: true }, { texto: ` não chegou hoje — ${c.ultima_em ? `a última foi em ${dataHoraCurta(c.ultima_em, fuso)}` : 'ainda não houve carga'}` }],
        acao: monitor,
      });
    }
  }
  const ap = e.aprovacoes;
  if (licencas.gestor && licencas.vendedor && ap && ap.quantidade > 0) {
    const idade: ParteTexto[] = ap.mais_antigo_em ? [{ texto: ` — o mais antigo há ${duracaoCurta(agora.getTime() - new Date(ap.mais_antigo_em).getTime())}` }] : [];
    atencao.push({ id: 'aprovacoes', gravidade: 'atencao', partes: [{ texto: plural(ap.quantidade, 'pedido', 'pedidos'), negrito: true }, { texto: ` esperando aprovação` }, ...idade], acao: { rotulo: 'Aprovações', caminho: '/aprovacoes' } });
  }
  if (licencas.gestor && e.alertas_abertos && e.alertas_abertos > 0) {
    atencao.push({ id: 'alertas', gravidade: 'atencao', partes: [{ texto: plural(e.alertas_abertos, 'alerta aberto', 'alertas abertos'), negrito: true }], acao: { rotulo: 'Alertas', caminho: '/alertas' } });
  }
  if (e.usuarios_senha_vencida && e.usuarios_senha_vencida > 0) {
    const n = e.usuarios_senha_vencida;
    atencao.push({ id: 'usuarios_senha', gravidade: 'atencao', partes: [{ texto: plural(n, 'usuário', 'usuários'), negrito: true }, { texto: ` com senha temporária vencida` }], acao: { rotulo: 'Usuários', caminho: '/usuarios' } });
  }
  const ci = e.cadastro_incompleto;
  if (ci && ci.quantidade > 0) {
    atencao.push({
      id: 'cadastro_incompleto',
      gravidade: 'atencao',
      partes: [{ texto: plural(ci.quantidade, 'cliente', 'clientes'), negrito: true }, { texto: ` com cadastro incompleto${ci.campo ? ` — o que mais falta: ${ci.campo}` : ''}` }],
      acao: { rotulo: 'Clientes', caminho: '/clientes' },
    });
  }
  return [...falhas, ...atencao];
}

// ---------- RN-CORE-65 / RN-CORE-64: derivações dos dados lidos de outros módulos ----------

/** RN-CORE-65: a última carga recebida de cada entidade, a partir dos lotes recentes do monitor (qualquer status). */
export function ultimasCargasPorEntidade(lotes: readonly { entidade: string; recebido_em: string }[]): { entidade: string; recebido_em: string }[] {
  const mapa = new Map<string, string>();
  for (const l of lotes) {
    const atual = mapa.get(l.entidade);
    if (atual === undefined || new Date(l.recebido_em).getTime() > new Date(atual).getTime()) mapa.set(l.entidade, l.recebido_em);
  }
  return [...mapa].map(([entidade, recebido_em]) => ({ entidade, recebido_em })).sort((a, b) => a.entidade.localeCompare(b.entidade));
}

/** RN-CORE-64: a aprovação mais antiga da fila (menor `solicitada_em`); fila vazia = null. */
export function aprovacaoMaisAntiga(solicitadas: readonly string[]): string | null {
  let menor: string | null = null;
  for (const s of solicitadas) if (menor === null || new Date(s).getTime() < new Date(menor).getTime()) menor = s;
  return menor;
}

/** RN-CORE-64: quantos pedidos da fila foram solicitados HOJE (dia civil no fuso do tenant): a linha "N em aprovação" do cartão Pedidos. */
export function aprovacoesSolicitadasHoje(itens: readonly { pedido_id: string; solicitada_em: string }[], agora: Date, fuso: string): number {
  const dia = (d: Date) => {
    const p = partes(d, fuso);
    return `${p.year}-${p.month}-${p.day}`;
  };
  const hoje = dia(agora);
  return new Set(itens.filter((i) => dia(new Date(i.solicitada_em)) === hoje).map((i) => i.pedido_id)).size;
}
