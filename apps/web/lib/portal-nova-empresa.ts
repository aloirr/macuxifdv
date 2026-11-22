/**
 * "Nova empresa" do portal `config.` (spec docs/design/telas/portal-config-enxuto.md §4 e §11): corpo do
 * `POST /v1/plataforma/empresas-com-plano` (`CriarEmpresaComPlanoSchema`, ADR 0047), erros por campo em pt-BR e o aviso de sucesso
 * de uma vez só. Puro, para teste.
 * - Código da empresa = código da licença, UF + 4 dígitos (ex.: AM4821; migração 0068). O contrato de hoje ainda pede o `codigo`
 *   (o servidor não sorteia pela UF): o portal sorteia o número e confere antes com `simular: true` que o código é novo
 *   (`resultado: 'criado'`); código já em uso = sorteia outro. Sem o campo "Código" na tela.
 * - Sem `parametros` (R-20261114-122200: a empresa nasce com os padrões) e sem `modulos` (vêm do plano, RN-PLA-01).
 * - Administrador inicial (RN-CORE-34) com a senha na RN-CORE-32; a senha só vive no estado da tela (nunca em storage, URL ou log).
 */
import { ehUf } from '@macuxi/comum/endereco';
import { faltasNaSenha, mensagemDaSenha, textoDoErroDaSenha } from '@macuxi/core/contracts';
import { AdminInicialEmpresaSchema, CriarEmpresaComPlanoSchema, type CriarEmpresaComPlanoResposta } from '@macuxi/platform-sdk';

import { ErroPortal } from './portal-api';
import { adicionaisDaEscolha, errosDaEscolha, mensagensDosProblemas, type EscolhaDaTela } from './portal-planos';

export const TEXTOS_NOVA_EMPRESA = Object.freeze({
  titulo: 'Nova empresa',
  empresa: 'Empresa',
  criar: 'Criar empresa',
  criando: 'Criando…',
  confira: 'Confira os campos marcados.',
  escolhaUf: 'Escolha a UF.',
  // o código já está no cabeçalho da página da empresa (RD-2614)
  criada: 'Empresa criada.',
});

/** Textos do bloco "Administrador da empresa" (§4 item 3; RD-0272), os mesmos no passo antigo (RD-2620). */
export const TEXTOS_ADMIN = Object.freeze({
  titulo: 'Administrador da empresa',
  passeASenha: 'Passe esta senha ao administrador.',
  faltaAdmin: 'Informe o administrador da empresa.',
  nomeVazio: 'Informe o nome.',
  emailVazio: 'Informe o e-mail.',
  senhaVazia: 'Informe a senha inicial.',
  nomeCurto: 'Informe o nome, de 2 a 120 caracteres.',
  emailInvalido: 'Informe um e-mail válido, como nome@empresa.com.br.',
});

/** Cópia de `e` sem as chaves dadas (o erro antigo do campo some ao digitar). */
export function semChaves(e: Record<string, string>, ...ks: string[]): Record<string, string> {
  return Object.fromEntries(Object.entries(e).filter(([c]) => !ks.includes(c)));
}

export interface AdminDoForm {
  nome: string;
  email: string;
  senha: string;
}

/** O que a tela manda (os outros campos da Receita, como endereço e CNAE, só aparecem: o contrato da empresa não os tem). */
export interface FormNovaEmpresa {
  cnpj: string;
  razao_social: string;
  uf: string;
  fuso: string;
  escolha: EscolhaDaTela;
  admin: AdminDoForm;
  /** Chave de idempotência da assinatura (`EscolhaNaCriacaoSchema.pedido_id`), gerada no portal. */
  pedido_id: string;
}

/**
 * Código da licença sorteado para a UF: sigla + 4 dígitos (0000 a 9999), em minúsculas no corpo (o `CodigoTenant` do contrato
 * normaliza; a tela e o login mostram em maiúsculas). `n` fora de 0..9999 = erro de quem chama.
 */
export function codigoDaUf(uf: string, n: number): string {
  if (!ehUf(uf) || !Number.isInteger(n) || n < 0 || n > 9_999) throw new RangeError('codigoDaUf: UF ou número inválido');
  return `${uf.toLowerCase()}${String(n).padStart(4, '0')}`;
}

/** Tentativas de sorteio antes de desistir (cada uma é um `simular`). */
export const SORTEIOS_DO_CODIGO = 5;

/** O `simular` confirma que o código é novo só com `resultado: 'criado'` (outro resultado = código de uma empresa que já existe). */
export const codigoLivre = (r: Pick<CriarEmpresaComPlanoResposta, 'resultado'>): boolean => r.resultado === 'criado';

/**
 * Erros do administrador por campo (`admin.nome`, `admin.email`, `admin.senha`): vazio, formato do contrato e a RN-CORE-32 pela
 * regra do Core; a API revalida. Senha vazia: só "Informe a senha inicial." (RD-0272).
 */
