/**
 * Pré-cadastro de cliente no aparelho (v1.0.28; correção na v1.0.30; RN-CORE-78 e RN-CORE-79; ADR 0069;
 * docs/design/telas/campo-cliente-pre-cadastro.md). Puro (sem react-native): monta o payload do push, enfileira no sync de forma
 * idempotente (o UUID nasce no aparelho; a correção usa o MESMO id, com `revisao_base`) e sobrepõe a fila às linhas do pull, para o
 * cliente aparecer na hora, offline.
 */
import { somenteDigitos } from '@macuxi/comum';
import { definirEntidadeSync, type MotorSync } from '@macuxi/platform-sdk';
import { PreCadastroClienteSchema, type CampoCadastroCliente, type ClienteSync, type PreCadastroCliente } from '../../contracts';
import { camposExigidosDasLinhas, MOTIVO_ENVIO_FALHOU, obrigatoriosDoPreCadastro, validarPreCadastro } from '../../domain';
import { dadosDoFormulario, errosDaRecusaPorColuna, valoresDosDados, type ColunaFormulario, type ValoresPreCadastro } from './pre-cadastro-formulario';

export { COLUNAS_FORMULARIO, type ValoresPreCadastro } from './pre-cadastro-formulario';

/** Entidade de push do pré-cadastro (a API do Core a recebe com este nome). */
export const ENTIDADE_PRE_CADASTRO = 'cliente_pre_cadastro';

export const entidadePreCadastro = definirEntidadeSync({
  nome: ENTIDADE_PRE_CADASTRO,
  modulo: 'core',
  direcao: 'push',
  conflito: 'app_edita_ate_status',
  schema: PreCadastroClienteSchema,
});

/** Obrigatórios do pré-cadastro lidos do parâmetro sincronizado (`motor.linhas('parametro')`), offline: a lista única da RN-CORE-16 (RN-CORE-79). */
export function obrigatoriosDasLinhas(linhas: Parameters<typeof camposExigidosDasLinhas>[0]): CampoCadastroCliente[] {
  return obrigatoriosDoPreCadastro(camposExigidosDasLinhas(linhas));
}

/** O que a correção leva além do formulário: a revisão que o vendedor viu e a localização já gravada (fora do formulário). */
export interface BaseDaCorrecao {
  revisao_base: number | null;
  latitude: number | null;
  longitude: number | null;
}

/** Monta e valida o payload com o schema do contrato (o documento vai só com dígitos); sem sucesso, a mensagem do schema por campo. */
export function montarPreCadastro(id: string, valores: ValoresPreCadastro, base?: BaseDaCorrecao | null): { ok: true; payload: PreCadastroCliente } | { ok: false; erros: Record<string, string> } {
  const r = PreCadastroClienteSchema.safeParse({
    id,
    origem: 'campo',
    ...dadosDoFormulario(valores),
    ...(base?.latitude != null && base.longitude != null ? { latitude: base.latitude, longitude: base.longitude } : {}),
    ...(base?.revisao_base != null ? { revisao_base: base.revisao_base } : {}),
  });
  if (r.success) return { ok: true, payload: r.data };
  const erros: Record<string, string> = {};
  for (const i of r.error.issues) erros[String(i.path[0] ?? 'documento')] ??= i.message;
  return { ok: false, erros };
}

export type ResultadoSalvarPreCadastro = { ok: true; id: string } | { ok: false; erros: Record<string, string> };

/**
 * Valida (domain + schema) e enfileira. Mesmo `id` = mesmo item: a correção substitui o item da fila (inclusive o que falhou), sem
 * duplicar; a do recusado pelo ERP entra na fila com o id do cliente e a `revisao_base` (RN-CORE-78).
 */
export async function salvarPreCadastro(
  motor: Pick<MotorSync, 'enfileirar' | 'alterar' | 'pendentes' | 'enviar'>,
  entrada: { id: string; valores: ValoresPreCadastro; obrigatorios: readonly CampoCadastroCliente[]; online: boolean; base?: BaseDaCorrecao | null },
): Promise<ResultadoSalvarPreCadastro> {
  const v = validarPreCadastro(entrada.valores, entrada.obrigatorios);
  if (!v.ok) return { ok: false, erros: v.erros };
  const m = montarPreCadastro(entrada.id, entrada.valores, entrada.base);
  if (!m.ok) return m;
  const { payload } = m;
  const nome = payload.nome_fantasia?.trim() || payload.razao_social;
  const rotulo = `Novo cliente · ${nome}`;
  // o `enfileirar` ignora id que já está na fila: a correção de um item parado (falhou no 422) o ALTERA, que o devolve a pendente
  if (motor.pendentes(ENTIDADE_PRE_CADASTRO).some((i) => i.id === payload.id)) await motor.alterar(payload.id, { payload, rotulo });
  else await motor.enfileirar({ id: payload.id, entidade: ENTIDADE_PRE_CADASTRO, payload, rotulo });
  // o envio sai em segundo plano: a tela fecha na hora e a fila reenvia sozinha quando houver sinal
  if (entrada.online) void motor.enviar().catch(() => undefined);
  return { ok: true, id: payload.id };
}

/** Item da fila como o `motor.sobreposicao` entrega (só o que esta função lê). */
export interface ItemPreCadastroPendente {
  payload: unknown;
  situacao?: string;
  ultimo_erro?: string;
}

