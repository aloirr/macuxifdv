/**
 * Modo falso do portal `config.` (T-0087; pedido R-20261106-002311 item 5): responde no navegador as mesmas rotas, com os mesmos
 * schemas (`@macuxi/platform-sdk` e `@macuxi/integracao/contracts`), para navegar o fluxo antes de as rotas reais chegarem.
 * Liga só com `NEXT_PUBLIC_PORTAL_FALSO=1` fora de produção (`MODO_PORTAL_FALSO` em `lib/portal-api.ts`, import dinâmico: o build
 * de produção não chama isto). Dados fictícios guardados no `sessionStorage` (o F5 não perde o que foi criado).
 * Regras: qualquer convite com 32+ caracteres; qualquer senha com 12+; qualquer código de 6 dígitos, menos `000000` (para ver o
 * erro); na carga, linha sem `external_id` ou com `erro` no texto vira erro de linha.
 */
import {
  CriarEmpresaSchema,
  EtapaLoginSchema,
  LoginPlataformaSchema,
  PrimeiroAcessoSchema,
  SegundoFatorSchema,
  SessaoPlataformaSchema,
  TotpConfirmarSchema,
  linhasDosParametrosIniciais,
} from '@macuxi/platform-sdk';
import {
  CargaArquivoEntrada,
  ConectorCriar,
  ConferirArquivoEntrada,
  type ConectorResumo,
  type Entidade,
  type LinhaErro,
  type LoteResultado,
} from '@macuxi/integracao/contracts';

import { ROTAS_PORTAL } from './portal-rotas';

const CHAVE = 'macuxi.portal.falso';
const ORDEM: Entidade[] = ['vendedor', 'catalogo_no', 'produto', 'produto_unidade', 'preco', 'estoque', 'cliente', 'cliente_endereco', 'transportadora', 'rota', 'titulo', 'nota'];

interface EmpresaFalsa {
  id: string;
  codigo: string;
  razao_social: string;
  cnpj: string;
  fuso: string;
  status: string;
  criada_em: string;
  modulos: { modulo: string; licencas: number | null }[];
}
interface LoteFalso {
  tenant: string;
  resultado: LoteResultado;
  sessao: string | null;
  parte: number;
  total: number;
  pronto_em: number;
}
interface Estado {
  admin: { email: string; nome: string } | null;
  totp: boolean;
  empresas: EmpresaFalsa[];
  conectores: Record<string, ConectorResumo[]>;
  lotes: Record<string, LoteFalso>;
}

const vazio = (): Estado => ({ admin: null, totp: false, empresas: [], conectores: {}, lotes: {} });

function ler(): Estado {
  try {
    const b = window.sessionStorage.getItem(CHAVE);
    return b ? { ...vazio(), ...(JSON.parse(b) as Partial<Estado>) } : vazio();
  } catch {
    return vazio();
  }
}
function gravar(e: Estado) {
  try {
    window.sessionStorage.setItem(CHAVE, JSON.stringify(e));
  } catch {
    // sem storage
  }
}

const json = (status: number, corpo: unknown, cabecalhos: Record<string, string> = {}) =>
  new Response(status === 204 ? null : JSON.stringify(corpo), { status, headers: { 'content-type': 'application/json', ...cabecalhos } });
const erro = (status: number, codigo: string, mensagem: string, detalhes?: Record<string, unknown>) => json(status, { codigo, mensagem, ...(detalhes ? { detalhes } : {}) });
const agoraIso = (deslocMin = 0) => new Date(Date.now() + deslocMin * 60_000).toISOString();
const desafio = () => `desafio-falso-${crypto.randomUUID()}-${crypto.randomUUID()}`;
const sessaoNova = (tetoIso?: string) =>
  SessaoPlataformaSchema.parse({ token: `token-falso-${crypto.randomUUID()}`, expira_em: agoraIso(15), sessao_expira_em: tetoIso ?? agoraIso(480), recuperacao_restantes: 10 });
const ALFABETO = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const codigoRecuperacao = () => {
  const c = Array.from(crypto.getRandomValues(new Uint8Array(10)), (b) => ALFABETO[b % 32]).join('');
  return `${c.slice(0, 5)}-${c.slice(5)}`;
};

