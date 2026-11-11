/**
 * Fotos do PDV (RN-CORE-38; T-0147; ADR 0041). Funções puras, sem banco.
 * - Tipos do tenant (admin): nome de 1 a 60, único; um só tipo `fachada` (nunca sensível, nunca apagado ou inativado).
 * - Quem lê: o vendedor e o promotor abrem só a fachada (os demais tipos, sensíveis ou não, aparecem como tem/falta); os demais tipos abrem só para admin, analista, gerente e
 *   supervisor (e ainda dentro da carteira). Quem envia: vendedor e promotor só o que falta; admin, analista e supervisor substituem.
 */

/** Fonte única dos perfis que abrem documento sensível (CNH, contrato social); o Core grava em `plataforma.arquivo.perfis_leitura`. */
export const PERFIS_DOC_SENSIVEL = ['admin', 'analista', 'gerente', 'supervisor'] as const;
const PERFIS_SUBSTITUEM = ['admin', 'analista', 'supervisor'] as const;
export const NOME_TIPO_FOTO_MAX = 60;

export interface TipoFotoLike {
  id: string;
  nome: string;
  obrigatorio: boolean;
  sensivel: boolean;
  fachada: boolean;
  ordem: number;
  ativo: boolean;
}

export type CodigoErroFotoPdv = 'FOTO_TIPO_INVALIDO' | 'FOTO_TIPO_DUPLICADO' | 'FOTO_TIPO_FACHADA' | 'RN-CORE-38';
export interface ErroFotoPdv {
  ok: false;
  codigo: CodigoErroFotoPdv;
  mensagem: string;
}
const erro = (codigo: CodigoErroFotoPdv, mensagem: string): ErroFotoPdv => ({ ok: false, codigo, mensagem });

/**
 * RN-CORE-38: valida o tipo no BKO. `novo.id` igual ao de um existente = edição dele. Edição de tipo existente herda `fachada` do
 * cadastro (o BKO não cria nem tira a marca de fachada).
 */
export function validarTipoFoto(
  novo: { id: string; nome: string; obrigatorio: boolean; sensivel: boolean; ativo?: boolean },
  existentes: readonly TipoFotoLike[],
): { ok: true; tipo: { nome: string; obrigatorio: boolean; sensivel: boolean; ativo: boolean } } | ErroFotoPdv {
  const nome = (novo.nome ?? '').trim();
  if (nome === '' || nome.length > NOME_TIPO_FOTO_MAX) return erro('FOTO_TIPO_INVALIDO', `Informe o nome do tipo de foto, com até ${NOME_TIPO_FOTO_MAX} caracteres.`);
  if (existentes.some((t) => t.id !== novo.id && t.nome.trim().toLowerCase() === nome.toLowerCase())) {
    return erro('FOTO_TIPO_DUPLICADO', `Já existe o tipo de foto ${nome}. Use outro nome ou edite o existente.`);
  }
  const atual = existentes.find((t) => t.id === novo.id);
  const ativo = novo.ativo ?? true;
  if (atual?.fachada && novo.sensivel) return erro('FOTO_TIPO_FACHADA', 'A fachada não pode ser sensível: o vendedor precisa abri-la.');
  if (atual?.fachada && !ativo) return erro('FOTO_TIPO_FACHADA', 'O tipo Fachada não pode ser inativado. Deixe de exigi-lo, se for o caso.');
  return { ok: true, tipo: { nome, obrigatorio: novo.obrigatorio, sensivel: novo.sensivel, ativo } };
}

/** RN-CORE-38: o tipo fachada não é apagado; os demais podem (a foto já enviada sai do resumo, vai ao expurgo). */
export function decidirApagarTipoFoto(t: Pick<TipoFotoLike, 'fachada'>): { ok: true } | ErroFotoPdv {
  return t.fachada ? erro('FOTO_TIPO_FACHADA', 'O tipo Fachada não pode ser apagado.') : { ok: true };
}

/** RN-CORE-38: perfis que podem LER o arquivo do tipo; `null` (só a fachada) = regra da carteira (vendedor e promotor da carteira veem). */
export function perfisDeLeitura(t: Pick<TipoFotoLike, 'fachada'>): readonly string[] | null {
  return t.fachada ? null : PERFIS_DOC_SENSIVEL;
}

/** RN-CORE-38: este perfil pode abrir a foto deste tipo? (A carteira continua valendo, conferida à parte.) */
export function podeAbrirFoto(perfil: string, t: Pick<TipoFotoLike, 'fachada'>): boolean {
  const lista = perfisDeLeitura(t);
  return lista === null || lista.includes(perfil);
}

/** RN-CORE-38: vendedor e promotor enviam só o que falta (já existe viva do tipo = 422); admin, analista e supervisor substituem. */
export function podeEnviarFoto(perfil: string, jaExiste: boolean): { ok: true } | ErroFotoPdv {
  if (!jaExiste || (PERFIS_SUBSTITUEM as readonly string[]).includes(perfil)) return { ok: true };
  return erro('RN-CORE-38', 'Esta foto já foi enviada.');
}

