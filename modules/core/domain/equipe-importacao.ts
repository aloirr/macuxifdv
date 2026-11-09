/**
 * Equipe por CSV (T-0087, fatia E; T-0094 sem convite: cada pessoa nova recebe senha temporária por e-mail, RN-CORE-34; RN-CORE-31; desenho docs/modulos/core/equipe-csv.md).
 * Funções puras: leitura do CSV, conferência (erros por linha, sem gravar), plano de gravação ordenado
 * (gerentes → supervisores → campo). A API só executa o plano e revalida tudo.
 * - o CSV NUNCA traz senha (coluna `senha` recusa o arquivo); a senha inicial é gerada pelo servidor e vai por e-mail;
 * - idempotente pelo e-mail: existente é atualizado (nome, superior, codigo_erp, módulos), nunca troca perfil;
 * - módulos: a exceção por usuário só REMOVE (RN-CORE-01/02); passar da quantidade licenciada recusa a linha (RN-CORE-02);
 * - regra 7 (RN-CORE-29): promotor nunca recebe o módulo `vendedor` (pedido);
 * - mensagens de erro não repetem o dado da célula (LGPD).
 */
import { protegerFormula } from '@macuxi/comum/csv';
import { ehEmail } from '@macuxi/comum/email';
import { PERFIS, type Perfil } from '@macuxi/platform-sdk';
import { EXTERNAL_ID_MAX, NOME_USUARIO_MAX, normalizarEmail } from './usuarios';

export const MAX_LINHAS_EQUIPE_CSV = 5000;
export const COLUNAS_EQUIPE_CSV = ['nome', 'email', 'telefone', 'perfil', 'email_superior', 'codigo_erp', 'modulos'] as const;
const OBRIGATORIAS = ['nome', 'email', 'perfil'] as const;

export interface LinhaCsvEquipe {
  /** Número da linha no arquivo (cabeçalho = 1). */
  numero: number;
  nome: string;
  email: string;
  telefone: string;
  perfil: string;
  email_superior: string;
  codigo_erp: string;
  modulos: string;
}

export type LeituraCsvEquipe = { ok: true; linhas: LinhaCsvEquipe[] } | { ok: false; mensagem: string };

/** Separa o texto em registros e células (RFC 4180 simples: aspas duplas, `""`, quebra dentro de aspas). */
function dividirRegistros(texto: string, sep: string): string[][] {
  const registros: string[][] = [];
  let reg: string[] = [];
  let cel = '';
  let aspas = false;
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i]!;
    if (aspas) {
      if (c === '"') {
        if (texto[i + 1] === '"') {
          cel += '"';
          i++;
        } else aspas = false;
      } else cel += c;
    } else if (c === '"' && cel === '') aspas = true;
    else if (c === sep) {
      reg.push(cel);
      cel = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && texto[i + 1] === '\n') i++;
      reg.push(cel);
      registros.push(reg);
      reg = [];
      cel = '';
    } else cel += c;
  }
  if (cel !== '' || reg.length > 0) {
    reg.push(cel);
    registros.push(reg);
  }
  return registros;
}

const normalizarColuna = (c: string): string =>
  c
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[\s-]+/g, '_');
const ALIAS: Record<string, string> = { e_mail: 'email', 'e_mail_superior': 'email_superior', superior: 'email_superior', codigo: 'codigo_erp', perfil_de_acesso: 'perfil', modulo: 'modulos' };

