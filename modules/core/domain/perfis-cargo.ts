/**
 * Perfis sem base, pelo cargo (ADR 0073 §4; RN-CORE-35, RN-CORE-34, RN-CORE-33, RN-PRO-01): funções puras que a API (E4b) chama
 * em toda escrita. As regras (travas pelo cargo, último admin, autogestão, senha) são do SDK (`validarAcessoPeloCargo`,
 * `protegidoDaSenha`, `temGestaoDoAcesso`); aqui só se monta o catálogo, a cópia e a trava otimista.
 * ADITIVO: o `perfis.ts` antigo sai na E6.
 */
import {
  AREAS_PERMISSAO,
  CHAVE_ACESSO,
  protegidoDaSenha,
  MODELOS_PERFIL,
  ROTULO_PERFIL,
  type ModeloPerfil,
  type Cargo,
  type DefinicaoChave,
  type LugarDeAcesso,
  type ModelosDePerfil,
  type ModuloId,
  type PerfilPorCargo,
  type PermissoesDoPerfil,
  resolverPerfilPeloCargo,
  temGestaoDoAcesso,
  tetoDeEscopoDoCargo,
  travaDaChavePeloCargo,
  type ValorPermissao,
  type ViolacaoLimite,
} from '@macuxi/platform-sdk';

import {
  CODIGOS_ERRO_PERFIL_V2,
  MOTIVO_MODULO_SEM_LICENCA,
  STATUS_PERFIL_ALTERADO,
  type CatalogoResposta,
  type CopiarDe,
  type ModelosDePerfilResposta,
  type MudancaDePermissao,
  type PerfilDetalheV2,
  type PermissaoConcedidaV2,
} from '../contracts/perfis';
import { mesmosAlvos } from './perfis';

/** Rótulo de cada área na tabela de permissões. */
export const ROTULO_AREA: Readonly<Record<(typeof AREAS_PERMISSAO)[number], string>> = {
  acesso: 'Acesso',
  dados: 'Dados',
  usuarios: 'Usuários',
  clientes: 'Clientes',
  pedidos: 'Pedidos',
  catalogo: 'Catálogo',
  trade: 'Trade marketing',
  pesquisa: 'Pesquisas',
  treinamento: 'Treinamento',
  metas: 'Metas',
  gestao: 'Gestão',
  integracao: 'Integração',
  administracao: 'Administração',
};

/**
 * `GET /v1/core/permissoes/catalogo`: chaves por área (ordem das áreas, depois da chave) com `disponivel` pela licença do tenant
 * (RN-CORE-02): módulo sem licença → `disponivel: false`, `motivo: MODULO_SEM_LICENCA`. O Core é sempre licenciado.
 */
/** O core é sempre licenciado (RN-CORE-02); os demais módulos dependem da licença do tenant. */
export const moduloLicenciado = (modulo: ModuloId, licencas: ReadonlySet<ModuloId>): boolean => modulo === 'core' || licencas.has(modulo);

/** O valor de uma concessão a partir do que vem do banco ou do corpo: só leva nível e alvos que existem. */
export function valorDaConcessao(nivel: ValorPermissao['nivel'] | null | undefined, alvos: readonly string[] | null | undefined): ValorPermissao {
  return { ...(nivel ? { nivel } : {}), ...(alvos ? { alvos: [...alvos] } : {}) };
}

/** RN-CORE-35: o nome já é de outro perfil ativo (sem diferenciar caixa); `ignorarId` é o próprio perfil, na edição. */
export function nomeJaUsado(perfis: readonly { id: string; nome: string; ativo: boolean }[], nome: string, ignorarId?: string): boolean {
  const n = nome.trim().toLowerCase();
  return perfis.some((p) => p.id !== ignorarId && p.ativo && p.nome.toLowerCase() === n);
}

/**
 * Chaves que só valem no BKO (ADR 0073 §2.5.10): ação de tela do BKO, sem uso no app. Sem `acesso.bko` no perfil a linha vem
 * "Sem efeito: o perfil não entra no BKO" (só na tela, sem 422). O manifesto ainda não diz a superfície da ação; até lá a regra é esta:
 * gestão de usuários e perfis, administração do tenant (`parametro.*`, `*.gerenciar`) e as telas só do BKO.
 */
