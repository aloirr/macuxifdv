/**
 * Endereço de entrega no Novo pedido (RN-VEN-17, T-0141 C; spec docs/design/pedido-v3.md §C). Funções puras, sem React: o cartão da
 * aba Entrega, a folha de endereços e o formulário "Endereço deste pedido" só ligam estas peças. Tudo do aparelho (vale offline: o
 * formulário é preenchido à mão, sem consulta de CEP). O endereço digitado vale só neste pedido e nunca vai para log.
 */
import { formatarCep, normalizarCep } from '@macuxi/comum/endereco';

import {
  enderecoDoPedido,
  enderecoEditadoValido,
  normalizarEnderecoEditado,
  validarEnderecoEditado,
  type CampoDoEndereco,
  type EnderecoDoCadastro,
  type EnderecoEditadoValido,
} from '../../domain/endereco-pedido';
import type { EnderecoDaTela } from './novo-pedido';

export const TEXTOS_ENDERECO = {
  rotuloSecao: 'Endereço de entrega',
  doCadastro: 'Endereço do cadastro do cliente',
  alterar: 'Alterar',
  editar: 'Editar',
  principal: 'Principal',
  entrega: 'Entrega',
  editadoNestePedido: 'Editado neste pedido',
  tituloFolha: 'Endereço de entrega',
  editarNestePedido: 'Editar endereço deste pedido',
  voltar: 'Voltar',
  tituloFormulario: 'Endereço deste pedido',
  aviso: 'Só neste pedido. O cadastro do cliente não muda.',
  usar: 'Usar neste pedido',
  obrigatorio: 'Obrigatório',
  cepIncompleto: 'CEP com 8 números',
  minimoDuasLetras: 'Use pelo menos 2 letras',
  descartar: { titulo: 'Descartar a edição?', continuar: 'Continuar editando', confirmar: 'Descartar' },
} as const;

/** O que o cartão e o texto precisam de um endereço (cadastro, retrato do pedido ou digitado). */
export interface EnderecoParaTexto {
  logradouro: string;
  numero?: string | null;
  complemento?: string | null;
  bairro?: string | null;
  cidade: string;
  uf: string;
  cep?: string | null;
}

/** O pedaço do rascunho que o endereço usa. */
export interface RascunhoDoEndereco {
  endereco_entrega_id?: string | null;
  endereco_entrega_editado?: EnderecoEditadoValido | null;
}

const preenchido = (x: string | null | undefined): x is string => x != null && x.trim() !== '';

/** Duas linhas do cartão: "Rua Pará, 137, fundos · São Geraldo" e "Manaus/AM · 69053-000". */
export function linhasDoEndereco(e: EnderecoParaTexto): string[] {
  const rua = [e.logradouro, e.numero, e.complemento].filter(preenchido).join(', ');
  const local = e.cidade ? `${e.cidade}${e.uf ? `/${e.uf}` : ''}` : '';
  const cep = preenchido(e.cep) ? formatarCep(e.cep) : '';
  return [[rua, e.bairro].filter(preenchido).join(' · '), [local, cep].filter(preenchido).join(' · ')].filter((x) => x !== '');
}

export interface CartaoDoEndereco {
  selo: { texto: string; tom: 'neutro' | 'destaque' } | null;
  linhas: string[];
  /** só quando não há endereço algum */
  texto?: string;
  acao: { rotulo: 'Alterar' | 'Editar'; abre: 'folha' | 'formulario' };
}

const ehPrincipal = (e: EnderecoDaTela) => e.principal || e.tipo === 'principal';

/** O endereço do ERP que vale no rascunho: o escolhido ou o principal (ausente = principal). */
export function enderecoDoErpEscolhido(r: RascunhoDoEndereco, lista: readonly EnderecoDaTela[]): EnderecoDaTela | null {
  return r.endereco_entrega_id ? (lista.find((e) => e.id === r.endereco_entrega_id) ?? null) : (lista.find(ehPrincipal) ?? null);
}

/** O endereço que vai no pedido (texto), editado ou do ERP; `null` = nenhum no aparelho (vale o do cadastro). */
export function enderecoDoRascunho(r: RascunhoDoEndereco, lista: readonly EnderecoDaTela[]): EnderecoParaTexto | null {
  return r.endereco_entrega_editado ?? enderecoDoErpEscolhido(r, lista);
}

/** C.1: selo de origem, duas linhas e a ação (Alterar com 2 ou mais endereços do ERP, Editar com 1 ou nenhum). */
export function cartaoDoEndereco(a: { rascunho: RascunhoDoEndereco; lista: readonly EnderecoDaTela[] }): CartaoDoEndereco {
  const acao: CartaoDoEndereco['acao'] = a.lista.length >= 2 ? { rotulo: TEXTOS_ENDERECO.alterar, abre: 'folha' } : { rotulo: TEXTOS_ENDERECO.editar, abre: 'formulario' };
  if (a.rascunho.endereco_entrega_editado) {
    return { selo: { texto: TEXTOS_ENDERECO.editadoNestePedido, tom: 'destaque' }, linhas: linhasDoEndereco(a.rascunho.endereco_entrega_editado), acao };
  }
  const e = enderecoDoErpEscolhido(a.rascunho, a.lista);
  if (!e) return { selo: null, linhas: [], texto: TEXTOS_ENDERECO.doCadastro, acao };
  const nome = preenchido(e.descricao) ? e.descricao : ehPrincipal(e) ? TEXTOS_ENDERECO.principal : TEXTOS_ENDERECO.entrega;
  return { selo: { texto: nome, tom: 'neutro' }, linhas: linhasDoEndereco(e), acao };
}