export interface ResumoFotoItem {
  tipo_id: string;
  nome: string;
  obrigatorio: boolean;
  sensivel: boolean;
  fachada: boolean;
  situacao: 'tem' | 'falta';
}

/** RN-CORE-38: por tipo ativo (obrigatórios primeiro, depois `ordem` e nome), "tem" quando há foto viva do tipo. */
export function resumoFotos(
  tipos: readonly TipoFotoLike[],
  fotos: ReadonlyArray<{ foto_tipo_id: string; deleted_at?: string | null }>,
): { itens: ResumoFotoItem[]; faltam_obrigatorias: number } {
  const com = new Set(fotos.filter((f) => !f.deleted_at).map((f) => f.foto_tipo_id));
  const itens = tipos
    .filter((t) => t.ativo)
    .sort((a, b) => Number(b.obrigatorio) - Number(a.obrigatorio) || a.ordem - b.ordem || a.nome.localeCompare(b.nome, 'pt-BR'))
    .map((t) => ({ tipo_id: t.id, nome: t.nome, obrigatorio: t.obrigatorio, sensivel: t.sensivel, fachada: t.fachada, situacao: (com.has(t.id) ? 'tem' : 'falta') as 'tem' | 'falta' }));
  return { itens, faltam_obrigatorias: itens.filter((i) => i.obrigatorio && i.situacao === 'falta').length };
}

/** RN-CORE-38: fonte única da fachada: a foto viva do tipo de fachada ativo, com arquivo enviado; sem ela, `null` ("Ver foto do PDV" desligado). */
export function fachadaDoPdv<F extends { foto_tipo_id: string; arquivo_id?: string | null; deleted_at?: string | null }>(tipos: readonly TipoFotoLike[], fotos: readonly F[]): F | null {
  const fachada = tipos.find((t) => t.fachada && t.ativo);
  return (fachada && fotos.find((f) => !f.deleted_at && f.foto_tipo_id === fachada.id && f.arquivo_id)) || null;
}

export type OrigemFotoPdv = 'camera' | 'galeria';

/** Comando do push `cliente_foto` (espelha `ClienteFotoPush` dos contracts). */
export interface FotoPdvPush {
  id: string;
  cliente_id: string;
  foto_tipo_id: string;
  arquivo_id: string;
  origem: OrigemFotoPdv;
  tirada_em: string;
}

/** RN-CORE-38: monta o comando de envio no aparelho; ids gerados no aparelho, instante em UTC (escrita idempotente pelo `id`). */
export function montarFotoPdvPush(e: { id: string; cliente_id: string; foto_tipo_id: string; arquivo_id: string; origem: OrigemFotoPdv; agora: Date }): FotoPdvPush {
  return { id: e.id, cliente_id: e.cliente_id, foto_tipo_id: e.foto_tipo_id, arquivo_id: e.arquivo_id, origem: e.origem, tirada_em: e.agora.toISOString() };
}

/** RN-CORE-38 / ADR 0041: documento sensível não fica no aparelho depois do envio aceito (`apagarAoEnviar` da fila de arquivos). */
export function apagarArquivoLocalAoEnviar(t: Pick<TipoFotoLike, 'sensivel'>): boolean {
  return t.sensivel;
}

/** Linha da foto como o aparelho lê (pull `cliente_foto`) ou como sobrepõe a fila. */
export interface FotoPdvLinha {
  id: string;
  cliente_id: string;
  foto_tipo_id: string;
  arquivo_id: string | null;
  origem: OrigemFotoPdv;
  tirada_em: string | null;
  deleted_at: string | null;
  updated_at: string;
  external_id: string | null;
}

/**
 * RN-CORE-38: sobrepõe às linhas do pull o que ainda está na fila (offline primeiro): o tipo enviado entra na lista na hora; a ficha mostra "Na fila" até o servidor aceitar (`resumoDeFotosDoPdv`).
 * Pull vence (já há linha viva do tipo para o cliente); no tipo sensível o `arquivo_id` fica nulo, como no pull.
 */
export function fotosComPendentes<L extends FotoPdvLinha>(linhas: readonly L[], pendentes: readonly FotoPdvPush[], tipos: readonly Pick<TipoFotoLike, 'id' | 'fachada'>[]): FotoPdvLinha[] {
  const saida: FotoPdvLinha[] = [...linhas];
  const chave = (c: string, t: string) => `${c}|${t}`;
  const tem = new Set(linhas.filter((l) => !l.deleted_at).map((l) => chave(l.cliente_id, l.foto_tipo_id)));
  for (const p of pendentes) {
    const k = chave(p.cliente_id, p.foto_tipo_id);
    if (tem.has(k)) continue;
    const tipo = tipos.find((t) => t.id === p.foto_tipo_id);
    if (!tipo) continue;
    tem.add(k);
    saida.push({ id: p.id, cliente_id: p.cliente_id, foto_tipo_id: p.foto_tipo_id, arquivo_id: tipo.fachada ? p.arquivo_id : null, origem: p.origem, tirada_em: p.tirada_em, deleted_at: null, updated_at: p.tirada_em, external_id: null });
  }
  return saida;
}