const SO_BKO = new Set([
  'usuario.ver', 'usuario.criar', 'usuario.editar', 'usuario.desativar', 'usuario.desbloquear', 'usuario.filial_editar', 'usuario_avatar.trocar_outro',
  'senha.redefinir', 'perfil.gerir', 'dispositivo.bloquear', 'cliente.aprovar_coordenada', 'cliente.pre_cadastro_recusados', 'cliente.pagamento_editar',
  'produto.editar_preco', 'produto.parametros', 'medida.gerenciar', 'modulo.gerir_licencas', 'inicio_bko.ver', 'notificacao.enviar', 'motivo.editar',
  'foto_tipo.editar', 'documento.permissoes', 'filial.editar', 'frase_dia.editar', 'rastreamento.configurar', 'meta.editar', 'meta_produtividade.editar',
  'plano_rv.editar', 'conector.gerenciar', 'mapeamento.editar',
]);
export const soValeNoBko = (chave: string): boolean => SO_BKO.has(chave) || chave.startsWith('parametro.') || chave.endsWith('.gerenciar');

export function montarCatalogoPorArea(
  catalogo: readonly DefinicaoChave[],
  licencas: ReadonlySet<ModuloId>,
  versao: number,
): CatalogoResposta {
  const areas = AREAS_PERMISSAO.map((area) => ({
    area: area as string,
    rotulo: ROTULO_AREA[area],
    chaves: catalogo
      .filter((d) => d.area === area)
      .sort((a, b) => a.chave.localeCompare(b.chave))
      .map((d) => {
        const disponivel = moduloLicenciado(d.modulo, licencas);
        return {
          chave: d.chave,
          descricao: d.descricao,
          modulo: d.modulo as string,
          nivel: d.nivel ?? null,
          alvos: !!d.alvos,
          disponivel,
          motivo: disponivel ? null : MOTIVO_MODULO_SEM_LICENCA,
          so_bko: soValeNoBko(d.chave),
        };
      }),
  })).filter((a) => a.chaves.length > 0);
  return { versao, areas };
}

export type ResultadoCopia = { ok: true; permissoes: PermissoesDoPerfil } | { ok: false; codigo: 'PERFIL_NAO_ENCONTRADO' };

/**
 * "Copiar de" (RN-CORE-35): cópia única, sem vínculo; de um modelo ou de um perfil do tenant. A cópia já sai do tamanho do cargo
 * do perfil novo: deixa de fora as chaves que o cargo trava (RN-PRO-01, RN-CORE-33) e desce `dados.escopo` ao teto do cargo
 * (RN-CORE-04), pelo `resolverPerfilPeloCargo` do SDK. A API revalida na gravação (defesa em profundidade).
 */
export function aplicarCopiarDe(
  origem: CopiarDe,
  cargo: PerfilPorCargo['cargo'],
  fontes: { modelos: ModelosDePerfil; perfis: readonly Pick<PerfilPorCargo, 'codigo' | 'permissoes'>[] },
): ResultadoCopia {
  let base: PermissoesDoPerfil;
  if ('modelo' in origem) base = fontes.modelos[origem.modelo].permissoes;
  else {
    const p = fontes.perfis.find((x) => x.codigo === origem.perfil);
    if (!p) return { ok: false, codigo: 'PERFIL_NAO_ENCONTRADO' };
    base = p.permissoes;
  }
  return { ok: true, permissoes: resolverPerfilPeloCargo({ codigo: '', cargo, permissoes: base }).permissoes };
}

/** Trava otimista do PUT (ADR 0073 §4.2): compara instantes, não texto. Diferente = 409 `PERFIL_ALTERADO`. */
export function conferirTravaOtimista(gravado: string, enviado: string): { ok: true } | { ok: false; status: typeof STATUS_PERFIL_ALTERADO; codigo: typeof CODIGOS_ERRO_PERFIL_V2.alterado } {
  const a = Date.parse(gravado);
  const b = Date.parse(enviado);
  return a === b ? { ok: true } : { ok: false, status: STATUS_PERFIL_ALTERADO, codigo: CODIGOS_ERRO_PERFIL_V2.alterado };
}

// ---------------------------------------------------------------- E4b: detalhe, corpo, diferença e violações novas

export type MapaDeConcessoes = Readonly<Record<string, ValorPermissao>>;

