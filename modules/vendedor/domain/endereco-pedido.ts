/**
 * Endereço de entrega do pedido (RN-VEN-17, T-0141). Funções puras usadas pelo formulário do app (offline) e revalidadas na API.
 * O vendedor escolhe um endereço do ERP ou digita um SÓ para o pedido (o cadastro do cliente não muda). Nunca põe o conteúdo
 * do endereço em log nem em mensagem: o endereço pode ser de pessoa física; a validação devolve só o nome dos campos.
 */
import { cepValido, ehUf, normalizarCep, type Uf } from '@macuxi/comum/endereco';

import { resolverEnderecoEntrega } from './preco-pedido';

/** Limites da NF-e (tag entrega); o contrato `LIMITES_ENDERECO_PEDIDO` repete estes números (um teste confere). */
export const LIMITES_ENDERECO = { logradouro: 60, numero: 20, complemento: 60, bairro: 60, cidade: 60 } as const;

export type CampoDoEndereco = 'cep' | 'logradouro' | 'numero' | 'complemento' | 'bairro' | 'cidade' | 'uf';

/** O que o formulário entrega (texto livre). */
export interface EnderecoDigitado {
  logradouro: string;
  numero: string;
  complemento?: string | null;
  bairro: string;
  cidade: string;
  uf: string;
  cep: string;
}

export interface EnderecoNormalizado {
  logradouro: string;
  numero: string;
  complemento: string | null;
  bairro: string;
  cidade: string;
  uf: string;
  cep: string;
}

/** Endereço digitado já validado (UF da lista, CEP de 8 dígitos): é o que o rascunho guarda e o push leva (mesma forma do contrato). */
export interface EnderecoEditadoValido {
  logradouro: string;
  numero: string;
  complemento?: string | null;
  bairro: string;
  cidade: string;
  uf: Uf;
  cep: string;
}

/** RN-VEN-17: o digitado normalizado, ou `null` se não passa na validação (a tela não grava endereço inválido). */
export function enderecoEditadoValido(e: EnderecoDigitado): EnderecoEditadoValido | null {
  if (validarEnderecoEditado(e)) return null;
  const n = normalizarEnderecoEditado(e);
  return { ...n, uf: n.uf as Uf };
}

export interface EnderecoDoCadastro {
  id: string;
  external_id: string | null;
  tipo?: string;
  descricao?: string | null;
  logradouro: string;
  numero: string | null;
  complemento: string | null;
  bairro: string | null;
  cidade: string;
  uf: string;
  cep: string | null;
  principal: boolean;
  ativo: boolean;
}

export interface RetratoDoEndereco {
  id: string | null;
  external_id: string | null;
  tipo?: string;
  descricao: string | null;
  logradouro: string;
  numero: string | null;
  complemento: string | null;
  bairro: string | null;
  cidade: string;
  uf: string;
  cep: string | null;
  principal: boolean;
  origem: 'erp' | 'editado';
}

const limpar = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();

/** RN-VEN-17: trim, espaços repetidos viram um, UF em maiúscula, CEP só dígitos, complemento vazio vira nulo. */
export function normalizarEnderecoEditado(e: EnderecoDigitado): EnderecoNormalizado {
  const complemento = limpar(e.complemento);
  return {
    logradouro: limpar(e.logradouro),
    numero: limpar(e.numero),
    complemento: complemento === '' ? null : complemento,
    bairro: limpar(e.bairro),
    cidade: limpar(e.cidade),
    uf: limpar(e.uf).toUpperCase(),
    cep: normalizarCep(e.cep),
  };
}

export interface ErroEnderecoEditado {
  codigo: 'endereco_invalido';
  campos: CampoDoEndereco[];
}

/** RN-VEN-17: `null` = válido; senão os campos com erro (cep, logradouro, número, bairro, cidade, UF; complemento só no tamanho). */
export function validarEnderecoEditado(e: EnderecoDigitado): ErroEnderecoEditado | null {
  const n = normalizarEnderecoEditado(e);
  const campos: CampoDoEndereco[] = [];
  if (!cepValido(n.cep)) campos.push('cep');
  if (n.logradouro.length < 2 || n.logradouro.length > LIMITES_ENDERECO.logradouro) campos.push('logradouro');
  if (n.numero.length < 1 || n.numero.length > LIMITES_ENDERECO.numero) campos.push('numero');
  if ((n.complemento?.length ?? 0) > LIMITES_ENDERECO.complemento) campos.push('complemento');
  if (n.bairro.length < 2 || n.bairro.length > LIMITES_ENDERECO.bairro) campos.push('bairro');
  if (n.cidade.length < 2 || n.cidade.length > LIMITES_ENDERECO.cidade) campos.push('cidade');
  if (!ehUf(n.uf)) campos.push('uf');
  return campos.length > 0 ? { codigo: 'endereco_invalido', campos } : null;
}