export function errosDoAdmin(a: AdminDoForm): Record<string, string> {
  const e: Record<string, string> = {};
  if (!a.nome.trim()) e['admin.nome'] = TEXTOS_ADMIN.nomeVazio;
  if (!a.email.trim()) e['admin.email'] = TEXTOS_ADMIN.emailVazio;
  if (!a.senha) e['admin.senha'] = TEXTOS_ADMIN.senhaVazia;
  else {
    const m = mensagemDaSenha(faltasNaSenha(a.senha), a.senha);
    if (m) e['admin.senha'] = m;
  }
  const p = AdminInicialEmpresaSchema.safeParse({ nome: a.nome, email: a.email, senha: a.senha });
  if (!p.success) {
    for (const i of p.error.issues) {
      const campo = String(i.path[0] ?? '');
      if (campo === 'nome') e['admin.nome'] ??= TEXTOS_ADMIN.nomeCurto;
      else if (campo === 'email') e['admin.email'] ??= TEXTOS_ADMIN.emailInvalido;
    }
  }
  return e;
}

/** Corpo do `POST /v1/plataforma/empresas-com-plano` com o código sorteado; `simular` confere sem gravar. */
export function corpoDaNovaEmpresa(f: FormNovaEmpresa, codigo: string, simular: boolean): unknown {
  return {
    codigo,
    razao_social: f.razao_social.trim(),
    cnpj: f.cnpj,
    fuso: f.fuso,
    // sem `trim` na senha (RN-CORE-32); o e-mail o contrato normaliza
    admin: { nome: f.admin.nome.trim(), email: f.admin.email.trim(), senha: f.admin.senha },
    assinatura: { plano: f.escolha.plano, ciclo: f.escolha.ciclo, adicionais: adicionaisDaEscolha(f.escolha), com_teste: f.escolha.teste, pedido_id: f.pedido_id },
    simular,
  };
}

/** Mensagens em pt-BR para as falhas do Zod nos campos da empresa. */
const MENSAGEM_DO_CAMPO: Readonly<Record<string, string>> = {
  razao_social: 'Informe a razão social, de 2 a 200 caracteres.',
  cnpj: 'CNPJ inválido. Confira os 14 dígitos.',
  fuso: 'Escolha o fuso da empresa.',
};

/** Erros por campo do formulário inteiro (empresa, UF, plano, adicionais e administrador). */
export function errosDaNovaEmpresa(f: FormNovaEmpresa): Record<string, string> {
  const e: Record<string, string> = {};
  if (!ehUf(f.uf)) e.uf = TEXTOS_NOVA_EMPRESA.escolhaUf;
  // o código ainda não foi sorteado aqui: um válido só para conferir o resto do corpo
  const p = CriarEmpresaComPlanoSchema.safeParse(corpoDaNovaEmpresa(f, 'am0000', false));
  if (!p.success) {
    for (const i of p.error.issues) {
      const k = String(i.path[0] ?? '');
      const msg = MENSAGEM_DO_CAMPO[k];
      if (msg) e[k] ??= msg;
    }
  }
  return { ...e, ...errosDaEscolha(f.escolha), ...errosDoAdmin(f.admin) };
}

/**
 * Erro 422 da API no administrador: `RN-CORE-34` = falta o administrador (aviso no topo do bloco); `RN-CORE-32` = a senha não
 * serve (texto da fonte única do Core, embaixo do campo). Outro erro: `null`.
 */
export function erroDoAdminNaApi(x: unknown, senha: string): { bloco: string } | { senha: string } | null {
  if (!(x instanceof ErroPortal) || x.status !== 422) return null;
  if (x.codigo === 'RN-CORE-34') return { bloco: TEXTOS_ADMIN.faltaAdmin };
  if (x.codigo === 'RN-CORE-32') return { senha: textoDoErroDaSenha(x, senha) };
  return null;
}

/** Problemas do plano no 422 (`PLANO_*`, `ADICIONAL_*`; `detalhes.problemas[].mensagem`): uma linha por item, no cartão do plano. */
export function problemasDoPlano(x: unknown): string[] | null {
  if (!(x instanceof ErroPortal) || x.status !== 422 || !/^(PLANO_|ADICIONAL_)/.test(x.codigo)) return null;
  return mensagensDosProblemas(x.detalhes, x.message);
}

// ---------------------------------------------------------------------------------------------------------------- aviso, uma vez

/** Empresa recém-criada → código, só na memória da aba: a página da empresa mostra o aviso uma vez e o retira. */
const criadas = new Map<string, string>();
export function guardarEmpresaCriada(tenantId: string, codigo: string): void {
  criadas.set(tenantId, codigo);
}
export function retirarEmpresaCriada(tenantId: string): string | null {
  const c = criadas.get(tenantId) ?? null;
  criadas.delete(tenantId);
  return c;
}