/**
 * Sobrepõe a fila às linhas do pull: o pré-cadastro novo entra como cliente "pendente" sem código; a correção do recusado (mesmo id)
 * substitui a linha do pull (status volta a pendente, motivo e erros somem). A linha do pull volta a valer quando o item sai da fila.
 */
export function sobreporPreCadastros(clientes: readonly ClienteSync[], itens: readonly ItemPreCadastroPendente[], agora: string): ClienteSync[] {
  const novos = new Map<string, ClienteSync>();
  for (const i of itens) {
    const p = PreCadastroClienteSchema.safeParse(i.payload);
    if (!p.success) continue;
    const d = p.data;
    const antigo = clientes.find((c) => c.id === d.id);
    // item parado na fila (falhou: 422, 409, CONFLITO; ou módulo inativo): não chegou ao ERP, então não é "Aguardando ERP" nem
    // "Recusado pelo ERP"; vira "Não enviado" (pendente com o motivo), com a ação "Corrigir e reenviar"
    const parou = i.situacao === 'falhou' || i.situacao === 'modulo_inativo';
    novos.set(d.id, {
      id: d.id,
      updated_at: agora,
      deleted_at: null,
      external_id: null,
      documento: d.documento,
      razao_social: d.razao_social,
      nome_fantasia: d.nome_fantasia ?? null,
      segmento: antigo?.segmento ?? null,
      telefone: d.telefone ?? null,
      email: d.email ?? null,
      logradouro: d.logradouro ?? null,
      numero: d.numero ?? null,
      bairro: d.bairro ?? null,
      cidade: d.cidade ?? null,
      uf: d.uf ?? null,
      cep: d.cep ?? null,
      latitude: d.latitude ?? null,
      longitude: d.longitude ?? null,
      ativo: true,
      inscricao_estadual: d.inscricao_estadual ?? null,
      status_cadastro: 'pendente',
      motivo_recusa: parou ? i.ultimo_erro?.trim() || MOTIVO_ENVIO_FALHOU : null,
      revisao_cadastro: antigo?.revisao_cadastro ?? null,
      erros_recusa: null,
      // o Código FDV é do servidor (só leitura): a correção na fila mantém o que o pull trouxe
      codigo_fdv: antigo?.codigo_fdv ?? null,
    });
  }
  if (novos.size === 0) return [...clientes];
  return [...novos.values(), ...clientes.filter((c) => !novos.has(c.id))];
}

const numeroOuNulo = (v: string | number | null | undefined): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};

/** O que o formulário de correção abre: valores, a base do reenvio e os erros por campo da recusa (RN-CORE-78). */
export interface CorrecaoAberta {
  valores: ValoresPreCadastro;
  base: BaseDaCorrecao;
  erros: Partial<Record<ColunaFormulario, string>>;
}

/**
 * RN-CORE-78 (ADR 0069): abre a correção do cliente `id`. Recusado pelo ERP (pull) = os dados da última revisão, a `revisao_base` dela
 * e os erros por campo. "Não enviado" (item parado na fila) = o payload da fila, com a revisão que ele já levava; se o servidor tem
 * revisão mais nova (o escritório corrigiu antes), vale a do servidor. Nulo se o cliente não está no aparelho.
 */
export function correcaoDoCliente(clientes: readonly ClienteSync[], itens: readonly ItemPreCadastroPendente[], id: string): CorrecaoAberta | null {
  const doPull = clientes.find((c) => c.id === id);
  const naFila = itens.map((i) => PreCadastroClienteSchema.safeParse(i.payload)).find((r) => r.success && r.data.id === id);
  const fila = naFila?.success ? naFila.data : undefined;
  const revisaoDoServidor = doPull?.revisao_cadastro ?? (doPull?.status_cadastro === 'recusado' ? 1 : null);
  const servidorMaisNovo = fila?.revisao_base != null && revisaoDoServidor !== null && revisaoDoServidor > fila.revisao_base;
  if (fila && !servidorMaisNovo) {
    return { valores: valoresDosDados(fila), base: { revisao_base: fila.revisao_base ?? null, latitude: fila.latitude ?? null, longitude: fila.longitude ?? null }, erros: {} };
  }
  if (!doPull) return null;
  return {
    valores: valoresDosDados(doPull),
    base: { revisao_base: revisaoDoServidor, latitude: numeroOuNulo(doPull.latitude), longitude: numeroOuNulo(doPull.longitude) },
    erros: doPull.status_cadastro === 'recusado' ? errosDaRecusaPorColuna(doPull.erros_recusa) : {},
  };
}

/** "Já é cliente": outro cliente da carteira com o mesmo CNPJ/CPF (comparação só pelos dígitos). */
export function clienteComDocumento(clientes: readonly ClienteSync[], documento: string, exceto?: string): ClienteSync | null {
  const d = somenteDigitos(documento);
  if (d.length !== 11 && d.length !== 14) return null;
  return clientes.find((c) => c.deleted_at === null && c.id !== exceto && somenteDigitos(c.documento) === d) ?? null;
}

/** Aviso "Cliente salvo" que a lista mostra ao voltar do formulário (a tela do formulário já fechou): uso único. */
let clienteSalvoPendente = false;
export const avisarClienteSalvo = (): void => {
  clienteSalvoPendente = true;
};
export function consumirAvisoClienteSalvo(): boolean {
  const v = clienteSalvoPendente;
  clienteSalvoPendente = false;
  return v;
}