/** Perfil ativo do tenant como o detalhe o enxerga: o suficiente para "onde entra" e para os alvos da senha. */
export interface PerfilAtivoParaDetalhe {
  codigo: string;
  nome: string;
  cargo: Cargo;
  permissoes: MapaDeConcessoes;
}

const LUGARES: readonly LugarDeAcesso[] = ['campo', 'gestao', 'bko', 'portal'];

/** Onde o perfil entra, já com as travas do cargo (RN-CORE-33): o que o cargo trava não conta. */
export function ondeEntraPeloCargo(cargo: Cargo, permissoes: MapaDeConcessoes): LugarDeAcesso[] {
  const r = resolverPerfilPeloCargo({ codigo: '', cargo, permissoes }).permissoes;
  return LUGARES.filter((l) => Object.hasOwn(r, CHAVE_ACESSO[l]));
}

export interface EntradaDetalheV2 {
  codigo: string;
  nome: string;
  descricao: string | null;
  cargo: Cargo;
  ativo: boolean;
  usuarios: number;
  /** Instante gravado do perfil (ISO, UTC): a trava otimista do PUT. */
  atualizado_em: string;
  permissoes: MapaDeConcessoes;
  /** As chaves que a tela mostra (o catálogo sem as fixas do aparelho). */
  catalogo: readonly DefinicaoChave[];
  licencas: ReadonlySet<ModuloId>;
  perfisAtivos: readonly PerfilAtivoParaDetalhe[];
  modulos?: readonly string[];
  /** Perfil de quem está logado (código); `autogestao` = é este perfil e ele tem a gestão do acesso. */
  perfilDoLogado?: string | null;
}

/** RN-CORE-35: o perfil é o de quem está logado e tem a gestão do acesso (a tela trava a gestão do acesso no próprio perfil). */
export const ehAutogestao = (codigo: string, permissoes: MapaDeConcessoes, perfilDoLogado: string | null | undefined): boolean =>
  !!perfilDoLogado && perfilDoLogado === codigo && temGestaoDoAcesso(permissoes);

/**
 * `PerfilDetalheV2` (ADR 0073 §4.2): uma linha por chave do catálogo, com o valor gravado, o cadeado do cargo
 * (`travaDaChavePeloCargo`: RN-PRO-01, RN-CORE-33), a licença do módulo (RN-CORE-02) e o teto do escopo (RN-CORE-04).
 * Os alvos da senha deixam de fora quem tem `perfil.gerir` (RN-CORE-34).
 */
export function montarDetalheV2(e: EntradaDetalheV2): PerfilDetalheV2 {
  const gestaoDoAcesso = temGestaoDoAcesso(e.permissoes);
  const permissoes = [...e.catalogo]
    .sort((a, b) => a.chave.localeCompare(b.chave))
    .map((d) => {
      const v = e.permissoes[d.chave];
      const trava = travaDaChavePeloCargo(e.cargo, d.chave, { gestaoDoAcesso });
      return {
        chave: d.chave,
        concedida: !!v,
        nivel: v?.nivel ?? null,
        alvos: v?.alvos ? [...v.alvos] : null,
        trava: trava ? { regra: trava.regra, mensagem: trava.mensagem } : null,
        disponivel: moduloLicenciado(d.modulo, e.licencas),
      };
    });
  return {
    perfil: {
      codigo: e.codigo,
      nome: e.nome,
      descricao: e.descricao,
      cargo: e.cargo,
      ativo: e.ativo,
      usuarios: e.usuarios,
      onde_entra: ondeEntraPeloCargo(e.cargo, e.permissoes),
      autogestao: ehAutogestao(e.codigo, e.permissoes, e.perfilDoLogado),
    },
    permissoes,
    teto_escopo: tetoDeEscopoDoCargo(e.cargo),
    alvos_possiveis: e.perfisAtivos
      .filter((p) => !protegidoDaSenha(p.permissoes))
      .map((p) => ({ codigo: p.codigo, nome: p.nome, cargo: p.cargo, onde_entra: ondeEntraPeloCargo(p.cargo, p.permissoes) })),
    modulos: [...(e.modulos ?? [])],
    atualizado_em: e.atualizado_em,
  };
}

/** O conjunto enviado no corpo vira o mapa de concessões (chave repetida vale a última; o que não vem fica desmarcado). */
export function permissoesDoCorpo(lista: readonly PermissaoConcedidaV2[]): Record<string, ValorPermissao> {
  const r: Record<string, ValorPermissao> = {};
  for (const p of lista) r[p.chave] = valorDaConcessao(p.nivel, p.alvos);
  return r;
}

