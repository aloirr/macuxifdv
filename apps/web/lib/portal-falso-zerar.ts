/**
 * "Zerar dados" no modo falso do portal (ADR 0068; desenho docs/desenho/empresa-zerar.md §3, §3.1 e §4.3): `POST …/zerar/previa`,
 * `GET …/zerar/previa/:previa_id`, `POST …/zerar` e `GET …/zerar` como a API, contra os schemas do SDK, para o e2e e os prints. A
 * empresa inteira (menu ⋯) ou só algumas entidades (aba Integração), com a cascata de exemplo (`cliente` leva `cliente_endereco`).
 * A prévia fica pronta `PREVIA_FALSA_MS` depois de pedida; o bloqueio é fixo (`bloqueioFalso`: a regra de verdade é a
 * `plataforma.zerar_bloqueado` do banco) e as frases vêm da `mensagemDoZerar`. O pedido termina 6 s depois; senha `errada` = 403.
 * Estado só na memória da aba; o monitor falso (`portal-falso-monitor.ts`) lê daqui o que já foi zerado.
 */
import {
  CODIGOS_ZERAR_EMPRESA as Z,
  ENTIDADES_ZERAR,
  PedirPreviaZerarSchema,
  PedirZerarEmpresaSchema,
  codigoDeConfirmacaoConfere,
  linhasQueSaem,
  mensagemDoZerar,
  normalizarEntidadesZerar,
  type EntidadeZerar,
  type CodigoZerarEmpresa,
  type LinhaLimpeza,
  type PreviaZerar,
  type ZerarEmpresa,
} from '@macuxi/platform-sdk';

/** `/plataforma/empresas/:id/zerar`, `…/zerar/previa` e `…/zerar/previa/:previa_id` (caminho relativo ao `/v1`). */
export const ZERAR_FALSO_M = /^\/plataforma\/empresas\/([^/]+)\/zerar(\/previa)?(?:\/([^/]+))?$/;
/** A prévia falsa fica pronta este tanto depois de pedida (a tela lê a cada `CONSULTA_PREVIA_ZERAR_MS`). */
export const PREVIA_FALSA_MS = 1_000;

/** O que o falso precisa da empresa (o resto do estado fica em `portal-falso.ts`). */
export interface EmpresaParaZerar {
  id: string;
  codigo: string;
  status: string;
  backupEmAndamento: boolean;
}

/** Contagem de exemplo da empresa inteira, na ordem em que o banco apaga. `atacado-norte` não tem dados ("nada para zerar"). */
const TABELAS_EXEMPLO: readonly LinhaLimpeza[] = [
  { tabela: 'vendedor.pedido_item', modo: 'soft', linhas: 2480 },
  { tabela: 'vendedor.pedido', modo: 'soft', linhas: 312 },
  { tabela: 'core.visita_etapa', modo: 'soft', linhas: 1770 },
  { tabela: 'core.visita', modo: 'soft', linhas: 590 },
  { tabela: 'promotor.registro_gondola', modo: 'soft', linhas: 214 },
  { tabela: 'catalogo.tabela_preco_item', modo: 'soft', linhas: 4120 },
  { tabela: 'core.cliente_endereco', modo: 'soft', linhas: 1310 },
  { tabela: 'core.cliente', modo: 'soft', linhas: 1240 },
  { tabela: 'core.produto', modo: 'soft', linhas: 860 },
  { tabela: 'core.usuario', modo: 'soft', linhas: 18 },
  { tabela: 'integracao.registro_atual', modo: 'fisico', linhas: 6200 },
  { tabela: 'integracao.lote', modo: 'fisico', linhas: 48 },
  { tabela: 'plataforma.evento', modo: 'fisico', linhas: 900 },
  { tabela: 'plataforma.arquivo', modo: 'soft', linhas: 75 },
  { tabela: 'plataforma.sync_pacote', modo: 'sync_pacote', linhas: 4 },
];
const SEM_DADOS = new Set(['atacado-norte']);

/** Linhas de cada entidade no Hub (`registro_atual`) no modo falso; o monitor falso mostra as mesmas. */
export const REGISTROS_FALSOS: Readonly<Partial<Record<EntidadeZerar, { ativos: number; inativos: number }>>> = Object.freeze({
  vendedor: { ativos: 14, inativos: 2 },
  produto: { ativos: 820, inativos: 40 },
  preco: { ativos: 4100, inativos: 20 },
  estoque: { ativos: 812, inativos: 0 },
  cliente: { ativos: 1180, inativos: 60 },
  cliente_endereco: { ativos: 1300, inativos: 10 },
  titulo: { ativos: 356, inativos: 0 },
});

