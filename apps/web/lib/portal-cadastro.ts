/**
 * Dados cadastrais da empresa no portal (ADR 0075; R-20261124-090942 item 04): regras puras do cartão "Dados da empresa" da aba
 * Empresa (`components/portal/cartao-dados-cadastrais.tsx`; "Dados cadastrais" é o do menu do usuário: uma tela, um nome por item).
 * - Leitura: `GET rotaCadastroEmpresa` (`DadosCadastraisEmpresaSchema`); o que não está preenchido fica em branco; o endereço numa
 *   linha só (`linhaDoEndereco`).
 * - Edição: as 11 chaves do `GravarDadosCadastraisEmpresaSchema` (CNPJ só leitura); o nome fantasia grava pela rota da marca
 *   (T-0182), só para o time da Macuxi (a gaveta cuida dele).
 * - "Trazer dados da Receita Federal": a consulta existente (`POST /plataforma/cnpj`, ADR 0048) com o CNPJ da empresa preenche SÓ
 *   os campos vazios (`preencherVazios`); nada grava sem o "Salvar".
 * - 422 `CADASTRO_EMPRESA_INVALIDO`: a frase de cada campo (`detalhes.problemas`, caminho `corpo.<campo>`), embaixo do campo.
 */
import { formatarCep } from '@macuxi/comum/endereco';
import { CODIGOS_CADASTRO_EMPRESA, GravarDadosCadastraisEmpresaSchema, type ConsultaCnpjResposta, type DadosCadastraisEmpresa, type GravarDadosCadastraisEmpresa } from '@macuxi/platform-sdk';

import { ehRotaAusente, ErroPortal } from './portal-api';
import { formatarTelefone, mascararCnpj } from './portal-formato';

/** As 11 chaves que o administrador edita, na ordem da tela. */
export const CAMPOS_CADASTRO = ['razao_social', 'logradouro', 'numero', 'complemento', 'bairro', 'municipio', 'uf', 'cep', 'telefone', 'email', 'inscricao_estadual'] as const;
export type CampoCadastro = (typeof CAMPOS_CADASTRO)[number];
/** O que a gaveta edita: texto como digitado (vazio = não preenchido). */
export type FormularioCadastro = Record<CampoCadastro, string>;

export const TEXTOS_CADASTRO = Object.freeze({
  titulo: 'Dados da empresa',
  editar: 'Editar',
  salvar: 'Salvar',
  salvando: 'Salvando…',
  cancelar: 'Cancelar',
  salvos: 'Dados da empresa salvos.',
  receita: 'Trazer dados da Receita Federal',
  buscando: 'Buscando na Receita…',
  preenchidos: (n: number) => (n === 1 ? '1 campo preenchido com os dados da Receita. Confira e salve.' : `${n} campos preenchidos com os dados da Receita. Confira e salve.`),
  nadaVazio: 'A Receita não tem dado para os campos vazios.',
  buscandoDados: 'Buscando os dados da empresa…',
});

export const ROTULOS_CADASTRO: Readonly<Record<CampoCadastro | 'cnpj' | 'nome_fantasia', string>> = Object.freeze({
  cnpj: 'CNPJ',
  razao_social: 'Razão social',
  nome_fantasia: 'Nome fantasia',
  logradouro: 'Logradouro',
  numero: 'Número',
  complemento: 'Complemento',
  bairro: 'Bairro',
  municipio: 'Município',
  uf: 'UF',
  cep: 'CEP',
  telefone: 'Telefone',
  email: 'E-mail',
  inscricao_estadual: 'Inscrição estadual',
});

export const ROTULO_ENDERECO = 'Endereço';

/** Campos que ocupam a linha toda no cartão e na gaveta (o resto vai em pares). */
export const CAMPOS_LARGOS: ReadonlySet<string> = new Set(['razao_social', 'nome_fantasia', 'endereco', 'email']);

/**
 * Linhas do cadastro, na ordem da tela (a gaveta; o cartão junta o endereço em `linhasDaLeitura`): CNPJ e inscrição estadual, razão social, nome fantasia, endereço, telefone e
 * e-mail. `valor` vazio = não preenchido (fica em branco).
 */
