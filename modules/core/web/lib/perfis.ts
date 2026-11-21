/**
 * Página "Perfis de acesso" (T-0111; spec docs/design/perfis-de-acesso.md): arrumação pura do que a API entrega (`PerfilDetalhe`) em
 * seções e linhas, o estado de edição, o resumo "o que mudou" e o corpo do PUT. A REGRA (cadeado, limites, escopo) vem da API
 * (`trava`, `escopo_maximo`) e do domain; aqui só há texto e agrupamento. Linha cuja chave não existe no catálogo some (spec §13).
 */
import {
  ALVO_TODOS_PERFIS,
  CADEADO,
  ORDEM_PERFIL_BASE,
  ROTULO_PERFIL_BASE,
  resumoDosAlvos,
  type MudancaDePermissao,
  type SecaoDoPerfil,
} from '@macuxi/ui/web';
import { NIVEIS_ESCOPO } from '@macuxi/platform-sdk';
import { mesmosAlvos } from '../../domain/perfis';
import type { ChaveDoPerfil, EditarPerfilRequest, PerfilDetalhe, ValorDaChave } from '../../contracts';

export type Edicao = Record<string, ValorDaChave>;

export interface OpcaoDaLinha {
  valor: string;
  rotulo: string;
  desabilitada?: boolean;
  motivo?: string;
}

export interface LinhaDoPerfil {
  /** Usado em `permissao.<id>`: a primeira chave com "." trocado por "-" ou `grupo-<nome>`. */
  id: string;
  secao: SecaoDoPerfil;
  rotulo: string;
  ajuda?: string;
  tipo: 'interruptor' | 'nivel' | 'alvos';
  chaves: string[];
  opcoes?: OpcaoDaLinha[];
  /** Cadeado: o texto da regra; o controle fica travado em "Não". */
  trava?: string;
}

type DefLinha = { id: string; secao: SecaoDoPerfil; rotulo: string; ajuda?: string; tipo: LinhaDoPerfil['tipo']; chaves: string[] };

const I = (id: string, secao: SecaoDoPerfil, rotulo: string, chaves: string[], ajuda?: string): DefLinha => ({ id, secao, rotulo, ajuda, tipo: 'interruptor', chaves });