export function lerCsvDeEquipe(texto: string): LeituraCsvEquipe {
  const limpo = texto.replace(/^\uFEFF/, '');
  const primeira = limpo.split(/\r?\n/, 1)[0] ?? '';
  const sep = (primeira.match(/;/g)?.length ?? 0) > (primeira.match(/,/g)?.length ?? 0) ? ';' : ',';
  const registros = dividirRegistros(limpo, sep);
  const cab = registros[0]?.map((c) => {
    const n = normalizarColuna(c);
    return ALIAS[n] ?? n;
  });
  if (!cab || cab.every((c) => c === '')) return { ok: false, mensagem: 'O arquivo está vazio. Baixe o modelo, preencha e envie de novo.' };
  if (cab.some((c) => c === 'senha' || c === 'password')) {
    return { ok: false, mensagem: 'O arquivo não pode ter coluna de senha. Remova a coluna: a senha inicial de cada pessoa é gerada pelo sistema e enviada por e-mail.' };
  }
  const faltam = OBRIGATORIAS.filter((c) => !cab.includes(c));
  if (faltam.length > 0) return { ok: false, mensagem: `Faltam colunas obrigatórias: ${faltam.join(', ')}. Baixe o modelo para ver o cabeçalho certo.` };
  const dados = registros.slice(1).map((r, i) => ({ r, numero: i + 2 })).filter(({ r }) => r.some((c) => c.trim() !== ''));
  if (dados.length === 0) return { ok: false, mensagem: 'O arquivo não tem nenhuma linha de dados. Preencha a partir da segunda linha.' };
  if (dados.length > MAX_LINHAS_EQUIPE_CSV) {
    return { ok: false, mensagem: `O arquivo tem mais de ${MAX_LINHAS_EQUIPE_CSV} linhas. Divida em arquivos menores e envie um de cada vez.` };
  }
  const col = (r: string[], nome: string): string => {
    const i = cab.indexOf(nome);
    return i < 0 ? '' : (r[i] ?? '').trim();
  };
  return {
    ok: true,
    linhas: dados.map(({ r, numero }) => ({
      numero,
      nome: col(r, 'nome'),
      email: col(r, 'email'),
      telefone: col(r, 'telefone'),
      perfil: col(r, 'perfil').toLowerCase(),
      email_superior: col(r, 'email_superior'),
      codigo_erp: col(r, 'codigo_erp'),
      modulos: col(r, 'modulos'),
    })),
  };
}

export function modeloCsvDeEquipe(): string {
  return [
    COLUNAS_EQUIPE_CSV.join(','),
    'Ana Souza,ana.souza@empresa.com.br,95991112222,supervisor,carlos.lima@empresa.com.br,,',
    'Bruno Dias,bruno.dias@empresa.com.br,,vendedor,ana.souza@empresa.com.br,V0042,"vendedor"',
  ].join('\n') + '\n';
}

// ---------- conferência ----------

export interface UsuarioExistente {
  id: string;
  email: string;
  perfil: Perfil;
  nome: string;
  external_id: string | null;
  ativo: boolean;
  /** Telefone gravado (vazio na célula não apaga). */
  telefone?: string | null;
  /** Módulos efetivos hoje (perfil menos as remoções do usuário). */
  modulos: readonly string[];
  superior_email: string | null;
}

export interface ContextoImportacao {
  existentes: readonly UsuarioExistente[];
  /** Módulos ativos no tenant (RN-CORE-01). */
  modulosDoTenant: readonly string[];
  /** Módulos liberados a cada perfil (`perfil_modulo`). */
  modulosDoPerfil: Readonly<Partial<Record<Perfil, readonly string[]>>>;
  /** Quantidade licenciada por módulo (`tenant_modulo.licencas`); módulo ausente = sem limite. */
  limites: Readonly<Record<string, number>>;
  /** Usuários ativos que já usam cada módulo. */
  emUso: Readonly<Record<string, number>>;
}

export interface ErroLinhaEquipe {
  linha: number;
  coluna: string;
  mensagem: string;
}

export interface PlanoUsuarioEquipe {
  linha: number;
  acao: 'criar' | 'atualizar' | 'sem_mudanca';
  usuario_id: string | null;
  email: string;
  nome: string;
  telefone: string | null;
  perfil: Perfil;
  superior_email: string | null;
  external_id: string | null;
  modulos_removidos: string[];
}

export interface ResultadoConferencia {
  plano: PlanoUsuarioEquipe[];
  erros: ErroLinhaEquipe[];
  avisos: ErroLinhaEquipe[];
  resumo: { total: number; novos: number; atualizados: number; sem_mudanca: number; com_erro: number };
}

const NIVEL: Record<Perfil, number> = { admin: 0, analista: 0, assistente: 0, gerente: 0, supervisor: 1, vendedor: 2, promotor: 2 };
const SUPERIORES: Record<Perfil, readonly Perfil[]> = {
  admin: [],
  analista: [],
  assistente: [],
  gerente: [],
  supervisor: ['gerente'],
  vendedor: ['supervisor', 'gerente'],
  promotor: ['supervisor', 'gerente'],
};
const ehPerfil = (p: string): p is Perfil => (PERFIS as readonly string[]).includes(p);

