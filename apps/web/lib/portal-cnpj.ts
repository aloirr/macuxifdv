/**
 * CNPJ pela Receita no "Nova empresa" do portal (ADR 0048; spec docs/design/telas/portal-config-enxuto.md §11.2). Puro, para teste.
 * `POST /v1/plataforma/cnpj` (`ConsultaCnpjPedidoSchema` → `ConsultaCnpjRespostaSchema`): a busca dispara ao sair do campo com 14
 * dígitos válidos e preenche os campos da empresa. Decidido em 14/11 (dono do produto): só o CNPJ ATIVO cria empresa; inválido, não
 * encontrado, não ativo ou a Receita fora deixam o "Criar empresa" desabilitado. A API revalida no criar.
 */
import { cnpjValido, somenteDigitos } from '@macuxi/comum/documento';
import { CODIGOS_CNPJ, situacaoCriaEmpresa, type ConsultaCnpjResposta, type SituacaoCadastral } from '@macuxi/platform-sdk';

import { ehRotaAusente, ErroPortal } from './portal-api';
import { formatarTelefone } from './portal-formato';

/** Estados do campo (o `data-estado` do testID `empresa.cnpj`). */
export const ESTADOS_CNPJ = ['vazio', 'buscando', 'encontrado', 'invalido', 'nao-encontrado', 'receita-fora', 'nao-ativa'] as const;
export type EstadoCnpj = (typeof ESTADOS_CNPJ)[number];

/** Situação no masculino, minúscula ("CNPJ baixado na Receita."). */
const SITUACAO_NO_MASCULINO: Readonly<Record<SituacaoCadastral, string>> = { ativa: 'ativo', baixada: 'baixado', suspensa: 'suspenso', inapta: 'inapto', nula: 'nulo' };

export const TEXTOS_CNPJ = Object.freeze({
  buscando: 'Buscando na Receita…',
  invalido: 'CNPJ inválido. Confira os 14 dígitos.',
  naoEncontrado: 'CNPJ não encontrado na Receita.',
  receitaFora: 'A Receita não respondeu.',
  tentar: 'Tentar de novo',
  naoAtiva: (s: SituacaoCadastral) => `CNPJ ${SITUACAO_NO_MASCULINO[s]} na Receita. Use um CNPJ ativo.`,
});

/** Frase embaixo do campo (uma só; `null` = sem texto). */
export function textoDoEstadoCnpj(estado: EstadoCnpj, situacao: SituacaoCadastral | null): string | null {
  switch (estado) {
    case 'buscando':
      return TEXTOS_CNPJ.buscando;
    case 'invalido':
      return TEXTOS_CNPJ.invalido;
    case 'nao-encontrado':
      return TEXTOS_CNPJ.naoEncontrado;
    case 'receita-fora':
      return TEXTOS_CNPJ.receitaFora;
    case 'nao-ativa':
      return situacao ? TEXTOS_CNPJ.naoAtiva(situacao) : TEXTOS_CNPJ.naoEncontrado;
    default:
      return null;
  }
}

/** Antes de chamar a Receita: vazio, inválido (menos de 14 dígitos ou dígito verificador errado) ou pronto para buscar. */
export function estadoLocalDoCnpj(texto: string): 'vazio' | 'invalido' | 'pronto' {
  const d = somenteDigitos(texto);
  if (d === '') return 'vazio';
  return d.length === 14 && cnpjValido(d) ? 'pronto' : 'invalido';
}

/** Resposta da consulta → estado do campo (só ATIVA fica "encontrado"). */
export const estadoDaConsulta = (r: Pick<ConsultaCnpjResposta, 'situacao_cadastral'>): EstadoCnpj => (situacaoCriaEmpresa(r.situacao_cadastral) ? 'encontrado' : 'nao-ativa');

/**
 * Erro da consulta ou do criar → estado do campo; `null` = não é do CNPJ. A rota ainda ausente neste servidor (#243 fora) conta
 * como Receita fora: não dá para conferir, então não cria.
 */
export function estadoDoErroCnpj(e: unknown): EstadoCnpj | null {
  if (!(e instanceof ErroPortal)) return null;
  if (e.codigo === CODIGOS_CNPJ.invalido) return 'invalido';
  if (e.codigo === CODIGOS_CNPJ.naoEncontrado) return 'nao-encontrado';
  if (e.codigo === CODIGOS_CNPJ.inativo) return 'nao-ativa';
  if (e.codigo === CODIGOS_CNPJ.fonteFora || e.codigo === CODIGOS_CNPJ.limite || ehRotaAusente(e)) return 'receita-fora';
  return null;
}

/** Só o CNPJ encontrado e ativo libera o "Criar empresa". */
export const cnpjLiberaCriar = (estado: EstadoCnpj): boolean => estado === 'encontrado';

/** Campos da empresa que a consulta preenche (todos editáveis, menos o CNAE). */
export interface CamposDaReceita {
  razao_social: string;
  nome_fantasia: string;
  endereco: string;
  municipio: string;
  uf: string;
  telefone: string;
  email: string;
}

/** "Rua Fictícia, 100 · Bairro Teste · 69000-000" (só o que veio). */
export function enderecoDaConsulta(r: Pick<ConsultaCnpjResposta, 'endereco' | 'cep'>): string {
  const rua = [r.endereco.logradouro, r.endereco.numero].filter(Boolean).join(', ');
  const ruaCompleta = [rua, r.endereco.complemento].filter(Boolean).join(' ');
  const cep = r.cep ? `${r.cep.slice(0, 5)}-${r.cep.slice(5)}` : null;
  return [ruaCompleta, r.endereco.bairro, cep].filter(Boolean).join(' · ');
}

/** "4639-7/01 · Comércio atacadista de alimentos" ou vazio. */
export function cnaeDaConsulta(r: Pick<ConsultaCnpjResposta, 'cnae_principal'>): string {
  const c = r.cnae_principal;
  if (!c) return '';
  return `${c.codigo.slice(0, 4)}-${c.codigo.slice(4, 5)}/${c.codigo.slice(5)} · ${c.descricao}`;
}

export function camposDaConsulta(r: ConsultaCnpjResposta): CamposDaReceita {
  return {
    razao_social: r.razao_social,
    nome_fantasia: r.nome_fantasia ?? '',
    endereco: enderecoDaConsulta(r),
    municipio: r.municipio ?? '',
    uf: r.uf ?? '',
    telefone: formatarTelefone(r.telefone),
    email: r.email ?? '',
  };
}

/** Junta a consulta aos campos: o que a pessoa editou à mão não é sobrescrito (spec §11.2). */
export function preencherCampos(atuais: CamposDaReceita, daReceita: CamposDaReceita, editados: ReadonlySet<keyof CamposDaReceita>): CamposDaReceita {
  const r = { ...atuais };
  for (const k of Object.keys(daReceita) as (keyof CamposDaReceita)[]) if (!editados.has(k) || atuais[k].trim() === '') r[k] = daReceita[k];
  return r;
}