/** As linhas de cada seção (spec §5.2 a §5.12). Níveis e alvos têm tipo próprio. */
const LINHAS: readonly DefLinha[] = [
  I('acesso-campo', 'onde-entra', 'App Campo', ['acesso.campo']),
  I('acesso-gestao', 'onde-entra', 'App Gestão', ['acesso.gestao']),
  I('acesso-bko', 'onde-entra', 'BKO', ['acesso.bko']),
  I('acesso-portal', 'onde-entra', 'Portal de implantação', ['acesso.portal']),
  { id: 'dados-escopo', secao: 'escopo', rotulo: 'Quais clientes e números vê', ajuda: 'O perfil começa com o escopo do perfil base e pode ter menos, nunca mais.', tipo: 'nivel', chaves: ['dados.escopo'] },
  I('usuario-ver', 'usuarios', 'Ver os usuários', ['usuario.ver']),
  I('usuario-criar', 'usuarios', 'Criar usuário', ['usuario.criar']),
  I('usuario-editar', 'usuarios', 'Editar usuário', ['usuario.editar'], 'Nome, e-mail, equipe e perfil.'),
  I('usuario-desativar', 'usuarios', 'Desativar usuário', ['usuario.desativar'], 'Nunca o próprio.'),
  I('usuario-desbloquear', 'usuarios', 'Desbloquear usuário', ['usuario.desbloquear']),
  I('usuario-filial-editar', 'usuarios', 'Informar a filial do usuário', ['usuario.filial_editar'], 'Filial de cadastro e filiais de venda, a própria inclusive.'),
  { id: 'senha-redefinir', secao: 'usuarios', rotulo: 'Redefinir senha', tipo: 'alvos', chaves: ['senha.redefinir'], ajuda: 'Ninguém redefine a própria senha por aqui: use "Esqueci a senha" no login.' },
  I('perfil-gerir', 'usuarios', 'Gerenciar perfis de acesso', ['perfil.gerir']),
  I('carteira-editar', 'clientes', 'Transferir cliente de carteira', ['carteira.editar'], 'Vincular e desvincular clientes de vendedor ou promotor.'),
  I('pedido-criar', 'pedidos', 'Criar e editar pedido', ['pedido.criar', 'pedido.editar']),
  I('pedido-cancelar', 'pedidos', 'Cancelar pedido', ['pedido.cancelar'], 'Antes do envio ao ERP. Depois, só se a integração aceitar devolver o cancelamento ao ERP.'),
  I('pedido-ver', 'pedidos', 'Ver pedidos', ['pedido.ver']),
  I('pedido-aprovar', 'pedidos', 'Aprovar desconto e crédito', ['pedido.aprovar']),
  I('pedido-excluir', 'pedidos', 'Excluir rascunho', ['pedido.excluir']),
  I('catalogo-conteudo', 'catalogo', 'Conteúdo, sinônimos e destaques', ['produto.enriquecer', 'sinonimo.gerenciar', 'destaque.gerenciar', 'busca.ver_sem_resultado']),
  I('catalogo-exportar', 'catalogo', 'Exportar o catálogo', ['catalogo.exportar']),
  I(
    'grupo-coletas',
    'trade',
    'Fazer coletas',
    ['coleta.registrar', 'checklist_loja.responder', 'gondola.registrar', 'share.registrar', 'preco.registrar', 'ruptura.registrar', 'validade.registrar', 'ponto_extra.registrar', 'concorrencia.registrar', 'tarefa_trade.concluir'],
    'Gôndola, share, preço, ruptura, validade, pontos extras, concorrência, checklist e tarefas.',
  ),
  I('grupo-cadastros-trade', 'trade', 'Cadastros de trade', ['mix.gerenciar', 'meta_share.gerenciar', 'marca.gerenciar', 'concorrente.gerenciar', 'planograma.gerenciar', 'checklist.gerenciar', 'tarefa.gerenciar', 'ponto_extra.gerenciar'], 'Mix, metas de share, marcas e concorrentes, planogramas, checklists e tarefas.'),
  I('pesquisa-responder', 'pesquisa-treinamento', 'Responder pesquisas', ['pesquisa.responder']),
  I('grupo-treinar', 'pesquisa-treinamento', 'Fazer os treinamentos', ['trilha.baixar_offline', 'licao.concluir', 'quiz.responder']),
  I('grupo-criar-pesquisas', 'pesquisa-treinamento', 'Criar pesquisas', ['questionario.criar', 'questionario.editar', 'questionario.publicar', 'questionario.arquivar']),
  I('grupo-criar-trilhas', 'pesquisa-treinamento', 'Criar trilhas', ['trilha.criar', 'trilha.editar', 'trilha.publicar', 'quiz.gerenciar', 'desafio.gerenciar', 'medalha.gerenciar']),
  I('grupo-resultados', 'pesquisa-treinamento', 'Ver resultados das pesquisas', ['resultado.ver', 'resultado.exportar']),
  I('grupo-adesao', 'pesquisa-treinamento', 'Ver adesão e notas dos treinamentos', ['adesao.ver', 'notas.ver']),
  I('meta-ver', 'metas', 'Ver as metas', ['meta.ver']),
  I('meta-editar', 'metas', 'Editar as metas do mês', ['meta.editar']),
  I('meta-fechar', 'metas', 'Fechar e reabrir o mês', ['meta.fechar_periodo']),
  I('rv-ver', 'metas', 'Ver a remuneração variável', ['rv.ver']),
  I('plano-rv-ver', 'metas', 'Ver o plano de RV', ['plano_rv.ver']),
  I('plano-rv-editar', 'metas', 'Editar o plano de RV', ['plano_rv.editar']),
  I('monitor-ver', 'integracao', 'Ver o monitor', ['monitor.ver']),
  I('carga-arquivo', 'integracao', 'Carga por arquivo e modelos CSV', ['carga.arquivo'], 'Enviar arquivos CSV e baixar os modelos.'),
];