export function conferirImportacaoDeEquipe(linhas: readonly LinhaCsvEquipe[], ctx: ContextoImportacao): ResultadoConferencia {
  const erros: ErroLinhaEquipe[] = [];
  const avisos: ErroLinhaEquipe[] = [];
  const erro = (linha: number, coluna: string, mensagem: string) => erros.push({ linha, coluna, mensagem });
  const existentes = new Map(ctx.existentes.map((u) => [u.email.toLowerCase(), u]));
  const tenant = new Set(ctx.modulosDoTenant);

  // mapa e-mail -> perfil efetivo (arquivo ou tenant), para validar o superior
  const emailsNoArquivo = new Map<string, number>();
  const perfilDe = new Map<string, Perfil>(ctx.existentes.map((u) => [u.email.toLowerCase(), u.perfil]));
  for (const l of linhas) {
    const e = normalizarEmail(l.email);
    if (!emailsNoArquivo.has(e)) {
      emailsNoArquivo.set(e, l.numero);
      if (!existentes.has(e) && ehPerfil(l.perfil)) perfilDe.set(e, l.perfil);
    }
  }

  const codigosNoArquivo = new Map<string, number>();
  const codigosDoTenant = new Map(ctx.existentes.filter((u) => u.external_id).map((u) => [u.external_id as string, u.email.toLowerCase()]));
  const candidatos: { l: LinhaCsvEquipe; e: string; perfil: Perfil; existente: UsuarioExistente | undefined; wanted: string[]; removidos: string[]; superior: string | null; codigo: string | null }[] = [];

  for (const l of linhas) {
    const antes = erros.length;
    const email = normalizarEmail(l.email);
    const existente = existentes.get(email);
    // nome
    if (l.nome.length === 0) erro(l.numero, 'nome', 'Informe o nome da pessoa.');
    else if (l.nome.length > NOME_USUARIO_MAX) erro(l.numero, 'nome', `O nome pode ter até ${NOME_USUARIO_MAX} caracteres.`);
    // e-mail
    if (!ehEmail(email)) erro(l.numero, 'email', 'Informe um e-mail válido, como nome@empresa.com.br.');
    else if (emailsNoArquivo.get(email) !== l.numero) erro(l.numero, 'email', 'Este e-mail já aparece em outra linha do arquivo. Deixe uma linha só por pessoa.');
    // telefone
    if (l.telefone && !/^\+?[0-9()\s.-]{8,20}$/.test(l.telefone)) erro(l.numero, 'telefone', 'Telefone inválido. Use só números com DDD, como 95991112222, ou deixe vazio.');
    // perfil
    let perfil: Perfil | null = null;
    if (!ehPerfil(l.perfil)) erro(l.numero, 'perfil', `Perfil desconhecido. Use um de: ${PERFIS.join(', ')}.`);
    else if (existente && existente.perfil !== l.perfil) {
      perfil = existente.perfil;
      avisos.push({ linha: l.numero, coluna: 'perfil', mensagem: 'Esta pessoa já existe com outro perfil; o perfil não é trocado pelo arquivo. Mude pelo cadastro de usuários se precisar.' });
    } else perfil = l.perfil;
    // codigo_erp
    let codigo: string | null = null;
    if (l.codigo_erp) {
      if (l.codigo_erp.length > EXTERNAL_ID_MAX) erro(l.numero, 'codigo_erp', `O código do ERP pode ter até ${EXTERNAL_ID_MAX} caracteres.`);
      else if (codigosNoArquivo.has(l.codigo_erp)) erro(l.numero, 'codigo_erp', 'Este código do ERP já aparece em outra linha do arquivo. Cada pessoa tem um código só.');
      else {
        codigosNoArquivo.set(l.codigo_erp, l.numero);
        const dono = codigosDoTenant.get(l.codigo_erp);
        if (dono && dono !== email) erro(l.numero, 'codigo_erp', 'Este código do ERP já pertence a outra pessoa desta empresa. Confira o código.');
        else codigo = l.codigo_erp;
      }
    }
    // superior
    let superior: string | null = null;
    if (l.email_superior && perfil) {
      const s = normalizarEmail(l.email_superior);
      const pSup = perfilDe.get(s);
      if (s === email) erro(l.numero, 'email_superior', 'A pessoa não pode ser superior de si mesma.');
      else if (!pSup) erro(l.numero, 'email_superior', 'Superior não encontrado: ele precisa estar no arquivo ou já cadastrado na empresa.');
      else if (!SUPERIORES[perfil].includes(pSup)) {
        erro(l.numero, 'email_superior', SUPERIORES[perfil].length === 0 ? 'Este perfil não tem superior. Deixe a coluna vazia.' : `O superior de ${perfil} precisa ser ${SUPERIORES[perfil].join(' ou ')}.`);
      } else superior = s;
    }
    // módulos
    let wanted: string[] = [];
    let removidos: string[] = [];
    if (perfil) {
      const grants = new Set((ctx.modulosDoPerfil[perfil] ?? []).filter((m) => tenant.has(m)));
      grants.add('core');
      const listados = [...new Set(l.modulos.split(/[;,|]/).map((m) => m.trim().toLowerCase()).filter(Boolean))];
      if (listados.length > 0) {
        for (const m of listados) {
          if (!tenant.has(m)) erro(l.numero, 'modulos', `O módulo ${m} não está licenciado para esta empresa. Tire-o da lista.`);
          else if (!grants.has(m)) erro(l.numero, 'modulos', `O módulo ${m} não está liberado para o perfil ${perfil}; a exceção por pessoa só pode remover módulos.`);
        }
        wanted = [...new Set([...listados, 'core'])].filter((m) => grants.has(m));
      } else if (existente) wanted = existente.modulos.filter((m) => grants.has(m));
      else wanted = [...grants];
      if (perfil === 'promotor' && wanted.includes('vendedor')) {
        erro(l.numero, 'modulos', 'Promotor não recebe o módulo vendedor: ele nunca cria pedido. Tire o módulo vendedor da lista.');
      }
      removidos = [...grants].filter((m) => !wanted.includes(m)).sort();
    }
    if (erros.length === antes && perfil) candidatos.push({ l, e: email, perfil, existente, wanted, removidos, superior, codigo });
  }

  // ordem de gravação: gerentes → supervisores → campo (estável pela ordem do arquivo)
  candidatos.sort((a, b) => NIVEL[a.perfil] - NIVEL[b.perfil] || a.l.numero - b.l.numero);

  // quantidade licenciada por módulo
  const aceitos = new Map<string, number>();
  const limpos = candidatos.filter((c) => {
    const novos = c.wanted.filter((m) => !c.existente?.modulos.includes(m) && ctx.limites[m] !== undefined);
    const estoura = novos.filter((m) => (ctx.emUso[m] ?? 0) + (aceitos.get(m) ?? 0) >= (ctx.limites[m] as number));
    if (estoura.length > 0) {
      for (const m of estoura) erro(c.l.numero, 'modulos', `A quantidade de licenças do módulo ${m} acabou. Peça mais licenças à Macuxi ou tire o módulo desta pessoa.`);
      return false;
    }
    for (const m of novos) aceitos.set(m, (aceitos.get(m) ?? 0) + 1);
    return true;
  });

  const plano: PlanoUsuarioEquipe[] = limpos.map((c) => {
    const ex = c.existente;
    const base = {
      linha: c.l.numero,
      usuario_id: ex?.id ?? null,
      email: c.e,
      nome: c.l.nome,
      telefone: c.l.telefone || null,
      perfil: c.perfil,
      superior_email: c.superior ?? ex?.superior_email ?? null,
      external_id: c.codigo ?? ex?.external_id ?? null,
      modulos_removidos: c.removidos,
    };
    if (!ex) return { ...base, acao: 'criar' as const };
    const igual =
      ex.nome === base.nome &&
      (ex.superior_email ?? null) === base.superior_email &&
      (ex.external_id ?? null) === base.external_id &&
      (base.telefone === null || base.telefone === (ex.telefone ?? null)) &&
      c.wanted.length === ex.modulos.length &&
      c.wanted.every((m) => ex.modulos.includes(m));
    return { ...base, acao: igual ? ('sem_mudanca' as const) : ('atualizar' as const) };
  });

  const comErro = new Set(erros.map((e) => e.linha)).size;
  return {
    plano,
    erros: erros.sort((a, b) => a.linha - b.linha),
    avisos,
    resumo: {
      total: linhas.length,
      novos: plano.filter((p) => p.acao === 'criar').length,
      atualizados: plano.filter((p) => p.acao === 'atualizar').length,
      sem_mudanca: plano.filter((p) => p.acao === 'sem_mudanca').length,
      com_erro: comErro,
    },
  };
}

/** Célula de CSV: aspas quando preciso e neutralização de fórmula de planilha (`= + - @`). */
function celula(v: string): string {
  const seguro = protegerFormula(v);
  return /[",\r\n]/.test(seguro) ? `"${seguro.replace(/"/g, '""')}"` : seguro;
}

export function errosParaCsv(erros: readonly ErroLinhaEquipe[]): string {
  return ['linha,coluna,mensagem', ...erros.map((e) => [String(e.linha), celula(e.coluna), celula(e.mensagem)].join(','))].join('\r\n') + '\r\n';
}