export function linhasDoCadastro(d: DadosCadastraisEmpresa): { campo: keyof typeof ROTULOS_CADASTRO; rotulo: string; valor: string }[] {
  const valores: Record<keyof typeof ROTULOS_CADASTRO, string> = {
    cnpj: d.cnpj ? mascararCnpj(d.cnpj) : '',
    razao_social: d.razao_social,
    nome_fantasia: d.nome_fantasia ?? '',
    logradouro: d.logradouro ?? '',
    numero: d.numero ?? '',
    complemento: d.complemento ?? '',
    bairro: d.bairro ?? '',
    municipio: d.municipio ?? '',
    uf: d.uf ?? '',
    cep: d.cep ? formatarCep(d.cep) : '',
    telefone: d.telefone ? formatarTelefone(d.telefone) : '',
    email: d.email ?? '',
    inscricao_estadual: d.inscricao_estadual ?? '',
  };
  const ordem = ['cnpj', 'inscricao_estadual', 'razao_social', 'nome_fantasia', 'logradouro', 'numero', 'complemento', 'bairro', 'municipio', 'uf', 'cep', 'telefone', 'email'] as const;
  return ordem.map((campo) => ({ campo, rotulo: ROTULOS_CADASTRO[campo], valor: valores[campo] }));
}

/**
 * O endereço numa linha só, no cartão (R-20261124-090942 item 04, RD-3130): "Rua X, 100 · Sala 2 · Chapada · Manaus/AM ·
 * 69000-000"; o que falta sai da linha; tudo vazio = em branco. A gaveta edita os campos separados.
 */
export function linhaDoEndereco(d: DadosCadastraisEmpresa): string {
  const v = (x: string | null | undefined) => x?.trim() ?? '';
  const rua = [v(d.logradouro), v(d.numero)].filter(Boolean).join(', ');
  const cidade = [v(d.municipio), v(d.uf)].filter(Boolean).join('/');
  return [rua, v(d.complemento), v(d.bairro), cidade, d.cep ? formatarCep(d.cep) : ''].filter(Boolean).join(' · ');
}

type LinhaDaLeitura = { campo: keyof typeof ROTULOS_CADASTRO | 'endereco'; rotulo: string; valor: string };

/** Os 7 campos do endereço, que o cartão junta em `linhaDoEndereco`. */
const CAMPOS_ENDERECO: ReadonlySet<string> = new Set(['logradouro', 'numero', 'complemento', 'bairro', 'municipio', 'uf', 'cep']);

/** Linhas do cartão (só leitura): as de `linhasDoCadastro`, com o endereço numa linha só, no lugar do logradouro. */
export function linhasDaLeitura(d: DadosCadastraisEmpresa): LinhaDaLeitura[] {
  return linhasDoCadastro(d).flatMap((l): LinhaDaLeitura[] => {
    if (l.campo === 'logradouro') return [{ campo: 'endereco', rotulo: ROTULO_ENDERECO, valor: linhaDoEndereco(d) }];
    return CAMPOS_ENDERECO.has(l.campo) ? [] : [l];
  });
}

/** Formulário a partir do cadastro lido (CEP e telefone já com a máscara). */
export function formularioDoCadastro(d: DadosCadastraisEmpresa): FormularioCadastro {
  return {
    razao_social: d.razao_social,
    logradouro: d.logradouro ?? '',
    numero: d.numero ?? '',
    complemento: d.complemento ?? '',
    bairro: d.bairro ?? '',
    municipio: d.municipio ?? '',
    uf: d.uf ?? '',
    cep: d.cep ? formatarCep(d.cep) : '',
    telefone: d.telefone ? formatarTelefone(d.telefone) : '',
    email: d.email ?? '',
    inscricao_estadual: d.inscricao_estadual ?? '',
  };
}