/** Tabela do domínio de cada entidade com dados no falso (a regra de verdade é a `plataforma.limpar_cadastros`, desenho §4.2). */
const TABELA_DA_ENTIDADE: Readonly<Partial<Record<EntidadeZerar, string>>> = {
  vendedor: 'core.usuario',
  produto: 'core.produto',
  preco: 'catalogo.tabela_preco_item',
  estoque: 'catalogo.estoque',
  cliente: 'core.cliente',
  cliente_endereco: 'core.cliente_endereco',
  titulo: 'vendedor.titulo',
};
/** Cascata de exemplo (desenho §4.3): zerar `cliente` derruba os endereços. */
const CASCATA: Readonly<Partial<Record<EntidadeZerar, EntidadeZerar[]>>> = { cliente: ['cliente_endereco'] };

interface ZerarFalso {
  id: string;
  codigo: string;
  entidades: EntidadeZerar[] | null;
  afetadas: EntidadeZerar[];
  pedido_em: string;
  termina_em: number;
  contagem: LinhaLimpeza[];
}
/** Pedidos por empresa, do mais antigo para o mais recente. */
const pedidos = new Map<string, ZerarFalso[]>();
/** Prévias pedidas, pelo id (o tenant fica junto: id de outra empresa = 409 `ID_EM_USO`). */
const previas = new Map<string, { tenant: string; entidades: EntidadeZerar[] | null; criado_em: number }>();

/** Volta ao começo (testes). */
export function limparZerarFalso() {
  pedidos.clear();
  previas.clear();
}

const json = (status: number, corpo: unknown) => new Response(JSON.stringify(corpo), { status, headers: { 'content-type': 'application/json' } });
const recusa = (status: number, codigo: string) => json(status, { codigo, mensagem: mensagemDoZerar(codigo) ?? 'Não foi possível concluir.' });
const iso = (ms: number) => new Date(ms).toISOString();
const carimbo = (ms: number) => iso(ms).replace(/[-:]/g, '').replace(/\.\d{3}/, '');

const ultimo = (tenant: string): ZerarFalso | undefined => pedidos.get(tenant)?.at(-1);
const concluido = (z: ZerarFalso, agora = Date.now()) => agora >= z.termina_em;

/** Entidades já zeradas na empresa (pedidos concluídos); a empresa inteira zerada = todas. O monitor falso esvazia estas. */
export function entidadesZeradasFalso(tenant: string, agora = Date.now()): ReadonlySet<EntidadeZerar> {
  const feitos = (pedidos.get(tenant) ?? []).filter((z) => concluido(z, agora));
  return new Set(feitos.flatMap((z) => (z.entidades === null ? [...ENTIDADES_ZERAR] : z.afetadas)));
}

function zerarDaApi(tenant: string, z: ZerarFalso, agora = Date.now()): ZerarEmpresa {
  const fim = concluido(z, agora);
  return {
    id: z.id,
    tenant_id: tenant,
    codigo: z.codigo,
    entidades: z.entidades,
    entidades_afetadas: fim ? z.afetadas : null,
    lote: `${carimbo(Date.parse(z.pedido_em))}-${z.id.replace(/-/g, '').slice(0, 8)}`,
    situacao: fim ? 'concluido' : 'em_andamento',
    pedido_em: z.pedido_em,
    concluido_em: fim ? iso(z.termina_em) : null,
    linhas_apagadas: fim ? linhasQueSaem(z.contagem) : null,
    contagem: fim ? z.contagem : null,
    copia_expira_em: fim ? iso(z.termina_em + 7 * 86_400_000) : null,
    erro_codigo: null,
  };
}

/** O que sai de cada entidade pedida (mais a cascata): a tabela do domínio (soft) e as linhas do Hub (físico). */
function contagemPorEntidade(tenant: string, pedidas: readonly EntidadeZerar[]): { tabelas: LinhaLimpeza[]; afetadas: EntidadeZerar[] } {
  const zeradas = entidadesZeradasFalso(tenant);
  const todas = normalizarEntidadesZerar([...pedidas, ...pedidas.flatMap((e) => CASCATA[e] ?? [])]);
  const comDados = todas.filter((e) => REGISTROS_FALSOS[e] && !zeradas.has(e));
  const tabelas = comDados.map((e): LinhaLimpeza => ({ tabela: TABELA_DA_ENTIDADE[e] as string, modo: 'soft', linhas: REGISTROS_FALSOS[e]?.ativos ?? 0 }));
  const hub = comDados.reduce((a, e) => a + (REGISTROS_FALSOS[e]?.ativos ?? 0) + (REGISTROS_FALSOS[e]?.inativos ?? 0), 0);
  if (hub > 0) tabelas.push({ tabela: 'integracao.registro_atual', modo: 'fisico', linhas: hub });
  // as pedidas entram sempre (o ERP reenvia o que se pediu); as da cascata, só se tiveram linhas
  return { tabelas, afetadas: normalizarEntidadesZerar([...pedidas, ...comDados]) };
}

/** Bloqueio fixo do falso (a regra de verdade é a `plataforma.zerar_bloqueado`): exclusão, zerar ou backup no ar. */
function bloqueioFalso(x: EmpresaParaZerar): CodigoZerarEmpresa | null {
  const z = ultimo(x.id);
  if (x.status === 'encerrado') return Z.exclusaoEmAndamento;
  if (z && !concluido(z)) return Z.zerarEmAndamento;
  return x.backupEmAndamento ? Z.backupEmAndamento : null;
}

