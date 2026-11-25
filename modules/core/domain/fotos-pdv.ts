/**
 * Fotos do PDV (RN-CORE-38; T-0147; ADR 0041). Funções puras, sem banco.
 * - Tipos do tenant (admin): nome de 1 a 60, único; um só tipo `fachada` (nunca sensível, nunca apagado ou inativado).
 * - Quem lê: o vendedor e o promotor abrem só a fachada (os demais tipos, sensíveis ou não, aparecem como tem/falta); os demais tipos abrem só para admin, analista, gerente e
 *   supervisor (e ainda dentro da carteira). Quem envia só adiciona: a foto nunca é trocada nem apagada (a mais recente vale).
 */

/** Fonte única dos perfis que abrem documento sensível (CNH, contrato social); o Core grava em `plataforma.arquivo.perfis_leitura`. */
export const PERFIS_DOC_SENSIVEL = ['admin', 'analista', 'gerente', 'supervisor'] as const;
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

/**
 * RN-CORE-38 (decisão de 24/11/2026, v1.0.34): a foto nunca é trocada nem apagada, só ADICIONADA; quem envia (todos os perfis da carteira) pode
 * adicionar mesmo com foto do tipo já enviada. A mais recente vale para a situação e a data (`fotoMaisRecente`).
 */
export function podeEnviarFoto(_perfil: string, _jaExiste: boolean): { ok: true } | ErroFotoPdv {
  return { ok: true };
}

/** RN-CORE-38: a foto mais recente (por `tirada_em`; empate = a última da lista); sem data, vale a ordem da lista. */
export function fotoMaisRecente<F extends { tirada_em?: string | null }>(fotos: readonly F[]): F | null {
  let melhor: F | null = null;
  for (const f of fotos) if (!melhor || (f.tirada_em ?? '') >= (melhor.tirada_em ?? '')) melhor = f;
  return melhor;
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
 * RN-CORE-38: sobrepõe às linhas do pull o que ainda está na fila (offline primeiro): cada foto da fila entra na lista na hora (a foto só é adicionada, nunca troca a anterior;
 * a mais recente vale na ficha, `fotoMaisRecente`); a ficha mostra "Na fila" até o servidor aceitar (`resumoDeFotosDoPdv`).
 * A que o pull já trouxe (mesmo `id`) não duplica; no tipo sensível o `arquivo_id` fica nulo, como no pull.
 */
export function fotosComPendentes<L extends FotoPdvLinha>(linhas: readonly L[], pendentes: readonly FotoPdvPush[], tipos: readonly Pick<TipoFotoLike, 'id' | 'fachada'>[]): FotoPdvLinha[] {
  const saida: FotoPdvLinha[] = [...linhas];
  const ids = new Set(linhas.map((l) => l.id));
  for (const p of pendentes) {
    if (ids.has(p.id)) continue;
    const tipo = tipos.find((t) => t.id === p.foto_tipo_id);
    if (!tipo) continue;
    ids.add(p.id);
    saida.push({ id: p.id, cliente_id: p.cliente_id, foto_tipo_id: p.foto_tipo_id, arquivo_id: tipo.fachada ? p.arquivo_id : null, origem: p.origem, tirada_em: p.tirada_em, deleted_at: null, updated_at: p.tirada_em, external_id: null });
  }
  return saida;
}