/** O que a Receita devolve, campo a campo (`null` = a Receita não tem). A inscrição estadual não vem da Receita. */
function daReceita(r: ConsultaCnpjResposta): Record<CampoCadastro, string | null> {
  return {
    razao_social: r.razao_social,
    logradouro: r.endereco.logradouro,
    numero: r.endereco.numero,
    complemento: r.endereco.complemento,
    bairro: r.endereco.bairro,
    municipio: r.municipio,
    uf: r.uf,
    cep: r.cep ? formatarCep(r.cep) : null,
    telefone: r.telefone ? formatarTelefone(r.telefone) : null,
    email: r.email,
    inscricao_estadual: null,
  };
}

/**
 * Preenche SÓ os campos vazios (ou só com espaços) com o que a Receita tem (ADR 0075 §5): o que o administrador já digitou nunca
 * é sobrescrito. Devolve o formulário novo e os campos preenchidos, na ordem da tela.
 */
export function preencherVazios(atual: FormularioCadastro, r: ConsultaCnpjResposta): { formulario: FormularioCadastro; preenchidos: CampoCadastro[] } {
  const receita = daReceita(r);
  const formulario = { ...atual };
  const preenchidos: CampoCadastro[] = [];
  for (const c of CAMPOS_CADASTRO) {
    const valor = receita[c]?.trim();
    if (atual[c].trim() === '' && valor) {
      formulario[c] = valor;
      preenchidos.push(c);
    }
  }
  return { formulario, preenchidos };
}

/** O formulário mudou em relação ao que foi lido (sem contar espaços nas pontas). */
export function formularioMudou(f: FormularioCadastro, lido: FormularioCadastro): boolean {
  return CAMPOS_CADASTRO.some((c) => f[c].trim() !== lido[c].trim());
}

export type ErrosDoCadastro = Partial<Record<CampoCadastro, string>>;

/** Erros por campo a partir dos problemas do Zod (na tela) ou do `detalhes.problemas` da API (`corpo.<campo>`). */
function errosDosProblemas(problemas: readonly { caminho: string; mensagem: string }[]): ErrosDoCadastro {
  const erros: ErrosDoCadastro = {};
  for (const p of problemas) {
    const campo = p.caminho.replace(/^corpo\./, '').split('.')[0] as CampoCadastro;
    if ((CAMPOS_CADASTRO as readonly string[]).includes(campo) && !erros[campo]) erros[campo] = p.mensagem;
  }
  return erros;
}

/**
 * Confere o formulário com o schema do SDK antes de enviar (a API revalida): o corpo do `PUT` (11 chaves, normalizado) ou os
 * erros por campo.
 */
export function corpoDoCadastro(f: FormularioCadastro): { ok: true; corpo: GravarDadosCadastraisEmpresa } | { ok: false; erros: ErrosDoCadastro } {
  const p = GravarDadosCadastraisEmpresaSchema.safeParse(f);
  if (p.success) return { ok: true, corpo: p.data };
  return { ok: false, erros: errosDosProblemas(p.error.issues.map((i) => ({ caminho: i.path.join('.'), mensagem: i.message }))) };
}

/** 422 `CADASTRO_EMPRESA_INVALIDO` → erros por campo; outro erro → `null` (a gaveta mostra a mensagem geral). */
export function errosDaApi(e: unknown): ErrosDoCadastro | null {
  if (!(e instanceof ErroPortal) || e.status !== 422 || e.codigo !== CODIGOS_CADASTRO_EMPRESA.invalido) return null;
  const lista = Array.isArray(e.detalhes?.problemas) ? (e.detalhes.problemas as unknown[]) : [];
  const problemas = lista.filter((p): p is { caminho: string; mensagem: string } => !!p && typeof (p as { caminho?: unknown }).caminho === 'string' && typeof (p as { mensagem?: unknown }).mensagem === 'string');
  const erros = errosDosProblemas(problemas);
  return Object.keys(erros).length > 0 ? erros : null;
}

/** 503 `CADASTRO_EMPRESA_INDISPONIVEL` (banco sem a 0102) ou a rota ainda ausente: o cartão diz que não está disponível. */
export function cadastroIndisponivel(e: unknown): boolean {
  return ehRotaAusente(e) || (e instanceof ErroPortal && e.status === 503 && e.codigo === CODIGOS_CADASTRO_EMPRESA.indisponivel);
}