function lerCorpo<T>(schema: { safeParse(x: unknown): { success: true; data: T } | { success: false; error: { issues: { message: string }[] } } }, corpo: unknown): T | Response {
  const p = schema.safeParse(corpo);
  if (p.success) return p.data;
  return erro(400, 'VALIDACAO', p.error.issues[0]?.message ?? 'Dados inválidos.');
}

/** BOM do UTF-8 (o Excel abre o CSV sem perguntar a codificação). */
const BOM = String.fromCharCode(0xfeff);
const BOM_INICIO = new RegExp(`^${BOM}`);

function linhasDoCsv(texto: string): string[][] {
  const linhas = texto.replace(BOM_INICIO, '').split(/\r?\n/).filter((l) => l.trim() !== '');
  const sep = (linhas[0] ?? '').includes(';') ? ';' : ',';
  return linhas.map((l) => l.split(sep));
}

/** Erros de linha do modo falso: sem `external_id` na 1ª coluna, ou com a palavra "erro". */
function errosFalsos(texto: string, linhaInicial = 2): { total: number; erros: LinhaErro[] } {
  const [, ...dados] = linhasDoCsv(texto);
  const erros: LinhaErro[] = [];
  dados.forEach((cols, i) => {
    const id = (cols[0] ?? '').trim();
    const n = linhaInicial + i;
    if (!id) erros.push({ indice: i, external_id: null, codigo: 'campo_obrigatorio', campo: 'external_id', mensagem: `Linha ${n} do arquivo: external_id é obrigatório.`, reprocessavel: false, origem: 'hub' });
    else if (cols.join(' ').toLowerCase().includes('erro')) erros.push({ indice: i, external_id: id, codigo: 'formato_invalido', campo: cols.length > 1 ? 'nome' : null, mensagem: `Linha ${n} do arquivo: valor em formato inválido (exemplo do modo falso).`, reprocessavel: false, origem: 'hub' });
  });
  return { total: dados.length, erros };
}

function conectorResumo(c: { conector_id: string; nome: string; tipo: ConectorResumo['tipo']; recebe_pedidos: boolean; entidades: Entidade[] }): ConectorResumo {
  return {
    id: crypto.randomUUID(),
    conector_id: c.conector_id,
    nome: c.nome,
    tipo: c.tipo,
    ativo: true,
    recebe_pedidos: c.recebe_pedidos,
    entidades: c.entidades,
    ips_permitidos: [],
    versao_conector: null,
    situacao_versao: 'sem_politica',
    ultimo_sinal_em: null,
    saude: 'nunca_conectou',
    chave: { prefixo: 'mx_falso', criada_em: agoraIso(), anterior_prefixo: null, anterior_valida_ate: null, expira_em: null },
    criado_em: agoraIso(),
  };
}

function statusDoLote(l: LoteFalso): LoteResultado {
  if (Date.now() < l.pronto_em) return { ...l.resultado, status: Date.now() < l.pronto_em - 1000 ? 'recebido' : 'processando', concluido_em: null };
  return l.resultado;
}