const chave = (v: string | null | undefined) => limpar(v).toLocaleLowerCase('pt-BR');
const mesmoEndereco = (a: EnderecoNormalizado, b: EnderecoDoCadastro) =>
  chave(a.logradouro) === chave(b.logradouro) &&
  chave(a.numero) === chave(b.numero) &&
  chave(a.complemento) === chave(b.complemento) &&
  chave(a.bairro) === chave(b.bairro) &&
  chave(a.cidade) === chave(b.cidade) &&
  chave(a.uf) === chave(b.uf) &&
  normalizarCep(a.cep) === normalizarCep(b.cep);

const retratoDoCadastro = (e: EnderecoDoCadastro): RetratoDoEndereco => ({
  id: e.id,
  external_id: e.external_id,
  ...(e.tipo ? { tipo: e.tipo } : {}),
  descricao: e.descricao ?? null,
  logradouro: e.logradouro,
  numero: e.numero,
  complemento: e.complemento,
  bairro: e.bairro,
  cidade: e.cidade,
  uf: e.uf,
  cep: e.cep,
  principal: e.principal,
  origem: 'erp',
});

export type ResultadoEnderecoDoPedido =
  | { ok: true; endereco_id: string | null; retrato: RetratoDoEndereco | null }
  | { ok: false; codigo: 'endereco_invalido'; campos?: CampoDoEndereco[] };

/**
 * RN-VEN-17: o endereço que vai no pedido. Com `editado`, o `escolhido_id` é ignorado e nunca recusa (o pedido feito offline não
 * cai porque o endereço do ERP que serviu de base foi desativado depois); se for igual a um endereço ativo do cliente, vale o do
 * ERP (`origem: 'erp'`, sem selo à toa). Sem `editado`: o principal ou a escolha, como `resolverEnderecoEntrega`.
 */
export function enderecoDoPedido(a: {
  editado: EnderecoDigitado | null | undefined;
  escolhido_id: string | null | undefined;
  enderecos: readonly EnderecoDoCadastro[];
}): ResultadoEnderecoDoPedido {
  const ativos = a.enderecos.filter((e) => e.ativo);
  if (a.editado) {
    const erro = validarEnderecoEditado(a.editado);
    if (erro) return { ok: false, ...erro };
    const n = normalizarEnderecoEditado(a.editado);
    const igual = ativos.find((e) => mesmoEndereco(n, e));
    if (igual) return { ok: true, endereco_id: igual.id, retrato: retratoDoCadastro(igual) };
    return {
      ok: true,
      endereco_id: null,
      retrato: { id: null, external_id: null, descricao: null, ...n, principal: false, origem: 'editado' },
    };
  }
  const alvo = resolverEnderecoEntrega(a.escolhido_id, a.enderecos);
  if (!alvo.ok) return alvo;
  const e = alvo.endereco_id ? ativos.find((x) => x.id === alvo.endereco_id) : undefined;
  return { ok: true, endereco_id: alvo.endereco_id, retrato: e ? retratoDoCadastro(e) : null };
}

/**
 * RN-VEN-17 (T-0141): Transformar sem endereço no corpo herda o retrato do orçamento. Editado continua editado (volta como
 * endereço digitado); do ERP volta como a escolha do mesmo endereço. Sem retrato (orçamento sem endereço), nada a herdar.
 */
export function enderecoHerdadoDoOrcamento(retrato: Partial<RetratoDoEndereco> | null | undefined): { endereco_entrega_id?: string; endereco_entrega_editado?: EnderecoDigitado } {
  if (!retrato || !retrato.logradouro) return {};
  if (retrato.origem === 'editado') {
    return {
      endereco_entrega_editado: {
        logradouro: retrato.logradouro,
        numero: retrato.numero ?? 'S/N',
        complemento: retrato.complemento ?? null,
        bairro: retrato.bairro ?? '',
        cidade: retrato.cidade ?? '',
        uf: retrato.uf ?? '',
        cep: retrato.cep ?? '',
      },
    };
  }
  return retrato.id ? { endereco_entrega_id: retrato.id } : {};
}