/** O que mudou entre dois conjuntos de concessões: chaves que entraram, saíram e mudaram de nível ou de alvos. */
export function diffConcessoes(antes: MapaDeConcessoes, depois: MapaDeConcessoes): { entrou: string[]; saiu: string[]; mudou: string[] } {
  const entrou = Object.keys(depois).filter((c) => !Object.hasOwn(antes, c)).sort();
  const saiu = Object.keys(antes).filter((c) => !Object.hasOwn(depois, c)).sort();
  const mudou = Object.keys(depois)
    .filter((c) => Object.hasOwn(antes, c) && (antes[c]!.nivel !== depois[c]!.nivel || !mesmosAlvos(antes[c]!.alvos, depois[c]!.alvos)))
    .sort();
  return { entrou, saiu, mudou };
}

const chaveDaViolacao = (v: ViolacaoLimite) => `${v.codigo}|${v.perfil ?? ''}|${v.chave ?? ''}|${v.usuario_id ?? ''}`;

/**
 * Violações que a escrita traz: as do perfil escrito sempre valem; as dos outros perfis só se já não existiam no estado gravado
 * (a migração deixa avisos, ex.: perfil sem acesso e sem usuários, que não podem travar a edição de um perfil sem relação).
 */
export function violacoesNovas(antes: readonly ViolacaoLimite[], depois: readonly ViolacaoLimite[], perfilEscrito: string | null): ViolacaoLimite[] {
  const jaExistiam = new Set(antes.map(chaveDaViolacao));
  return depois.filter((v) => (perfilEscrito !== null && v.perfil === perfilEscrito) || !jaExistiam.has(chaveDaViolacao(v)));
}

/** `GET /v1/core/perfis/modelos`: os 7 modelos na ordem de `MODELOS_PERFIL`, sem as chaves fixas do aparelho (a tela não as mostra). */
export function montarModelos(modelos: ModelosDePerfil, foraDaTela: ReadonlySet<string>): ModelosDePerfilResposta {
  return {
    itens: MODELOS_PERFIL.map((m: ModeloPerfil) => {
      const { cargo, permissoes } = modelos[m];
      return {
        modelo: m,
        nome: ROTULO_PERFIL[m],
        cargo,
        onde_entra: ondeEntraPeloCargo(cargo, permissoes),
        permissoes: Object.entries(permissoes)
          .filter(([c]) => !foraDaTela.has(c))
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([chave, v]) => ({ chave, nivel: v.nivel ?? null, alvos: v.alvos ? [...v.alvos] : null })),
      };
    }),
  };
}

/** O que a auditoria guarda em `permissoes`: mapa chave → valor (`perfil.alterar`: só o que mudou) ou lista de chaves (`perfil.criar`). */
type ValorAuditado = MudancaDePermissao['de'] & object;
function lerPermissoesAuditadas(o: unknown): Map<string, ValorAuditado> {
  const r = new Map<string, ValorAuditado>();
  const p = o && typeof o === 'object' ? (o as { permissoes?: unknown }).permissoes : null;
  if (Array.isArray(p)) {
    for (const c of p) if (typeof c === 'string') r.set(c, { nivel: null, alvos: null });
  } else if (p && typeof p === 'object') {
    for (const [c, v] of Object.entries(p as Record<string, { nivel?: ValorAuditado['nivel']; alvos?: string[] | null } | null>)) r.set(c, { nivel: v?.nivel ?? null, alvos: v?.alvos ? [...v.alvos] : null });
  }
  return r;
}

/** RN-AUD-01: a diferença de permissões de uma linha do histórico (`antes.permissoes` × `depois.permissoes`), por chave, em ordem. */
export function mudancasDoHistorico(antes: unknown, depois: unknown): MudancaDePermissao[] {
  const a = lerPermissoesAuditadas(antes);
  const d = lerPermissoesAuditadas(depois);
  return [...new Set([...a.keys(), ...d.keys()])]
    .sort()
    .map((chave) => ({ chave, de: a.get(chave) ?? null, para: d.get(chave) ?? null }))
    .filter((m) => JSON.stringify(m.de) !== JSON.stringify(m.para));
}
