/**
 * Visão da tela "Usuários" do BKO (RF-CORE-02; T-0067): funções puras sobre `GET /v1/core/usuarios`. Sem React e sem rede.
 * A validação reaproveita as regras do domínio (a API revalida tudo).
 */
import { formatDateTime, formatTime } from '@macuxi/ui/web';
import { temPerfilDeBase, type Perfil } from '@macuxi/platform-sdk';
import { ALMOCO_PADRAO_EMPRESA, DESCONTO_PEDIDO_PERMIL_MAX, type CriarUsuarioRequest, type EditarUsuarioRequest, type EmailAcesso, type EquipeOpcao, type HorarioAlmoco, type UsuarioItem } from '../../contracts';
import { erroDoCodigoErp, errosDaHierarquia, hierarquiaDoCargo, type PessoaDaHierarquia } from '../../domain/cargos';
import type { Cargo } from '@macuxi/platform-sdk';
import { ERRO_SEM_PERFIL, lerHorarioAlmocoTexto, textoDoMinuto, faltasNaSenha, gerarSenhaTemporaria, validarDadosDeUsuario, validarSenhaInicial, type ErroDeCampo, type FaltaNaSenha } from '../../domain';

export interface FormularioUsuario {
  nome: string;
  nome_curto: string;
  email: string;
  perfil: Perfil;
  /** Código do perfil do usuário (RN-CORE-54: um só; a API recebe a lista de um item). */
  perfis: string[];
  equipe_id: string;
  external_id: string;
  senha: string;
  /** T-0168 / RN-VEN-11a: funções de desconto (aba Parâmetros). O limite é digitado em % com uma casa ("8,0"). */
  limita_item: boolean;
  limita_pedido: boolean;
  desconto_maximo_pedido: string;
  /** RN-CORE-55 (0069): hierarquia pelo cargo do perfil (`regrasDoCargo`); vazio = sem escolha. */
  supervisor_id: string;
  gerente_id: string;
  equipe_nome: string;
  /** T-0180 (D5): seção Jornada. Marcado = padrão da empresa; desmarcado, início e fim (hh:mm) valem para o usuário. */
  almoco_padrao: boolean;
  almoco_inicio: string;
  almoco_fim: string;
}

export const FORMULARIO_VAZIO: FormularioUsuario = { nome: '', nome_curto: '', email: '', perfil: 'vendedor', perfis: [], equipe_id: '', external_id: '', senha: '', limita_item: true, limita_pedido: false, desconto_maximo_pedido: '', supervisor_id: '', gerente_id: '', equipe_nome: '', almoco_padrao: true, almoco_inicio: textoDoMinuto(ALMOCO_PADRAO_EMPRESA.inicio_min), almoco_fim: textoDoMinuto(ALMOCO_PADRAO_EMPRESA.fim_min) };

export const ERRO_DESCONTO_OBRIGATORIO = 'Obrigatório';
export const ERRO_DESCONTO_FAIXA = 'De 0 a 100';

/** "8,0" ou "8.5" em % → décimos de % (‰) inteiros; vazio ou inválido = null. */
export function permilDoTexto(texto: string): number | null {
  const t = texto.trim().replace(',', '.');
  if (t === '' || !/^\d+(\.\d+)?$/.test(t)) return null;
  return Math.round(Number(t) * 10);
}

/** ‰ → texto com uma casa e vírgula (80 → "8,0"). */
export function textoDoPermil(permil: number | null): string {
  return permil === null ? '' : (permil / 10).toFixed(1).replace('.', ',');
}

export { ERRO_SEM_PERFIL };

/** Horário da jornada no formulário: o próprio do usuário, ou o padrão da empresa (marcado) já preenchido nos dois campos. */
function jornadaDoForm(u: UsuarioItem | null, padrao: HorarioAlmoco): Pick<FormularioUsuario, 'almoco_padrao' | 'almoco_inicio' | 'almoco_fim'> {
  const proprio = u?.almoco_inicio_min != null && u.almoco_fim_min != null;
  return { almoco_padrao: !proprio, almoco_inicio: textoDoMinuto(proprio ? u.almoco_inicio_min! : padrao.inicio_min), almoco_fim: textoDoMinuto(proprio ? u.almoco_fim_min! : padrao.fim_min) };
}

/** Padrão da empresa para a jornada: o parâmetro lido, ou 12:00 às 13:00 quando ele não chegou. */
export const almocoPadraoDoTenant = (p: { almoco_padrao: HorarioAlmoco } | undefined): HorarioAlmoco => p?.almoco_padrao ?? ALMOCO_PADRAO_EMPRESA;