export interface OpcaoDeEndereco {
  /** id do endereço do ERP, ou 'editado' */
  id: string;
  titulo: string;
  subtitulo: string;
  marcada: boolean;
}

/** C.2: um item por endereço do ERP e, se houver, o editado; o marcado é o que vale no pedido. */
export function opcoesDaFolhaDeEnderecos(a: { rascunho: RascunhoDoEndereco; lista: readonly EnderecoDaTela[] }): OpcaoDeEndereco[] {
  const editado = a.rascunho.endereco_entrega_editado;
  const escolhido = editado ? null : enderecoDoErpEscolhido(a.rascunho, a.lista);
  const opcoes = a.lista.map((e) => ({
    id: e.id,
    titulo: preenchido(e.descricao) ? e.descricao : ehPrincipal(e) ? TEXTOS_ENDERECO.principal : TEXTOS_ENDERECO.entrega,
    subtitulo: linhasDoEndereco(e).join(' · '),
    marcada: escolhido?.id === e.id,
  }));
  if (editado) opcoes.push({ id: 'editado', titulo: TEXTOS_ENDERECO.editadoNestePedido, subtitulo: linhasDoEndereco(editado).join(' · '), marcada: true });
  return opcoes;
}

/** C.2: escolher um endereço do ERP desfaz a edição; o principal limpa o id (ausente = principal). */
export function rascunhoComEnderecoEscolhido<R extends RascunhoDoEndereco>(r: R, e: EnderecoDaTela, principalId: string | null): R {
  return { ...r, endereco_entrega_id: e.id === principalId ? null : e.id, endereco_entrega_editado: null };
}

// ---------- formulário ----------
export interface ValoresDoFormulario {
  cep: string;
  logradouro: string;
  numero: string;
  complemento: string;
  bairro: string;
  cidade: string;
  uf: string;
}

/** "69053000" → "69053-000" enquanto digita; só dígitos, no máximo 8. */
export function mascaraDoCep(texto: string): string {
  const d = normalizarCep(texto).slice(0, 8);
  return d.length > 5 ? `${d.slice(0, 5)}-${d.slice(5)}` : d;
}

/** C.3: o formulário abre preenchido com o endereço que vale hoje (a base da edição); vazio quando não há. */
export function formularioDoEndereco(e: EnderecoParaTexto | null): ValoresDoFormulario {
  return {
    cep: mascaraDoCep(e?.cep ?? ''),
    logradouro: e?.logradouro ?? '',
    numero: e?.numero ?? '',
    complemento: e?.complemento ?? '',
    bairro: e?.bairro ?? '',
    cidade: e?.cidade ?? '',
    uf: e?.uf ?? '',
  };
}

/** Algo foi digitado diferente do que abriu (pergunta "Descartar a edição?"). */
export function formularioAlterado(atual: ValoresDoFormulario, inicial: ValoresDoFormulario): boolean {
  return (Object.keys(atual) as Array<keyof ValoresDoFormulario>).some((k) => atual[k].trim() !== inicial[k].trim());
}

/** C.3: o texto de erro de cada campo; vazio = "Obrigatório", CEP incompleto = "CEP com 8 números", 1 letra = "Use pelo menos 2 letras". */
export function errosDoFormulario(v: ValoresDoFormulario): Partial<Record<CampoDoEndereco, string>> {
  const erro = validarEnderecoEditado(v);
  const out: Partial<Record<CampoDoEndereco, string>> = {};
  if (!erro) return out;
  const n = normalizarEnderecoEditado(v);
  for (const campo of erro.campos) {
    const valor = String(n[campo] ?? '');
    if (valor === '') out[campo] = TEXTOS_ENDERECO.obrigatorio;
    else if (campo === 'cep') out[campo] = TEXTOS_ENDERECO.cepIncompleto;
    else if (campo === 'logradouro' || campo === 'bairro' || campo === 'cidade') out[campo] = TEXTOS_ENDERECO.minimoDuasLetras;
    else out[campo] = TEXTOS_ENDERECO.obrigatorio;
  }
  return out;
}

const doCadastro = (e: EnderecoDaTela): EnderecoDoCadastro => ({ ...e, external_id: null });

/**
 * C.3 "Usar neste pedido": grava no rascunho. A mesma regra da API (`enderecoDoPedido`): endereço igual a um do ERP volta como o
 * do ERP (sem o selo "Editado neste pedido" à toa); diferente vira o digitado, sem id. Valores inválidos não gravam nada.
 */
export function rascunhoComEnderecoEditado<R extends RascunhoDoEndereco>(r: R, v: ValoresDoFormulario, lista: readonly EnderecoDaTela[]): R {
  const res = enderecoDoPedido({ editado: v, escolhido_id: null, enderecos: lista.map(doCadastro) });
  if (!res.ok || !res.retrato) return r;
  if (res.retrato.origem === 'erp') {
    const principal = lista.find(ehPrincipal)?.id ?? null;
    return { ...r, endereco_entrega_id: res.endereco_id === principal ? null : res.endereco_id, endereco_entrega_editado: null };
  }
  const valido = enderecoEditadoValido(v);
  return valido ? { ...r, endereco_entrega_id: null, endereco_entrega_editado: valido } : r;
}