/** Rótulos curtos das chaves que ficam em "Outras permissões" (spec §5.13). */
const ROTULO_DA_CHAVE: Readonly<Record<string, string>> = {
  'cliente.pagamento_editar': 'Editar prazo e formas de pagamento do cliente',
  'cliente.aprovar_coordenada': 'Aprovar a localização do cliente',
  'pedido.criar_em_nome': 'Criar pedido em nome do vendedor',
  'transportadora.ver': 'Ver transportadoras',
  'transportadora.gerenciar': 'Cadastrar transportadoras',
  'forma_pagamento.ver': 'Ver formas de pagamento',
  'forma_pagamento.gerenciar': 'Cadastrar formas de pagamento',
  'tabela_preco.gerenciar': 'Cadastrar tabelas de preço',
  'ranking.ver': 'Ver o ranking dos treinamentos',
  'lote.reprocessar': 'Reprocessar lote',
  'mapeamento.editar': 'Editar o de-para de códigos',
  'conector.gerenciar': 'Cadastrar o Conector e a chave de acesso',
  'inativacao.decidir': 'Confirmar inativação em massa',
  'painel_equipe.ver': 'Ver o painel da equipe',
  'ranking_equipe.ver': 'Ver o ranking da equipe',
  'fila_aprovacao.ver': 'Ver a fila de aprovações',
  'fila_aprovacao.decidir': 'Aprovar ou rejeitar na fila',
  'alerta_equipe.ver': 'Ver os alertas da equipe',
  'alerta_equipe.dispensar': 'Dispensar alerta',
  'painel_tenant.ver': 'Ver os painéis da empresa (só leitura)',
  'alerta_regra.gerenciar': 'Ajustar as regras de alerta',
  'rota.editar': 'Montar a rota da semana',
  'modulo.gerir_licencas': 'Ligar e desligar módulos (Módulos)',
  'dispositivo.bloquear': 'Bloquear aparelho',
  'motivo.editar': 'Cadastrar motivos de não venda',
  'produto.editar_preco': 'Ver custo e editar preço do produto',
  'produto.parametros': 'Definir o desconto máximo padrão',
  'medida.gerenciar': 'Cadastrar medidas e embalagens',
  'filial.ver': 'Ver as filiais',
  'cliente_foto.ver': 'Ver as fotos do PDV do cliente',
  'foto_tipo.editar': 'Cadastrar os tipos de foto do PDV',
  'filial.editar': 'Cadastrar filiais',
  'cliente.filial_editar': 'Trocar a filial do cliente',
  'notificacao.enviar': 'Enviar recado à equipe',
  'notificacao.recado_do_dia': 'Marcar o recado do dia',
  'inicio.ver': 'Ver o Início do app',
  'inicio_bko.ver': 'Ver o Início do BKO',
  'farol.ver': 'Ver o farol de clientes',
  'parametro.farol': 'Ajustar o farol',
  'parametro.inicio': 'Ajustar o Início',
  'parametro.curva_abc': 'Ajustar as curvas ABC',
  'visita.checkin_fora_de_rota': 'Check-in fora de rota',
  'visita.registrar_gestao': 'Registrar visita no app Gestão',
  'visita.dispensar_etapa': 'Dispensar etapa pendente da visita',
  'parametro.checkout_pendencia': 'Ajustar o prazo do alerta de checkout',
};