/** A conta de agora: as tabelas que sairiam e as entidades afetadas. */
function contar(x: EmpresaParaZerar, entidades: EntidadeZerar[] | null): { tabelas: LinhaLimpeza[]; afetadas: EntidadeZerar[] } {
  if (entidades) return contagemPorEntidade(x.id, entidades);
  const inteiraZerada = (pedidos.get(x.id) ?? []).some((p) => p.entidades === null);
  const tabelas = inteiraZerada || SEM_DADOS.has(x.codigo) ? [] : [...TABELAS_EXEMPLO];
  return { tabelas, afetadas: linhasQueSaem(tabelas) > 0 ? [...ENTIDADES_ZERAR] : [] };
}

function previaDaApi(x: EmpresaParaZerar, id: string, agora = Date.now()): PreviaZerar {
  const p = previas.get(id) as { entidades: EntidadeZerar[] | null; criado_em: number };
  const base = { id, entidades: p.entidades, criado_em: iso(p.criado_em), erro_codigo: null };
  if (agora < p.criado_em + PREVIA_FALSA_MS) return { ...base, situacao: 'em_andamento', linhas: null, entidades_afetadas: null, total: null, bloqueio: null };
  const { tabelas, afetadas } = contar(x, p.entidades);
  const linhas = tabelas.map((t, ordem) => ({ ordem, tabela: t.tabela, linhas: t.linhas }));
  return { ...base, situacao: 'pronta', linhas, entidades_afetadas: afetadas, total: linhasQueSaem(tabelas), bloqueio: bloqueioFalso(x) };
}

/**
 * Responde as rotas do zerar. `empresa` = null: 404. Só o time da Macuxi (o chamador confere o perfil antes). `previaId`: o
 * `:previa_id` de `…/zerar/previa/:previa_id`.
 */
export function responderZerarFalso(metodo: string, empresa: EmpresaParaZerar | null, previa: boolean, corpo: unknown, previaId?: string): Response {
  if (!empresa) return recusa(404, Z.naoEncontrada);
  if (previa && previaId !== undefined && metodo === 'GET') {
    return previas.get(previaId)?.tenant === empresa.id ? json(200, previaDaApi(empresa, previaId)) : recusa(404, Z.previaNaoEncontrada);
  }
  if (previa && previaId === undefined && metodo === 'POST') {
    const c = PedirPreviaZerarSchema.safeParse(corpo);
    if (!c.success) return json(400, { codigo: 'VALIDACAO', mensagem: c.error.issues[0]?.message ?? 'Dados inválidos.' });
    const ja = previas.get(c.data.id);
    if (ja && ja.tenant !== empresa.id) return recusa(409, Z.idEmUso);
    if (!ja) previas.set(c.data.id, { tenant: empresa.id, entidades: c.data.entidades, criado_em: Date.now() });
    return json(202, previaDaApi(empresa, c.data.id));
  }
  if (previa || previaId !== undefined) return json(404, { codigo: 'NAO_ENCONTRADO', mensagem: 'Rota não encontrada.' });
  if (metodo === 'GET') {
    const z = ultimo(empresa.id);
    return z ? json(200, zerarDaApi(empresa.id, z)) : recusa(404, Z.zerarNaoEncontrado);
  }
  if (metodo === 'POST') {
    const c = PedirZerarEmpresaSchema.safeParse(corpo);
    if (!c.success) return json(400, { codigo: 'VALIDACAO', mensagem: c.error.issues[0]?.message ?? 'Dados inválidos.' });
    const mesmo = (pedidos.get(empresa.id) ?? []).find((z) => z.id === c.data.id);
    if (mesmo) return json(202, zerarDaApi(empresa.id, mesmo));
    const bloqueio = bloqueioFalso(empresa);
    if (bloqueio) return recusa(409, bloqueio);
    if (c.data.senha === 'errada') return recusa(403, Z.reautenticacaoFalhou);
    if (!codigoDeConfirmacaoConfere(c.data.codigo_confirmacao, empresa.codigo)) return recusa(422, Z.codigoNaoConfere);
    const conta = contar(empresa, c.data.entidades);
    const agora = Date.now();
    const z: ZerarFalso = {
      id: c.data.id,
      codigo: empresa.codigo,
      entidades: c.data.entidades,
      afetadas: conta.afetadas,
      pedido_em: iso(agora),
      termina_em: agora + 6_000,
      contagem: conta.tabelas,
    };
    pedidos.set(empresa.id, [...(pedidos.get(empresa.id) ?? []), z]);
    return json(202, zerarDaApi(empresa.id, z));
  }
  return json(404, { codigo: 'NAO_ENCONTRADO', mensagem: 'Rota não encontrada.' });
}