export async function responderFalso(metodo: string, caminhoComQuery: string, corpo: unknown, cabecalhos: Record<string, string>): Promise<Response> {
  await new Promise((r) => setTimeout(r, 250));
  const [caminho = ''] = caminhoComQuery.split('?');
  const e = ler();
  const tenant = cabecalhos['x-macuxi-tenant'];
  const autenticado = (cabecalhos.Authorization ?? '').startsWith('Bearer token-falso-');
  const rota = `${metodo} ${caminho}`;

  // ---------- autenticação
  if (rota === `POST ${ROTAS_PORTAL.primeiroAcesso}`) {
    const c = lerCorpo(PrimeiroAcessoSchema, corpo);
    if (c instanceof Response) return c;
    if (e.admin) return erro(410, 'PRIMEIRO_ACESSO_ENCERRADO', 'O primeiro acesso já foi feito. Entre com o seu e-mail e a sua senha.');
    gravar({ ...e, admin: { email: c.email, nome: c.nome } });
    return json(200, EtapaLoginSchema.parse({ etapa: 'cadastrar_totp', desafio: desafio(), expira_em: agoraIso(5) }));
  }
  if (rota === `POST ${ROTAS_PORTAL.login}`) {
    const c = lerCorpo(LoginPlataformaSchema, corpo);
    if (c instanceof Response) return c;
    if (!e.admin || e.admin.email !== c.email || c.senha.length < 12) return erro(401, 'CREDENCIAIS_INVALIDAS', 'E-mail ou senha incorretos.');
    return json(200, { etapa: e.totp ? 'segundo_fator' : 'cadastrar_totp', desafio: desafio(), expira_em: agoraIso(5) });
  }
  if (rota === `POST ${ROTAS_PORTAL.totpIniciar}`) {
    const rotulo = encodeURIComponent(`Macuxi FDV:${e.admin?.email ?? 'super-admin'}`);
    const segredo = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';
    return json(200, { otpauth_uri: `otpauth://totp/${rotulo}?secret=${segredo}&issuer=Macuxi%20FDV&digits=6&period=30`, segredo_base32: segredo });
  }
  if (rota === `POST ${ROTAS_PORTAL.totpConfirmar}`) {
    const c = lerCorpo(TotpConfirmarSchema, corpo);
    if (c instanceof Response) return c;
    if (c.codigo === '000000') return erro(401, 'CODIGO_INVALIDO', 'Código incorreto ou vencido. Confira a hora do celular e digite o código que aparece agora.');
    gravar({ ...e, totp: true });
    return json(200, { codigos_recuperacao: Array.from({ length: 10 }, codigoRecuperacao), sessao: sessaoNova() });
  }
  if (rota === `POST ${ROTAS_PORTAL.segundoFator}`) {
    const c = lerCorpo(SegundoFatorSchema, corpo);
    if (c instanceof Response) return c;
    if ('codigo' in c && c.codigo === '000000') return erro(401, 'CODIGO_INVALIDO', 'Código incorreto ou vencido. Confira a hora do celular e digite o código que aparece agora.');
    return json(200, { ...sessaoNova(), recuperacao_restantes: 'codigo_recuperacao' in c ? 9 : 10 });
  }
  if (!autenticado) return erro(401, 'NAO_AUTENTICADO', 'Sua sessão terminou. Entre de novo.');
  if (rota === `POST ${ROTAS_PORTAL.renovar}`) return json(200, sessaoNova());
  if (rota === `POST ${ROTAS_PORTAL.sair}`) return json(204, null);

  // ---------- empresas
  if (rota === `GET ${ROTAS_PORTAL.empresas}`) return json(200, { itens: e.empresas });
  if (rota === `POST ${ROTAS_PORTAL.empresas}`) {
    const c = lerCorpo(CriarEmpresaSchema, corpo);
    if (c instanceof Response) return c;
    const modulos = [...new Map([{ modulo: 'core', licencas: null }, { modulo: 'integracao', licencas: null }, ...c.modulos].map((m) => [m.modulo, m])).values()];
    const existente = e.empresas.find((x) => x.codigo === c.codigo);
    const adicionados = modulos.filter((m) => !existente?.modulos.some((x) => x.modulo === m.modulo)).map((m) => m.modulo);
    const resposta = {
      tenant_id: c.simular ? (existente?.id ?? null) : (existente?.id ?? crypto.randomUUID()),
      codigo: c.codigo,
      resultado: existente ? (adicionados.length ? 'atualizado' : 'sem_mudanca') : 'criado',
      modulos_adicionados: adicionados,
      parametros_gravados: existente ? [] : linhasDosParametrosIniciais(c.parametros).map((l) => l.chave),
      avisos: existente ? ['A empresa já existe: razão social e fuso não mudam.'] : [],
      simulado: c.simular,
    };
    if (!c.simular) {
      const lista = existente
        ? e.empresas.map((x) => (x.id === existente.id ? { ...x, modulos: [...x.modulos, ...modulos.filter((m) => adicionados.includes(m.modulo))] } : x))
        : [...e.empresas, { id: resposta.tenant_id as string, codigo: c.codigo, razao_social: c.razao_social, cnpj: c.cnpj, fuso: c.fuso, status: 'ativo', criada_em: agoraIso(), modulos }];
      gravar({ ...e, empresas: lista });
    }
    return json(c.simular ? 200 : 201, resposta);
  }

  // ---------- rotas de módulo (com tenant)
  if (!tenant || !e.empresas.some((x) => x.id === tenant)) return erro(404, 'TENANT_NAO_ENCONTRADO', 'Empresa não encontrada ou inativa.');
  if (rota === `GET ${ROTAS_PORTAL.ordemCarga}`) {
    return json(200, { itens: ORDEM.map((entidade, i) => ({ entidade, posicao: i + 1, opcional: entidade === 'titulo' || entidade === 'nota', depende_de: [] })) });
  }
  if (rota === `POST ${ROTAS_PORTAL.conferirArquivo}`) {
    const c = lerCorpo(ConferirArquivoEntrada, corpo);
    if (c instanceof Response) return c;
    const r = errosFalsos(c.conteudo, c.linha_inicial ?? 2);
    const comErro = new Set(r.erros.map((x) => x.indice)).size;
    return json(200, { entidade: c.entidade, modo: c.modo ?? 'delta', linhas_lidas: r.total, linhas_validas: r.total - comErro, linhas_com_erro: comErro, erros: r.erros.slice(0, 200), erros_omitidos: Math.max(0, r.erros.length - 200), pode_gravar: comErro === 0, gravou: false });
  }
  if (rota === `POST ${ROTAS_PORTAL.cargaArquivo}`) {
    const c = lerCorpo(CargaArquivoEntrada, corpo);
    if (c instanceof Response) return c;
    const conectores = e.conectores[tenant] ?? [];
    const dono = conectores.find((x) => x.tipo === 'arquivo' && x.entidades.includes(c.entidade as Entidade));
    if (!dono) return erro(404, 'CONECTOR_NAO_ENCONTRADO', 'Esta empresa ainda não tem um Conector de arquivo para esta base.');
    const r = errosFalsos(c.conteudo, c.linha_inicial ?? 2);
    const id = crypto.randomUUID();
    const comErro = new Set(r.erros.map((x) => x.indice)).size;
    const resultado: LoteResultado = {
      lote_id: id,
      entidade: c.entidade as Entidade,
      modo: (c.modo ?? 'delta') as LoteResultado['modo'],
      status: comErro ? 'concluido_com_erros' : 'concluido',
      contagens: { recebidas: r.total, duplicadas_no_lote: 0, com_erro: comErro, novas: r.total - comErro, atualizadas: 0, inalteradas: 0, obsoletas: 0 },
      erros: r.erros,
      avisos: [],
      cursor: null,
      inativadas: 0,
      erros_total: r.erros.length,
      recebido_em: agoraIso(),
      concluido_em: agoraIso(),
    };
    gravar({ ...e, lotes: { ...e.lotes, [id]: { tenant, resultado, sessao: c.sessao_id ?? null, parte: c.parte ?? 1, total: c.total_partes ?? 1, pronto_em: Date.now() + 2500 } } });
    return json(202, {
      lote_id: id,
      status: 'recebido',
      entidade: c.entidade,
      modo: c.modo ?? 'delta',
      recebidos: Math.max(1, r.total),
      consulta: `/v1/integracao/lotes/${id}`,
      conector_id: dono.conector_id,
      linhas_lidas: Math.max(1, r.total),
      linhas_invalidas_leitura: 0,
      ...(c.sessao_id ? { sessao: { id: c.sessao_id, parte: c.parte, total_partes: c.total_partes, consulta: `/v1/integracao/cargas-arquivo/sessoes/${c.sessao_id}` } } : {}),
    });
  }
  const sessaoM = /^\/integracao\/cargas-arquivo\/sessoes\/([^/]+)$/.exec(caminho);
  if (metodo === 'GET' && sessaoM) {
    const partes = Object.values(e.lotes).filter((l) => l.sessao === sessaoM[1]);
    const p0 = partes[0];
    if (!p0) return erro(404, 'SESSAO_NAO_ENCONTRADA', 'Sessão de carga não encontrada.');
    const prontas = partes.filter((l) => Date.now() >= l.pronto_em);
    const soma = (k: 'recebidas' | 'com_erro' | 'novas' | 'atualizadas' | 'inalteradas' | 'obsoletas') => partes.reduce((a, l) => a + l.resultado.contagens[k], 0);
    const faltando = Array.from({ length: p0.total }, (_, i) => i + 1).filter((n) => !partes.some((l) => l.parte === n));
    return json(200, {
      sessao_id: sessaoM[1],
      entidade: p0.resultado.entidade,
      modo: p0.resultado.modo,
      total_partes: p0.total,
      situacao: faltando.length === 0 && prontas.length === partes.length ? 'completa' : 'aberta',
      partes_recebidas: partes.length,
      partes_aplicadas: prontas.length,
      partes_com_falha: 0,
      partes_faltando: faltando,
      partes: partes.map((l) => ({ parte: l.parte, lote_id: l.resultado.lote_id, status: statusDoLote(l).status, ...l.resultado.contagens })).map(({ duplicadas_no_lote: _d, ...x }) => x),
      contagens: { recebidas: soma('recebidas'), com_erro: soma('com_erro'), novas: soma('novas'), atualizadas: soma('atualizadas'), inalteradas: soma('inalteradas'), obsoletas: soma('obsoletas') },
      erros_total: partes.reduce((a, l) => a + l.resultado.erros.length, 0),
      iniciada_em: p0.resultado.recebido_em,
      expira_em: agoraIso(24 * 60),
    });
  }
  const loteM = /^\/integracao\/lotes\/([^/]+?)(\/erros(\.csv)?)?$/.exec(caminho);
  if (metodo === 'GET' && loteM) {
    const l = e.lotes[loteM[1] ?? ''];
    if (!l || l.tenant !== tenant) return erro(404, 'LOTE_NAO_ENCONTRADO', 'Lote não encontrado.');
    if (loteM[3]) {
      const csv = ['linha_do_lote;external_id;codigo;campo;reprocessavel;mensagem', ...l.resultado.erros.map((x) => [x.indice + 1, x.external_id ?? '', x.codigo, x.campo ?? '', x.reprocessavel ? 'sim' : 'nao', x.mensagem].join(';'))].join('\r\n');
      return new Response(`${BOM}${csv}\r\n`, { status: 200, headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="erros-${l.resultado.lote_id}.csv"` } });
    }
    if (loteM[2]) return json(200, { itens: l.resultado.erros, total: l.resultado.erros.length });
    return json(200, statusDoLote(l));
  }
  if (rota === `GET ${ROTAS_PORTAL.conectores}`) return json(200, { itens: e.conectores[tenant] ?? [] });
  if (rota === `POST ${ROTAS_PORTAL.conectores}`) {
    const c = lerCorpo(ConectorCriar, corpo);
    if (c instanceof Response) return c;
    const lista = e.conectores[tenant] ?? [];
    if (lista.some((x) => x.conector_id === c.conector_id)) return erro(409, 'conector_ja_existe', `Já existe um Conector com o identificador "${c.conector_id}" nesta empresa.`);
    const ocupadas = new Set(lista.filter((x) => x.ativo).flatMap((x) => x.entidades));
    const conflito = c.entidades.filter((x) => ocupadas.has(x));
    if (conflito.length) {
      return erro(409, 'topologia_conflitante', `As bases ${conflito.join(', ')} já são recebidas por outro Conector. Na v1 cada base vem de um único Conector por empresa.`, { entidades_livres: c.entidades.filter((x) => !ocupadas.has(x)) });
    }
    const novo = conectorResumo({ conector_id: c.conector_id, nome: c.nome, tipo: c.tipo, recebe_pedidos: c.recebe_pedidos, entidades: c.entidades });
    gravar({ ...e, conectores: { ...e.conectores, [tenant]: [...lista, novo] } });
    return json(201, { conector: novo, chave: { conector_id: c.conector_id, escopo: 'integracao.v1', chave: `mx_falso_${crypto.randomUUID().replace(/-/g, '')}`, prefixo: 'mx_falso', criada_em: agoraIso(), anterior_valida_ate: null } });
  }
  const conectorM = /^\/integracao\/conectores\/([^/]+)$/.exec(caminho);
  if (metodo === 'PATCH' && conectorM) {
    const lista = e.conectores[tenant] ?? [];
    if (!lista.some((x) => x.id === conectorM[1])) return erro(404, 'CONECTOR_NAO_ENCONTRADO', 'Conector não encontrado.');
    const ativo = (corpo as { ativo?: boolean } | null)?.ativo;
    const nova = lista.map((x) => (x.id === conectorM[1] && typeof ativo === 'boolean' ? { ...x, ativo, saude: ativo ? x.saude : ('desativado' as const) } : x));
    gravar({ ...e, conectores: { ...e.conectores, [tenant]: nova } });
    return json(200, nova.find((x) => x.id === conectorM[1]));
  }
  // N1/N2 (nuvem) ainda não existem: igual à API real antes do merge
  return erro(404, 'NAO_ENCONTRADO', 'Rota não encontrada.');
}

/** Para os testes e para "recomeçar" o modo falso. */
export function zerarModoFalso() {
  gravar(vazio());
}