/** Formulário de um usuário novo: jornada no padrão da empresa. */
export const formularioNovo = (padrao: HorarioAlmoco = ALMOCO_PADRAO_EMPRESA): FormularioUsuario => ({ ...FORMULARIO_VAZIO, perfil: 'vendedor', perfis: [], ...jornadaDoForm(null, padrao) });

export function formularioDoUsuario(u: UsuarioItem, padrao: HorarioAlmoco = ALMOCO_PADRAO_EMPRESA): FormularioUsuario {
  return { ...jornadaDoForm(u, padrao), nome: u.nome, nome_curto: u.nome_curto ?? '', email: u.email, perfil: u.perfil, perfis: u.perfis.length > 0 ? u.perfis.map((p) => p.codigo) : [u.perfil], equipe_id: u.equipe_id ?? '', external_id: u.external_id ?? '', senha: '', limita_item: u.desconto_limita_item, limita_pedido: u.desconto_limita_pedido, desconto_maximo_pedido: textoDoPermil(u.desconto_maximo_pedido_permil), supervisor_id: u.supervisor_id ?? '', gerente_id: u.gerente_id ?? '', equipe_nome: u.cargo === 'supervisor' ? (u.equipe_nome ?? '') : '' };
}

const ouNulo = (v: string): string | null => (v.trim() === '' ? null : v.trim());

/** Cargo, gerente e situação de cada usuário da lista: quem pode ser escolhido como supervisor ou gerente. */
export const pessoasDaLista = (itens: readonly UsuarioItem[]): PessoaDaHierarquia[] => itens.map((u) => ({ id: u.id, cargo: u.cargo ?? null, gerente_id: u.gerente_id ?? null, ativo: u.ativo }));

/** Opções do select de Supervisor ou Gerente: ativos do cargo, por nome; o supervisor do promotor só entre os do gerente escolhido. */
export function opcoesDeChefia(itens: readonly UsuarioItem[], cargo: 'supervisor' | 'gerente', doGerente = ''): UsuarioItem[] {
  return itens.filter((u) => u.ativo && u.cargo === cargo && (!doGerente || u.gerente_id === doGerente)).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
}

const hierarquiaDoForm = (f: FormularioUsuario, cargo: Cargo | null) => hierarquiaDoCargo(cargo, { supervisor_id: ouNulo(f.supervisor_id), gerente_id: ouNulo(f.gerente_id), equipe_nome: ouNulo(f.equipe_nome) });

/**
 * Erros por campo, em português; vazio = pode enviar. Na criação a senha inicial é obrigatória. Com `hierarquia` (cargo do perfil
 * escolhido e as pessoas da lista), confere também supervisor, gerente, nome da equipe (RN-CORE-55/56) e código no ERP (RN-CORE-57), como a API.
 */
export function errosDoFormulario(f: FormularioUsuario, modo: 'criar' | 'editar', hierarquia?: { cargo: Cargo | null; pessoas: readonly PessoaDaHierarquia[] }): ErroDeCampo[] {
  const erros = validarDadosDeUsuario({ nome: f.nome, email: f.email, perfil: f.perfil, external_id: f.external_id.trim() === '' ? null : f.external_id });
  if (f.perfis.length === 0) erros.push({ campo: 'perfil', mensagem: ERRO_SEM_PERFIL });
  // RN-VEN-11a: o número só é exigido com "por pedido" ligada (desligada, o valor fica guardado)
  if (f.limita_pedido) {
    const permil = permilDoTexto(f.desconto_maximo_pedido);
    if (f.desconto_maximo_pedido.trim() === '') erros.push({ campo: 'desconto_maximo_pedido', mensagem: ERRO_DESCONTO_OBRIGATORIO });
    else if (permil === null || permil > DESCONTO_PEDIDO_PERMIL_MAX) erros.push({ campo: 'desconto_maximo_pedido', mensagem: ERRO_DESCONTO_FAIXA });
  }
  // RN-CORE-44 (D5): horário próprio só na edição; fim > início e de 15 min a 3 h; o erro vem ao salvar, no texto do campo
  if (modo === 'editar' && !f.almoco_padrao) {
    const h = lerHorarioAlmocoTexto(f.almoco_inicio, f.almoco_fim);
    if (!h.ok) {
      if (h.erros.inicio) erros.push({ campo: 'almoco_inicio', mensagem: h.erros.inicio });
      if (h.erros.fim) erros.push({ campo: 'almoco_fim', mensagem: h.erros.fim });
    }
  }
  if (modo === 'criar') {
    const fraca = validarSenhaInicial(f.senha, f.email);
    if (fraca) erros.push({ campo: 'senha', mensagem: fraca });
  }
  if (hierarquia) {
    for (const e of errosDaHierarquia(hierarquia.cargo, hierarquiaDoForm(f, hierarquia.cargo), hierarquia.pessoas)) erros.push({ campo: e.campo, mensagem: e.mensagem });
    const erp = erroDoCodigoErp(f.external_id);
    if (erp) erros.push({ campo: erp.campo, mensagem: erp.mensagem });
  }
  return erros;
}

