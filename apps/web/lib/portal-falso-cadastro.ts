/**
 * Dados cadastrais da empresa no modo falso do portal (ADR 0075): `GET` e `PUT /plataforma/empresas/:id/cadastro` como a API,
 * contra os schemas do SDK, para o e2e e os prints. Time da Macuxi em qualquer empresa; admin do cliente só na escolhida (403).
 * O `PUT` recebe as 11 chaves (`GravarDadosCadastraisEmpresaSchema`, `.strict()`); formato inválido = 422
 * `CADASTRO_EMPRESA_INVALIDO` com `detalhes.problemas` (caminho `corpo.<campo>` e a frase), como a API. Estado só na memória da aba.
 */
import { CODIGOS_CADASTRO_EMPRESA, DadosCadastraisEmpresaSchema, GravarDadosCadastraisEmpresaSchema, type DadosCadastraisEmpresa } from '@macuxi/platform-sdk';

/** `/plataforma/empresas/:id/cadastro` (caminho relativo ao `/v1`). */
export const CADASTRO_FALSO_M = /^\/plataforma\/empresas\/([^/]+)\/cadastro$/;

/** O que o falso precisa da empresa (o resto do estado fica em `portal-falso.ts`). */
export interface EmpresaDoCadastro {
  id: string;
  razao_social: string;
  cnpj: string | null;
  nome_fantasia: string | null;
}

type Campos = Omit<DadosCadastraisEmpresa, 'tenant_id' | 'cnpj' | 'razao_social' | 'nome_fantasia' | 'atualizado_em'>;
const SEM_CAMPOS: Campos = { logradouro: null, numero: null, complemento: null, bairro: null, municipio: null, uf: null, cep: null, telefone: null, email: null, inscricao_estadual: null };

/** A Distribuidora Uma começa com parte do cadastro (telefone e e-mail): o "Trazer dados da Receita" preenche só o resto. */
const INICIAIS: Readonly<Record<string, Partial<Campos>>> = {
  '0b6f1a52-5c1e-4c4e-9a43-000000000001': { telefone: '9236330000', email: 'financeiro@distribuidora-uma.com.br' },
};

const cadastros = new Map<string, { campos: Campos; atualizado_em: string }>();

const json = (status: number, corpo: unknown) => new Response(status === 204 ? null : JSON.stringify(corpo), { status, headers: { 'content-type': 'application/json' } });
const erro = (status: number, codigo: string, mensagem: string, detalhes?: Record<string, unknown>) => json(status, { codigo, mensagem, ...(detalhes ? { detalhes } : {}) });

function atual(x: EmpresaDoCadastro) {
  return cadastros.get(x.id) ?? { campos: { ...SEM_CAMPOS, ...INICIAIS[x.id] }, atualizado_em: '2026-11-01T12:00:00.000Z' };
}

function dados(x: EmpresaDoCadastro): DadosCadastraisEmpresa {
  const c = atual(x);
  return DadosCadastraisEmpresaSchema.parse({ tenant_id: x.id, cnpj: x.cnpj, razao_social: x.razao_social, nome_fantasia: x.nome_fantasia, ...c.campos, atualizado_em: c.atualizado_em });
}

/**
 * Responde a rota do cadastro. `empresa` nula = 404; `podeVer` falso = 403 (admin do cliente fora da empresa escolhida).
 * `gravarRazaoSocial`: a razão social mora na empresa do falso (como em `plataforma.tenant.nome`); a lista acompanha.
 */
export function responderCadastroFalso(metodo: string, empresa: EmpresaDoCadastro | null, podeVer: boolean, corpo: unknown, gravarRazaoSocial: (r: string) => void): Response {
  if (!empresa) return erro(404, 'TENANT_NAO_ENCONTRADO', 'Empresa não encontrada.');
  if (!podeVer) return erro(403, 'PERFIL_SEM_ACESSO', 'Você não tem acesso a esta empresa.');
  if (metodo === 'GET') return json(200, dados(empresa));
  if (metodo !== 'PUT') return erro(405, 'METODO_NAO_PERMITIDO', 'Método não permitido.');
  const p = GravarDadosCadastraisEmpresaSchema.safeParse(corpo);
  if (!p.success) {
    const problemas = p.error.issues.slice(0, 20).map((i) => ({ caminho: ['corpo', ...i.path].join('.'), mensagem: i.message }));
    return erro(422, CODIGOS_CADASTRO_EMPRESA.invalido, 'Confira os dados cadastrais.', { problemas });
  }
  const { razao_social, ...campos } = p.data;
  const antes = atual(empresa);
  // sem mudança, não grava (idempotente, como a `sa_gravar_dados_da_empresa`)
  if (razao_social === empresa.razao_social && JSON.stringify(campos) === JSON.stringify(antes.campos)) return json(200, dados(empresa));
  cadastros.set(empresa.id, { campos, atualizado_em: new Date().toISOString() });
  if (razao_social !== empresa.razao_social) gravarRazaoSocial(razao_social);
  return json(200, dados({ ...empresa, razao_social }));
}

/** Recomeça (testes e `zerarModoFalso`). */
export function zerarCadastroFalso() {
  cadastros.clear();
}
