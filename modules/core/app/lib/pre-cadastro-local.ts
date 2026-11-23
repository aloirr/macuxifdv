/**
 * Pré-cadastro de cliente no aparelho (v1.0.28; RN-CORE-78 e RN-CORE-79; docs/design/telas/campo-cliente-pre-cadastro.md).
 * Puro (sem react-native): monta o payload do push, enfileira no sync de forma idempotente (o UUID nasce no aparelho e o
 * reenvio da correção usa o mesmo id) e sobrepõe a fila às linhas do pull, para o cliente novo aparecer na hora, offline.
 */
import { somenteDigitos } from '@macuxi/comum';
import { definirEntidadeSync, type MotorSync } from '@macuxi/platform-sdk';
import {
  obrigatoriosPreCadastroDasLinhas,
  PreCadastroClienteSchema,
  type CampoPreCadastro,
  type ClienteSync,
  type PreCadastroCliente,
} from '../../contracts';
import { camposObrigatoriosPreCadastro, validarPreCadastro } from '../../domain';

/** Entidade de push do pré-cadastro (a API do pré-cadastro, da sessão A, a registra com este nome). */
export const ENTIDADE_PRE_CADASTRO = 'cliente_pre_cadastro';

export const entidadePreCadastro = definirEntidadeSync({
  nome: ENTIDADE_PRE_CADASTRO,
  modulo: 'core',
  direcao: 'push',
  conflito: 'app_edita_ate_status',
  schema: PreCadastroClienteSchema,
});

/** Texto digitado em cada coluna do formulário (a máscara é só da tela; o valor vai sem pontuação onde o contrato pede). */
export type ValoresPreCadastro = Partial<Record<Exclude<keyof PreCadastroCliente, 'id' | 'origem' | 'latitude' | 'longitude' | 'filial_id'>, string>>;

export const COLUNAS_FORMULARIO = ['documento', 'razao_social', 'nome_fantasia', 'telefone', 'email', 'cep', 'logradouro', 'numero', 'bairro', 'cidade', 'uf', 'inscricao_estadual'] as const;

/** Obrigatórios efetivos lidos do parâmetro sincronizado (`motor.linhas('parametro')`), offline (RN-CORE-79). */
export function obrigatoriosDasLinhas(linhas: Parameters<typeof obrigatoriosPreCadastroDasLinhas>[0]): CampoPreCadastro[] {
  return camposObrigatoriosPreCadastro(obrigatoriosPreCadastroDasLinhas(linhas));
}

const ouNulo = (v: string | undefined): string | null => (v && v.trim() !== '' ? v.trim() : null);
const somenteDigitosOuNulo = (v: string | undefined): string | null => (ouNulo(v) === null ? null : somenteDigitos(v));

/** Monta e valida o payload com o schema do contrato (o documento vai só com dígitos); sem sucesso, a mensagem do schema por campo. */
export function montarPreCadastro(id: string, valores: ValoresPreCadastro): { ok: true; payload: PreCadastroCliente } | { ok: false; erros: Record<string, string> } {
  const r = PreCadastroClienteSchema.safeParse({
    id,
    origem: 'campo',
    razao_social: valores.razao_social ?? '',
    nome_fantasia: ouNulo(valores.nome_fantasia),
    documento: valores.documento ?? '',
    inscricao_estadual: ouNulo(valores.inscricao_estadual),
    telefone: somenteDigitosOuNulo(valores.telefone),
    email: ouNulo(valores.email),
    logradouro: ouNulo(valores.logradouro),
    numero: ouNulo(valores.numero),
    bairro: ouNulo(valores.bairro),
    cidade: ouNulo(valores.cidade),
    uf: ouNulo(valores.uf),
    cep: somenteDigitosOuNulo(valores.cep),
  });
  if (r.success) return { ok: true, payload: r.data };
  const erros: Record<string, string> = {};
  for (const i of r.error.issues) erros[String(i.path[0] ?? 'documento')] ??= i.message;
  return { ok: false, erros };
}

export type ResultadoSalvarPreCadastro = { ok: true; id: string } | { ok: false; erros: Record<string, string> };

/** Valida (domain + schema) e enfileira. Mesmo `id` = mesmo item: o reenvio da correção substitui o item da fila (inclusive o que falhou), sem duplicar. */
export async function salvarPreCadastro(
  motor: Pick<MotorSync, 'enfileirar' | 'alterar' | 'pendentes' | 'enviar'>,
  entrada: { id: string; valores: ValoresPreCadastro; obrigatorios: readonly CampoPreCadastro[]; online: boolean },
): Promise<ResultadoSalvarPreCadastro> {
  const v = validarPreCadastro(entrada.valores, entrada.obrigatorios);
  if (!v.ok) return { ok: false, erros: v.erros };
  const m = montarPreCadastro(entrada.id, entrada.valores);
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

/** Texto da correção quando o servidor recusou o envio sem dizer o motivo. */
export const MOTIVO_ENVIO_FALHOU = 'Não foi possível enviar o cadastro.';

/**
 * Sobrepõe a fila às linhas do pull: o pré-cadastro novo entra como cliente "pendente" sem código; o reenviado substitui a
 * linha recusada pelo ERP (status volta a pendente e o motivo some). A linha do pull volta a valer quando o item sai da fila.
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
    });
  }
  if (novos.size === 0) return [...clientes];
  return [...novos.values(), ...clientes.filter((c) => !novos.has(c.id))];
}

/** Valores do formulário a partir de um cliente (a correção abre o formulário preenchido). */
export function valoresDoCliente(c: ClienteSync): ValoresPreCadastro {
  const t = (v: string | null | undefined) => v ?? '';
  return {
    documento: t(c.documento),
    razao_social: c.razao_social,
    nome_fantasia: t(c.nome_fantasia),
    telefone: t(c.telefone),
    email: t(c.email),
    cep: t(c.cep),
    logradouro: t(c.logradouro),
    numero: t(c.numero),
    bairro: t(c.bairro),
    cidade: t(c.cidade),
    uf: t(c.uf),
    inscricao_estadual: t(c.inscricao_estadual),
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