/** Corpo com a hierarquia só do que o cargo usa (`cargo` ausente = sem hierarquia, como antes da 0069). */
const corpoDaHierarquia = (f: FormularioUsuario, cargo: Cargo | null | undefined) => (cargo === undefined ? {} : hierarquiaDoForm(f, cargo));

export function corpoDeCriacao(f: FormularioUsuario, cargo?: Cargo | null): CriarUsuarioRequest {
  return {
    nome: f.nome.trim(),
    nome_curto: ouNulo(f.nome_curto),
    email: f.email.trim(),
    perfis: f.perfis,
    equipe_id: ouNulo(f.equipe_id),
    external_id: ouNulo(f.external_id),
    ativo: true,
    senha: f.senha,
    supervisor_id: null,
    gerente_id: null,
    equipe_nome: null,
    ...corpoDoLimite(f),
    ...corpoDaHierarquia(f, cargo),
  };
}

export function corpoDeEdicao(f: FormularioUsuario, cargo?: Cargo | null): EditarUsuarioRequest {
  const h = f.almoco_padrao ? null : lerHorarioAlmocoTexto(f.almoco_inicio, f.almoco_fim);
  const almoco = h?.ok ? { almoco_inicio_min: h.inicio_min, almoco_fim_min: h.fim_min } : { almoco_inicio_min: null, almoco_fim_min: null };
  return { ...almoco, nome: f.nome.trim(), nome_curto: ouNulo(f.nome_curto), email: f.email.trim(), perfis: f.perfis, equipe_id: ouNulo(f.equipe_id), external_id: ouNulo(f.external_id), ...corpoDoLimite(f), ...corpoDaHierarquia(f, cargo) };
}

/** A API só fala ‰; o valor guardado vai mesmo com "por pedido" desligada. */
function corpoDoLimite(f: FormularioUsuario) {
  const permil = permilDoTexto(f.desconto_maximo_pedido);
  return { desconto_limita_item: f.limita_item, desconto_limita_pedido: f.limita_pedido, desconto_maximo_pedido_permil: permil !== null && permil <= DESCONTO_PEDIDO_PERMIL_MAX ? permil : null };
}

/** Superior resultante da equipe escolhida, para mostrar no formulário (o superior não é campo: deriva da equipe). */
export function textoDoSuperiorDaEquipe(equipes: readonly EquipeOpcao[], equipeId: string): string {
  if (!equipeId) return 'Sem equipe: sem superior imediato.';
  const e = equipes.find((x) => x.id === equipeId);
  if (!e) return 'Equipe não encontrada.';
  return e.superior_nome ? `Superior imediato: ${e.superior_nome} (responsável da equipe).` : 'Esta equipe não tem responsável definido: sem superior imediato.';
}

// ---------- T-0094: senha por e-mail, troca no 1º acesso, "Redefinir senha" / "Enviar acesso" (RN-CORE-34; docs/design/ciclo-de-senha.md §5) ----------

/** Faltas da senha digitada (campo vazio = as quatro), para o componente `RegrasDaSenha`. */
export const faltasDaSenhaDigitada = (senha: string): FaltaNaSenha[] => faltasNaSenha(senha);

/** "Gerar senha": 12 caracteres sem ambíguos, gerada no navegador com `crypto.getRandomValues` (mesma regra do servidor). */
export function gerarSenhaNoNavegador(aleatorio: (n: number) => Uint8Array = (n) => globalThis.crypto.getRandomValues(new Uint8Array(n))): string {
  return gerarSenhaTemporaria(aleatorio);
}

export interface EtiquetaDeSenha {
  texto: string;
  tom: 'warning' | 'danger' | 'neutral';
}

/** Etiqueta da coluna de situação, depois de Ativo/Inativo. Nenhuma para senha definitiva. */
export function etiquetaDeSenha(u: Pick<UsuarioItem, 'sem_senha' | 'trocar_senha' | 'senha_expira_em'>, fuso: string, agora: Date = new Date()): EtiquetaDeSenha | null {
  if (u.sem_senha) return { texto: 'Sem senha', tom: 'neutral' };
  if (!u.trocar_senha) return null;
  if (!u.senha_expira_em) return { texto: 'Troca de senha pendente', tom: 'warning' };
  if (new Date(u.senha_expira_em).getTime() <= agora.getTime()) return { texto: 'Senha temporária vencida', tom: 'danger' };
  return { texto: `Troca de senha pendente · vence em ${formatDateTime(u.senha_expira_em, fuso)}`, tom: 'warning' };
}