/** Rótulo da chave: o da spec; senão a descrição do manifesto até o primeiro " (" ou ";". */
export function rotuloDaChave(chave: string, descricao: string): string {
  const r = ROTULO_DA_CHAVE[chave];
  if (r) return r;
  const corte = descricao.search(/ \(|;/);
  return (corte > 0 ? descricao.slice(0, corte) : descricao).trim() || chave;
}

export const idDaChave = (chave: string): string => chave.replace(/\./g, '-');

const NIVEIS_ESCOPO_ROTULO: Readonly<Record<string, string>> = {
  proprio: 'Só o que é dele',
  carteira: 'Carteira própria',
  equipe: 'Equipe',
  equipes_abaixo: 'Equipes abaixo',
  tenant: 'Toda a empresa',
};
const NIVEIS_ALCADA_ROTULO: Readonly<Record<string, string>> = { ate_alcada: 'Até a alçada', acima_alcada: 'Acima da alçada' };
export const rotuloDoNivel = (nivel: string): string => NIVEIS_ESCOPO_ROTULO[nivel] ?? NIVEIS_ALCADA_ROTULO[nivel] ?? nivel;

/** Estado de edição inicial: o valor atual de cada chave do catálogo. */
export const edicaoInicial = (d: PerfilDetalhe): Edicao => Object.fromEntries(d.chaves.map((c) => [c.chave, { ...c.atual }]));

/** Seção de uma chave que não tem linha própria: o grupo "Outras permissões" por área. */
export const GRUPOS_OUTRAS = [
  { area: 'acesso', titulo: 'Acesso' },
  { area: 'usuarios', titulo: 'Usuários' },
  { area: 'clientes', titulo: 'Clientes' },
  { area: 'pedidos', titulo: 'Pedidos' },
  { area: 'catalogo', titulo: 'Catálogo' },
  { area: 'trade', titulo: 'Trade' },
  { area: 'pesquisa', titulo: 'Pesquisa' },
  { area: 'treinamento', titulo: 'Treinamento' },
  { area: 'metas', titulo: 'Metas e remuneração' },
  { area: 'gestao', titulo: 'Gestão da equipe' },
  { area: 'integracao', titulo: 'Integração' },
  { area: 'administracao', titulo: 'Administração do BKO' },
] as const;

/** Monta as linhas do perfil: as da spec cujas chaves existem, mais uma linha por chave que sobrou (nada fica sem lugar, §5.13). */
export function montarLinhas(d: PerfilDetalhe): { linhas: LinhaDoPerfil[]; outras: { area: string; titulo: string; linhas: LinhaDoPerfil[] }[] } {
  const porChave = new Map(d.chaves.map((c) => [c.chave, c]));
  const usadas = new Set<string>();
  const base = d.perfil.base;
  const linhas: LinhaDoPerfil[] = [];
  for (const def of LINHAS) {
    const chaves = def.chaves.filter((c) => porChave.has(c));
    if (chaves.length === 0) continue;
    chaves.forEach((c) => usadas.add(c));
    const linha: LinhaDoPerfil = { id: def.id, secao: def.secao, rotulo: def.rotulo, ajuda: def.ajuda, tipo: def.tipo, chaves };
    if (def.tipo === 'nivel') {
      linha.opcoes = NIVEIS_ESCOPO.filter((n) => (n !== 'proprio' || porChave.get('dados.escopo')?.atual.nivel === 'proprio') && (n !== 'equipes_abaixo' || base === 'gerente')).map((n) => {
        const acima = (NIVEIS_ESCOPO as readonly string[]).indexOf(n) > (NIVEIS_ESCOPO as readonly string[]).indexOf(d.escopo_maximo);
        return { valor: n, rotulo: rotuloDoNivel(n), desabilitada: acima, motivo: acima ? CADEADO.escopoAcimaDaBase(base) : undefined };
      });
    }
    const travas = chaves.map((c) => porChave.get(c)!.trava).filter((t): t is NonNullable<typeof t> => !!t);
    if (def.tipo === 'interruptor' && travas.length === chaves.length) linha.trava = travas[0]!.mensagem;
    linhas.push(linha);
  }
  const outras = GRUPOS_OUTRAS.map((g) => ({
    ...g,
    linhas: d.chaves
      .filter((c) => !usadas.has(c.chave) && c.area === g.area && c.nivel === null && !c.alvos)
      .map<LinhaDoPerfil>((c) => ({
        id: idDaChave(c.chave),
        secao: 'outras',
        rotulo: rotuloDaChave(c.chave, c.descricao),
        tipo: 'interruptor',
        chaves: [c.chave],
        trava: c.trava?.mensagem,
      })),
  })).filter((g) => g.linhas.length > 0);
  return { linhas, outras };
}

// ---------------------------------------------------------------- valores

export type Ligado = 'sim' | 'nao' | 'misto';

export function ligadoDaLinha(l: LinhaDoPerfil, e: Edicao): Ligado {
  const n = l.chaves.filter((c) => e[c]?.concedida).length;
  return n === 0 ? 'nao' : n === l.chaves.length ? 'sim' : 'misto';
}

export const nivelDaLinha = (l: LinhaDoPerfil, e: Edicao): string => e[l.chaves[0]!]?.nivel ?? '';

export function ligarLinha(l: LinhaDoPerfil, e: Edicao, ligar: boolean): Edicao {
  const novo = { ...e };
  for (const c of l.chaves) novo[c] = { concedida: ligar, nivel: ligar ? (e[c]?.nivel ?? null) : null, alvos: ligar ? (e[c]?.alvos ?? null) : null };
  return novo;
}

export function escolherNivel(l: LinhaDoPerfil, e: Edicao, nivel: string): Edicao {
  const c = l.chaves[0]!;
  return { ...e, [c]: { concedida: true, nivel: nivel as ValorDaChave['nivel'], alvos: e[c]?.alvos ?? null } };
}

export function marcarAlvos(l: LinhaDoPerfil, e: Edicao, alvos: string[]): Edicao {
  const c = l.chaves[0]!;
  return { ...e, [c]: { concedida: e[c]?.concedida ?? true, nivel: e[c]?.nivel ?? null, alvos } };
}

/** Texto do valor da linha (resumo, histórico, "Padrão: X"). */
export function textoDoValor(l: LinhaDoPerfil, e: Edicao, rotulosDosPerfis: Readonly<Record<string, string>>): string {
  if (l.tipo === 'nivel') return rotuloDoNivel(nivelDaLinha(l, e));
  const lig = ligadoDaLinha(l, e);
  if (l.tipo === 'alvos') return lig === 'nao' ? 'Não' : resumoDosAlvos(e[l.chaves[0]!]?.alvos, rotulosDosPerfis);
  return lig === 'sim' ? 'Sim' : lig === 'nao' ? 'Não' : 'Em parte';
}

export const edicaoDaFabrica = (d: PerfilDetalhe): Edicao => Object.fromEntries(d.chaves.map((c) => [c.chave, { ...c.fabrica }]));

/** Chaves cujo valor difere do inicial. */
const mudou = (a: ValorDaChave | undefined, b: ValorDaChave | undefined): boolean =>
  !!a !== !!b || a?.concedida !== b?.concedida || (a?.nivel ?? null) !== (b?.nivel ?? null) || !mesmosAlvos(a?.alvos, b?.alvos);

export interface Identificacao {
  nome: string;
  descricao: string;
  ativo: boolean;
}

/** Linhas do resumo "o que mudou" (spec §7.1): identificação + cada linha cujo valor mudou. */
export function mudancasDaEdicao(args: {
  linhas: readonly LinhaDoPerfil[];
  outras: readonly LinhaDoPerfil[];
  inicial: Edicao;
  atual: Edicao;
  identInicial: Identificacao;
  identAtual: Identificacao;
  rotulosDosPerfis: Readonly<Record<string, string>>;
}): MudancaDePermissao[] {
  const saida: MudancaDePermissao[] = [];
  const { identInicial: i, identAtual: a } = args;
  if (i.nome !== a.nome) saida.push({ secao: 'identificacao', rotulo: 'Nome', antes: i.nome, depois: a.nome });
  if (i.descricao !== a.descricao) saida.push({ secao: 'identificacao', rotulo: 'Descrição', antes: i.descricao || 'Vazia', depois: a.descricao || 'Vazia' });
  if (i.ativo !== a.ativo) saida.push({ secao: 'identificacao', rotulo: 'Ativo', antes: i.ativo ? 'Sim' : 'Não', depois: a.ativo ? 'Sim' : 'Não' });
  for (const l of [...args.linhas, ...args.outras]) {
    if (l.chaves.some((c) => mudou(args.inicial[c], args.atual[c]))) {
      saida.push({ secao: l.secao, rotulo: l.rotulo, antes: textoDoValor(l, args.inicial, args.rotulosDosPerfis), depois: textoDoValor(l, args.atual, args.rotulosDosPerfis) });
    }
  }
  return saida;
}

/** Corpo do PUT: todas as permissões concedidas (o que não está aqui fica negado). */
export function corpoDoPerfil(e: Edicao, ident: Identificacao, fabrica: boolean): EditarPerfilRequest {
  return {
    ...(fabrica ? {} : { nome: ident.nome.trim() }),
    descricao: ident.descricao.trim() || null,
    ...(fabrica ? {} : { ativo: ident.ativo }),
    permissoes: Object.entries(e)
      .filter(([, v]) => v.concedida)
      .map(([chave, v]) => ({ chave, ...(v.nivel ? { nivel: v.nivel } : {}), ...(v.alvos ? { alvos: v.alvos } : {}) })),
  };
}

/** Linha de "senha.redefinir" ligada sem nenhum perfil marcado (a tela não deixa salvar, §5.5). */
export function erroDeAlvos(l: LinhaDoPerfil, e: Edicao): string | null {
  if (l.tipo !== 'alvos') return null;
  const v = e[l.chaves[0]!];
  return v?.concedida && (v.alvos?.length ?? 0) === 0 ? 'Marque pelo menos um perfil ou desligue a redefinição de senha.' : null;
}

/** Quantas mudanças cada seção tem (o selo do índice). */
export function mudancasPorSecao(m: readonly MudancaDePermissao[]): Record<string, number> {
  const r: Record<string, number> = {};
  for (const x of m) r[x.secao] = (r[x.secao] ?? 0) + 1;
  return r;
}

/** Frases do resumo para uma recusa 422 (no máximo 3 e "e mais N"; nunca JSON, §7.2). */
export function frasesDaRecusa(detalhes: unknown, mensagem: string): string[] {
  const v = (detalhes as { violacoes?: { mensagem?: string }[] } | null)?.violacoes;
  const frases = [...new Set((v ?? []).map((x) => x.mensagem).filter((m): m is string => !!m))];
  if (frases.length === 0) return [mensagem];
  return frases.length <= 3 ? frases : [...frases.slice(0, 3), `e mais ${frases.length - 3}`];
}

export const ordemDaBase = (b: string): number => ORDEM_PERFIL_BASE.indexOf(b as (typeof ORDEM_PERFIL_BASE)[number]);
export const rotuloDaBase = (b: string): string => ROTULO_PERFIL_BASE[b as keyof typeof ROTULO_PERFIL_BASE] ?? b;
export { ALVO_TODOS_PERFIS };
export type { ChaveDoPerfil };

// ---------------------------------------------------------------- módulos, recusa por linha e histórico

const NOME_DO_MODULO: Readonly<Record<string, string>> = {
  core: 'Core',
  catalogo: 'Catálogo',
  vendedor: 'Vendedor',
  promotor: 'Promotor',
  gestor: 'Gestor',
  pesquisa: 'Pesquisa',
  treinamento: 'Treinamento',
  integracao: 'Integração com o ERP',
};
/** Nome do módulo para a tela (nunca o código). */
export const rotuloDoModulo = (m: string): string => NOME_DO_MODULO[m] ?? m;

/** Recusa 422: mensagem por chave (`violacoes[].chave`), para a linha da chave ganhar o erro (spec §7.2). */
export function errosPorChave(detalhes: unknown): Record<string, string> {
  const v = (detalhes as { violacoes?: { chave?: string; mensagem?: string }[] } | null)?.violacoes;
  const saida: Record<string, string> = {};
  for (const x of v ?? []) if (x.chave && x.mensagem && !saida[x.chave]) saida[x.chave] = x.mensagem;
  return saida;
}

/** Uma sobreposição gravada no histórico (a diferença para o padrão de fábrica). */
export interface RegistroSobre {
  chave: string;
  concedida: boolean;
  nivel?: string | null;
  alvos?: string[] | null;
}

/**
 * Frases do histórico em palavras da tela (spec §8): "Cancelar pedido: Não → Sim". A chave sem sobreposição volta ao valor de fábrica;
 * chave, nível e código de perfil nunca aparecem. Chave sem linha na tela vira uma frase genérica no fim.
 */
export function frasesDoHistorico(args: {
  antes: readonly RegistroSobre[];
  depois: readonly RegistroSobre[];
  linhas: readonly LinhaDoPerfil[];
  fabrica: Edicao;
  rotulos: Readonly<Record<string, string>>;
}): string[] {
  const aplicar = (regs: readonly RegistroSobre[]): Edicao => {
    const e: Edicao = { ...args.fabrica };
    for (const r of regs) e[r.chave] = { concedida: r.concedida, nivel: (r.nivel ?? null) as ValorDaChave['nivel'], alvos: r.alvos ?? null };
    return e;
  };
  const a = aplicar(args.antes);
  const d = aplicar(args.depois);
  const chaves = [...new Set([...args.antes, ...args.depois].map((r) => r.chave))].sort();
  const vistas = new Set<string>();
  const frases: string[] = [];
  let semLinha = false;
  for (const c of chaves) {
    const l = args.linhas.find((x) => x.chaves.includes(c));
    if (!l) {
      semLinha = true;
      continue;
    }
    if (vistas.has(l.id)) continue;
    vistas.add(l.id);
    const t0 = textoDoValor(l, a, args.rotulos);
    const t1 = textoDoValor(l, d, args.rotulos);
    if (t0 !== t1) frases.push(`${l.rotulo}: ${t0} → ${t1}`);
  }
  if (semLinha) frases.push('Outras permissões foram ajustadas.');
  return frases;
}
