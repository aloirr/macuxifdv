/**
 * "Zerar dados" no modo falso do portal (ADR 0068; desenho docs/desenho/empresa-zerar.md §3): `GET …/zerar/previa`, `POST …/zerar`
 * e `GET …/zerar` como a API, contra os schemas do SDK, para o e2e e os prints. Liberação pela `conferirZerar` do SDK e frases pela
 * `mensagemDoZerar`. O pedido termina 6 s depois; senha `errada` = 403. Estado só na memória da aba.
 */
import {
  CODIGOS_ZERAR_EMPRESA as Z,
  PedirZerarEmpresaSchema,
  codigoDeConfirmacaoConfere,
  conferirZerar,
  mensagemDoZerar,
  type PreviaZerarEmpresa,
  type StatusEmpresa,
  type ZerarEmpresa,
} from '@macuxi/platform-sdk';

/** `/plataforma/empresas/:id/zerar` e `/plataforma/empresas/:id/zerar/previa` (caminho relativo ao `/v1`). */
export const ZERAR_FALSO_M = /^\/plataforma\/empresas\/([^/]+)\/zerar(\/previa)?$/;

/** O que o falso precisa da empresa (o resto do estado fica em `portal-falso.ts`). */
export interface EmpresaParaZerar {
  id: string;
  codigo: string;
  status: string;
  backupEmAndamento: boolean;
}

/** Contagem de exemplo por tabela, na ordem em que o banco apaga. `atacado-norte` não tem dados (estado "nada para zerar"). */
const TABELAS_EXEMPLO: readonly { tabela: string; linhas: number }[] = [
  { tabela: 'vendedor.pedido_item', linhas: 2480 },
  { tabela: 'vendedor.pedido', linhas: 312 },
  { tabela: 'core.visita_etapa', linhas: 1770 },
  { tabela: 'core.visita', linhas: 590 },
  { tabela: 'promotor.registro_gondola', linhas: 214 },
  { tabela: 'catalogo.tabela_preco_item', linhas: 4120 },
  { tabela: 'core.cliente_endereco', linhas: 1310 },
  { tabela: 'core.cliente', linhas: 1240 },
  { tabela: 'core.produto', linhas: 860 },
  { tabela: 'integracao.registro_atual', linhas: 6200 },
  { tabela: 'integracao.lote', linhas: 48 },
  { tabela: 'plataforma.evento', linhas: 900 },
  { tabela: 'plataforma.arquivo', linhas: 75 },
];
const SEM_DADOS = new Set(['atacado-norte']);

interface ZerarFalso {
  id: string;
  codigo: string;
  pedido_em: string;
  termina_em: number;
  contagem: Record<string, number>;
}
const pedidos = new Map<string, ZerarFalso>();

/** Volta ao começo (testes). */
export function limparZerarFalso() {
  pedidos.clear();
}

const json = (status: number, corpo: unknown) => new Response(JSON.stringify(corpo), { status, headers: { 'content-type': 'application/json' } });
const recusa = (status: number, codigo: string) => json(status, { codigo, mensagem: mensagemDoZerar(codigo) ?? 'Não foi possível concluir.' });
const iso = (ms: number) => new Date(ms).toISOString();

function zerarDaApi(tenant: string, z: ZerarFalso, agora = Date.now()): ZerarEmpresa {
  const fim = agora >= z.termina_em;
  const linhas = Object.values(z.contagem).reduce((a, b) => a + b, 0);
  return {
    id: z.id,
    tenant_id: tenant,
    codigo: z.codigo,
    origem: 'portal',
    situacao: fim ? 'concluido' : 'em_andamento',
    pedido_em: z.pedido_em,
    concluido_em: fim ? iso(z.termina_em) : null,
    linhas_apagadas: fim ? linhas : null,
    contagem: fim ? z.contagem : null,
    copia_expira_em: fim ? iso(z.termina_em + 7 * 86_400_000) : null,
    erro_codigo: null,
  };
}

function previaDe(x: EmpresaParaZerar): PreviaZerarEmpresa {
  const z = pedidos.get(x.id);
  const emAndamento = !!z && zerarDaApi(x.id, z).situacao === 'em_andamento';
  const tabelas = z || SEM_DADOS.has(x.codigo) ? [] : [...TABELAS_EXEMPLO];
  const total = tabelas.reduce((a, t) => a + t.linhas, 0);
  const regra = conferirZerar(
    { status: x.status as StatusEmpresa },
    { zerar_em_andamento: emAndamento, backup_em_andamento: x.backupEmAndamento, exclusao_em_andamento: false },
    total,
  );
  return { tenant_id: x.id, codigo: x.codigo, contado_em: iso(Date.now()), total_linhas: total, tabelas, bloqueio: regra.ok ? null : regra.codigo };
}

/** Responde as rotas do zerar. `empresa` = null: 404. Só o time da Macuxi (o chamador confere o perfil antes). */
export function responderZerarFalso(metodo: string, empresa: EmpresaParaZerar | null, previa: boolean, corpo: unknown): Response {
  if (!empresa) return recusa(404, Z.naoEncontrada);
  if (previa && metodo === 'GET') return json(200, previaDe(empresa));
  if (!previa && metodo === 'GET') {
    const z = pedidos.get(empresa.id);
    return z ? json(200, zerarDaApi(empresa.id, z)) : recusa(404, Z.zerarNaoEncontrado);
  }
  if (!previa && metodo === 'POST') {
    const c = PedirZerarEmpresaSchema.safeParse(corpo);
    if (!c.success) return json(400, { codigo: 'VALIDACAO', mensagem: c.error.issues[0]?.message ?? 'Dados inválidos.' });
    const mesmo = pedidos.get(empresa.id);
    if (mesmo?.id === c.data.id) return json(202, zerarDaApi(empresa.id, mesmo));
    const p = previaDe(empresa);
    if (p.bloqueio) return recusa(p.bloqueio === Z.volumeAlto ? 422 : 409, p.bloqueio);
    if (c.data.senha === 'errada') return recusa(403, Z.reautenticacaoFalhou);
    if (!codigoDeConfirmacaoConfere(c.data.codigo_confirmacao, empresa.codigo)) return recusa(422, Z.codigoNaoConfere);
    const contagem = Object.fromEntries(p.tabelas.map((t) => [t.tabela, t.linhas]));
    const z: ZerarFalso = { id: c.data.id, codigo: empresa.codigo, pedido_em: iso(Date.now()), termina_em: Date.now() + 6_000, contagem };
    pedidos.set(empresa.id, z);
    return json(202, zerarDaApi(empresa.id, z));
  }
  return json(404, { codigo: 'NAO_ENCONTRADO', mensagem: 'Rota não encontrada.' });
}