export type RotuloAcaoDeSenha = 'Redefinir senha' | 'Enviar acesso';

/** Ação de senha da linha: nunca para admin (P7: admin recupera pelo "Esqueci a senha"); "Enviar acesso" para quem não tem senha. */
export function acaoDeSenha(u: Pick<UsuarioItem, 'perfil' | 'ativo' | 'sem_senha' | 'perfis'>): { rotulo: RotuloAcaoDeSenha } | null {
  // P7: perfil de base admin nunca tem a senha redefinida por aqui (os perfis de hoje são os de fábrica: código = base)
  if (temPerfilDeBase(u.perfis.length > 0 ? u.perfis : [{ base: u.perfil }], 'admin') || !u.ativo) return null;
  return { rotulo: u.sem_senha ? 'Enviar acesso' : 'Redefinir senha' };
}

/** Corpo do `PUT usuarios/:id/senha`: "Enviar acesso" não leva senha (o servidor gera e manda por e-mail). */
export const corpoDeRedefinicao = (senha: string): { senha?: string } => (senha === '' ? {} : { senha });

export type ResultadoDoEmail =
  | { tipo: 'enviado'; texto: string }
  /** E-mail não saiu: o aviso fica no topo da lista e mostra a senha UMA vez (da memória do formulário). */
  | { tipo: 'sem_email'; antes: string; senha: string; depois: string };

/** Depois de criar: toast quando o e-mail foi na fila; aviso com a senha quando não foi. */
export function resultadoDeCriar(email: EmailAcesso, destino: string, senha: string): ResultadoDoEmail {
  if (email === 'indisponivel') return { tipo: 'sem_email', antes: 'Usuário criado, mas não conseguimos enviar o e-mail. Passe a senha à pessoa: ', senha, depois: '.' };
  return { tipo: 'enviado', texto: `Usuário criado. O acesso vai para ${destino}.` };
}

/** Depois de redefinir (com senha definida na tela). */
export function resultadoDeRedefinir(email: EmailAcesso, destino: string, senha: string): ResultadoDoEmail {
  if (email === 'indisponivel') return { tipo: 'sem_email', antes: 'Senha redefinida, mas não conseguimos enviar o e-mail. Passe a senha à pessoa: ', senha, depois: '.' };
  return { tipo: 'enviado', texto: `Senha redefinida e enviada para ${destino}.` };
}

export const textoAcessoEnviado = (destino: string): string => `Acesso enviado para ${destino}.`;
export const TEXTO_ENVIAR_ACESSO_SEM_EMAIL = 'Não conseguimos enviar o e-mail. Use "Redefinir senha" para definir uma senha e passá-la à pessoa.';
export const TEXTO_SENHA_NAO_REDEFINIVEL = 'Esta senha não pode ser redefinida aqui. O administrador usa "Esqueci a senha".';

// ---------------------------------------------------------------- bloqueio do login (docs/design/telas/usuario-bloqueio.md)

export interface SeloDoUsuario {
  tom: 'neutral' | 'danger' | 'warning';
  texto: string;
  /** Selo de bloqueio: a linha ganha "Desbloquear" (o inativo se resolve com "Reativar"). */
  bloqueado: boolean;
}

/**
 * O selo único da linha (§2): Inativo > Bloqueado > Bloqueado até HHhMM (hora no fuso do tenant). O bloqueio por tentativas
 * vencido não tem selo: a tela compara com a hora atual, e o login (`estadoDoLogin`) já deixa entrar.
 */
export function seloDoUsuario(u: Pick<UsuarioItem, 'ativo' | 'bloqueio' | 'bloqueio_ate'>, agora: Date, fuso: string): SeloDoUsuario | null {
  if (!u.ativo) return { tom: 'neutral', texto: 'Inativo', bloqueado: false };
  if (u.bloqueio === 'admin') return { tom: 'danger', texto: 'Bloqueado', bloqueado: true };
  if (u.bloqueio === 'tentativas' && u.bloqueio_ate && new Date(u.bloqueio_ate).getTime() > agora.getTime()) return { tom: 'warning', texto: `Bloqueado até ${formatTime(u.bloqueio_ate, fuso).replace(':', 'h')}`, bloqueado: true };
  return null;
}

