/**
 * Cliente vindo do ERP (`integracao.cliente.atualizado@1`) para `core.cliente` (T-0060; RN-CORE-16/17, RN-INT-05/06).
 * Regra pura: o consumidor da API só executa o plano. O cadastro mínimo é calculado aqui (`cadastroCompleto`) e gravado em
 * `cadastro_incompleto`/`cadastro_campos_faltantes`; a linha automática de Observações é montada na exibição, nunca gravada.
 */
import { cadastroCompleto, type CampoCadastroCliente } from './cadastro';

/** Subconjunto estrutural do evento e do `ClientePayload` do Hub (o Core não importa tipo interno do Integracao). */
export interface EventoClienteAtualizado {
  external_id: string;
  acao: 'criado' | 'atualizado' | 'inativado';
  ocorrido_em: string;
  registro?:
    | {
        external_id: string;
        alterado_em: string;
        ativo?: boolean;
        razao_social: string;
        nome_fantasia?: string | null;
        documento?: string | null;
        inscricao_estadual?: string | null;
        observacao?: string | null;
        telefone?: string | null;
        email?: string | null;
        latitude?: number | null;
        longitude?: number | null;
        endereco?: {
          logradouro?: string | null;
          numero?: string | null;
          complemento?: string | null;
          bairro?: string | null;
          cidade?: string | null;
          uf?: string | null;
          cep?: string | null;
        } | null;
      }
    | undefined;
}

export interface LinhaClienteErp {
  external_id: string;
  razao_social: string;
  nome_fantasia: string | null;
  /** Só dígitos (11 ou 14); qualquer outra coisa vira `null` (a coluna tem check). */
  documento: string | null;
  inscricao_estadual: string | null;
  observacao: string | null;
  telefone: string | null;
  email: string | null;
  logradouro: string | null;
  numero: string | null;
  bairro: string | null;
  cidade: string | null;
  uf: string | null;
  cep: string | null;
  latitude: number | null;
  longitude: number | null;
  ativo: boolean;
  cadastro_incompleto: boolean;
  cadastro_campos_faltantes: CampoCadastroCliente[];
  alterado_em: string;
}

export type PlanoCliente =
  | { tipo: 'upsert'; linha: LinhaClienteErp }
  | { tipo: 'inativar'; external_id: string; alterado_em: string }
  | { tipo: 'ignorar'; motivo: 'sem_registro' | 'mais_antigo_que_o_aplicado' };

const nulo = (v: string | null | undefined): string | null => (v === undefined || v === null || v.trim() === '' ? null : v.trim());

export function planejarClienteDoErp(evento: EventoClienteAtualizado, exigidos: readonly CampoCadastroCliente[], aplicadoAlteradoEm: string | null = null): PlanoCliente {
  if (evento.acao === 'inativado') return { tipo: 'inativar', external_id: evento.external_id, alterado_em: evento.ocorrido_em };
  const r = evento.registro;
  if (!r) return { tipo: 'ignorar', motivo: 'sem_registro' };
  if (aplicadoAlteradoEm && Date.parse(r.alterado_em) < Date.parse(aplicadoAlteradoEm)) return { tipo: 'ignorar', motivo: 'mais_antigo_que_o_aplicado' };
  const e = r.endereco ?? {};
  const digitosDoc = (r.documento ?? '').replace(/\D/g, '');
  const uf = nulo(e.uf)?.toUpperCase() ?? null;
  const cepDigitos = (e.cep ?? '').replace(/\D/g, '');
  const linha = {
    external_id: evento.external_id,
    razao_social: r.razao_social.trim(),
    nome_fantasia: nulo(r.nome_fantasia),
    documento: digitosDoc.length === 11 || digitosDoc.length === 14 ? digitosDoc : null,
    inscricao_estadual: nulo(r.inscricao_estadual),
    observacao: nulo(r.observacao) === null ? null : (r.observacao as string),
    telefone: nulo(r.telefone),
    email: nulo(r.email),
    logradouro: nulo(e.logradouro),
    numero: nulo(e.numero),
    bairro: nulo(e.bairro),
    cidade: nulo(e.cidade),
    uf: uf !== null && /^[A-Z]{2}$/.test(uf) ? uf : null,
    // CEP que não tem 8 dígitos fica nulo: a coluna só guarda dígitos e o cadastro acusa a falta
    cep: cepDigitos.length === 8 ? cepDigitos : null,
    latitude: r.latitude ?? null,
    longitude: r.longitude ?? null,
    ativo: r.ativo !== false,
    alterado_em: r.alterado_em,
  };
  const { completo, campos_faltantes } = cadastroCompleto({ ...linha, complemento: nulo(e.complemento) }, exigidos);
  return { tipo: 'upsert', linha: { ...linha, cadastro_incompleto: !completo, cadastro_campos_faltantes: campos_faltantes } };
}
