/**
 * Endereços de entrega do cliente vindos do ERP (RF-CORE-12, RN-VEN-17; T-0061). O Core consome
 * `integracao.cliente_endereco.atualizado@1` e aplica com esta regra pura:
 * - `criado`/`atualizado` → upsert por `external_id` (idempotente); UF em maiúsculas (2 letras), CEP em 8 dígitos (ou nulo),
 *   coordenada só dentro da faixa (senão nula); sem logradouro ou cidade o endereço é ignorado;
 * - `inativado` → `ativo = false` (nunca apaga, RN-INT-06);
 * - no máximo um `principal` vivo por cliente: marcar um novo pede para desmarcar o anterior na mesma transação. Endereço
 *   inativo ou de cobrança nunca é principal; `tipo: 'principal'` vale como principal.
 * As regras de leitura (padrão, ordem, resumo) são públicas e moram em `contracts/enderecos.ts` (o Vendedor só importa
 * `contracts`); aqui são reexportadas.
 */
export { enderecoPadrao, enderecosDeEntrega, formatarCep, listarEnderecosDoCliente, resumoDoEndereco, type EnderecoDoCliente, type EnderecoLinha } from '../contracts/enderecos';

/** Subconjunto estrutural de `integracao.cliente_endereco.atualizado@1` (`ClienteEnderecoPayload` do Hub). */
export interface EventoEnderecoAtualizado {
  external_id: string;
  acao: 'criado' | 'atualizado' | 'inativado';
  ocorrido_em: string;
  registro?:
    | {
        external_id: string;
        alterado_em: string;
        ativo?: boolean | undefined;
        cliente_external_id: string;
        tipo?: 'principal' | 'entrega' | 'cobranca' | undefined;
        descricao?: string | null | undefined;
        logradouro: string;
        numero?: string | null | undefined;
        complemento?: string | null | undefined;
        bairro?: string | null | undefined;
        cidade: string;
        uf: string;
        cep?: string | null | undefined;
        latitude?: number | null | undefined;
        longitude?: number | null | undefined;
        principal?: boolean | undefined;
      }
    | undefined;
}

export interface LinhaEnderecoErp {
  external_id: string;
  cliente_external_id: string;
  tipo: 'principal' | 'entrega' | 'cobranca';
  descricao: string | null;
  logradouro: string;
  numero: string | null;
  complemento: string | null;
  bairro: string | null;
  cidade: string;
  uf: string;
  cep: string | null;
  latitude: number | null;
  longitude: number | null;
  principal: boolean;
  ativo: boolean;
}

export type PlanoEndereco =
  | { tipo: 'upsert'; linha: LinhaEnderecoErp; desmarcar_outros_principais: boolean }
  | { tipo: 'inativar'; external_id: string }
  | { tipo: 'ignorar'; motivo: 'sem_registro' | 'endereco_incompleto' };

const nulo = (v: string | null | undefined): string | null => (v === undefined || v === null || v.trim() === '' ? null : v.trim());
const faixa = (v: number | null | undefined, min: number, max: number): number | null => (typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? v : null);

/** Decide o que fazer com o evento. Pura: o consumidor só executa o plano. */
export function planejarEnderecoDoErp(evento: EventoEnderecoAtualizado): PlanoEndereco {
  if (evento.acao === 'inativado') return { tipo: 'inativar', external_id: evento.external_id };
  const r = evento.registro;
  if (!r) return { tipo: 'ignorar', motivo: 'sem_registro' };
  const logradouro = nulo(r.logradouro);
  const cidade = nulo(r.cidade);
  const uf = r.uf.trim().toUpperCase();
  if (!logradouro || !cidade || !/^[A-Z]{2}$/.test(uf)) return { tipo: 'ignorar', motivo: 'endereco_incompleto' };
  const tipo = r.tipo ?? 'entrega';
  const ativo = r.ativo !== false;
  const principal = ativo && tipo !== 'cobranca' && (r.principal === true || tipo === 'principal');
  const cep = (r.cep ?? '').replace(/\D/g, '');
  return {
    tipo: 'upsert',
    linha: {
      external_id: evento.external_id,
      cliente_external_id: r.cliente_external_id,
      tipo,
      descricao: nulo(r.descricao),
      logradouro,
      numero: nulo(r.numero),
      complemento: nulo(r.complemento),
      bairro: nulo(r.bairro),
      cidade,
      uf,
      cep: cep.length === 8 ? cep : null,
      latitude: faixa(r.latitude, -90, 90),
      longitude: faixa(r.longitude, -180, 180),
      principal,
      ativo,
    },
    desmarcar_outros_principais: principal,
  };
}
