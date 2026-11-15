/**
 * Filial do usuário no BKO (T-0176, RN-CORE-39; simulação aprovada R-20261115-104500, `docs/design/filial-cadastro-venda/spec.md` §2 e §3).
 * Funções puras da gaveta (filial de cadastro + filiais de venda) e da lista (coluna, filtro e aviso). Sem React e sem rede; a API revalida.
 */
import type { UsuarioItem } from '../../contracts';

export interface FilialOpcao {
  id: string;
  nome: string;
}

export const ERRO_FILIAL_CADASTRO = 'Escolha a filial de cadastro.';
export const ROTULO_FILIAL_DE_CADASTRO = 'filial de cadastro';
export const FILTRO_FILIAL_SEM = 'sem';
export const SELO_SEM_FILIAL = 'Sem filial';

/** Ordem alfabética (pt-BR, sem distinguir acento nem caixa). */
export const filiaisEmOrdem = <T extends FilialOpcao>(filiais: readonly T[]): T[] => [...filiais].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR', { sensitivity: 'base' }));

export interface FiliaisDoForm {
  filial_cadastro_id: string;
  filial_venda_ids: string[];
}

/** Escolher a filial de cadastro marca a nova (que fica travada); a antiga continua marcada. */
export function escolherCadastro(f: FiliaisDoForm, id: string): FiliaisDoForm {
  const venda = id && !f.filial_venda_ids.includes(id) ? [...f.filial_venda_ids, id] : f.filial_venda_ids;
  return { filial_cadastro_id: id, filial_venda_ids: venda };
}

/** Marca ou desmarca uma filial de venda; a de cadastro não sai (travada). */
export function alternarVenda(f: FiliaisDoForm, id: string): FiliaisDoForm {
  if (id === f.filial_cadastro_id) return f;
  const venda = f.filial_venda_ids.includes(id) ? f.filial_venda_ids.filter((x) => x !== id) : [...f.filial_venda_ids, id];
  return { ...f, filial_venda_ids: venda };
}

export const vendaTravada = (f: FiliaisDoForm, id: string): boolean => id !== '' && id === f.filial_cadastro_id;

/** "Boa Vista, filial de cadastro, marcada, indisponível" (leitor de tela; spec §2). */
export function descricaoParaLeitor(nome: string, f: FiliaisDoForm, id: string): string {
  const partes = [nome];
  if (vendaTravada(f, id)) partes.push(ROTULO_FILIAL_DE_CADASTRO);
  partes.push(f.filial_venda_ids.includes(id) ? 'marcada' : 'desmarcada');
  if (vendaTravada(f, id)) partes.push('indisponível');
  return partes.join(', ');
}

/** O erro do campo "Filial de cadastro": obrigatória quando quem edita pode informá-la. */
export const erroDaFilialCadastro = (f: Pick<FiliaisDoForm, 'filial_cadastro_id'>, aplica: boolean): string | undefined => (aplica && !f.filial_cadastro_id ? ERRO_FILIAL_CADASTRO : undefined);

/** Corpo da API: só quem tem `usuario.filial_editar` envia os dois campos (a API inclui a de cadastro na lista de venda). */
export function corpoDaFilial(f: FiliaisDoForm, aplica: boolean): { filial_cadastro_id?: string; filial_venda_ids?: string[] } {
  return aplica && f.filial_cadastro_id ? { filial_cadastro_id: f.filial_cadastro_id, filial_venda_ids: f.filial_venda_ids } : {};
}

export function filiaisDoUsuario(u: Pick<UsuarioItem, 'filial_cadastro_id' | 'filial_venda_ids'>): FiliaisDoForm {
  const cadastro = u.filial_cadastro_id ?? '';
  return escolherCadastro({ filial_cadastro_id: '', filial_venda_ids: [...(u.filial_venda_ids ?? [])] }, cadastro);
}

// ---------------------------------------------------------------- lista

type ComFilial = Pick<UsuarioItem, 'filial_cadastro_id' | 'sem_filial'>;
export const estaSemFilial = (u: ComFilial): boolean => u.sem_filial === true || !u.filial_cadastro_id;

/** Filtro "Filial de cadastro": '' = Todas, 'sem' = Sem filial, senão o id da filial. */
export function filtrarPorFilial<T extends ComFilial>(itens: readonly T[], filtro: string): T[] {
  if (!filtro) return [...itens];
  if (filtro === FILTRO_FILIAL_SEM) return itens.filter(estaSemFilial);
  return itens.filter((u) => u.filial_cadastro_id === filtro);
}

/** Com o filtro "Sem filial" a coluna sai: todas as linhas diriam o mesmo. */
export const mostraColunaFilial = (filtro: string): boolean => filtro !== FILTRO_FILIAL_SEM;

export const nomeDaFilialDe = (u: ComFilial, filiais: readonly FilialOpcao[]): string | null => (estaSemFilial(u) ? null : (filiais.find((f) => f.id === u.filial_cadastro_id)?.nome ?? null));

export interface AvisoSemFilial {
  texto: string;
  botao: string;
}

/** Aviso do topo: só quando há usuário sem filial e o filtro não é "Sem filial". */
export function avisoSemFilial(semFilial: number, filtro: string): AvisoSemFilial | null {
  if (semFilial <= 0 || filtro === FILTRO_FILIAL_SEM) return null;
  return semFilial === 1
    ? { texto: '1 usuário sem filial de cadastro não entra no app.', botao: 'Ver o 1' }
    : { texto: `${semFilial} usuários sem filial de cadastro não entram no app.`, botao: `Ver os ${semFilial}` };
}
