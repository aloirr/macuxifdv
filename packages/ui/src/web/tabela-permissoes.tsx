/**
 * Perfis (ADR 0073, etapa E5): kit da tabela de permissões de um perfil. Spec e prints aprovados:
 * docs/design/simulacoes/2026-11-24/perfis-tabela.md e docs/design/telas/perfis-tabela-kit.md.
 * Só apresentação, sem hooks, sem regra e sem API: a tela (modulo-core) diz o que está marcado, travado, sem licença, o nível,
 * os alvos e quais grupos estão abertos; o kit desenha, conta e fala.
 *
 * - `TabelaPermissoes`: aviso único no topo (autogestão), busca e os grupos por área, na ordem recebida.
 * - `GrupoPermissoes`: cabeçalho com caixa tri-estado (`aria-checked="mixed"`), seta, título, "Sem licença" e "n de m ligadas".
 * - `LinhaPermissao`: caixa à esquerda do nome; à direita o cadeado com o motivo escrito, ou o slot (nível, "de quem").
 * - `SeletorEscopo`: segmentado de escopo (rádios nativos: as setas andam e pulam os níveis acima do teto, com cadeado).
 * - `CaixaMarcar`: a caixa de 20 px num alvo de 44 px (`role="checkbox"`, espaço liga/desliga).
 */
import type { ReactNode } from 'react';
import { IconCheck, IconChevronDown, IconChevronRight, IconLock } from './icons';
import {
  ariaCheckedDaCaixa,
  contagemDoGrupo,
  estadoDaCaixaDoGrupo,
  mudancasDaCaixaDoGrupo,
  niveisAcimaDoTeto,
  ROTULO_BUSCA_PERMISSAO,
  rotuloDaCaixaDoGrupo,
  rotuloDaSetaDoGrupo,
  SELO_SEM_LICENCA,
  TEXTO_SEM_RESULTADO,
  textoDaContagem,
  type EstadoDaCaixa,
  type NivelDeEscopo,
} from './tabela-permissoes-estado';
import { Badge, CampoBusca, cx, Notice } from './ui';

export * from './tabela-permissoes-estado';

/**
 * Cores da caixa (tokens do globals.css do BKO). A travada marcada usa `field` (#7A8593: ✓ branco a 3,75:1), não
 * `disabled` (#8B96A3: 3,00:1, no limite, observação 1 da auditoria de marca de 24/11).
 */
export const CLASSES_CAIXA = {
  marcada: 'border-accent bg-accent text-on-accent',
  vazia: 'border-field bg-surface',
  travadaMarcada: 'border-field bg-field text-white',
  travadaVazia: 'border-line bg-line-2',
} as const;

/** Cores de fundo/✓ da caixa, para o teste de contraste. */
export const CORES_CAIXA = { marcada: '#1E3350', travadaMarcada: '#7A8593', check: '#FFFFFF' } as const;

const sem = () => undefined;

/* ---------- caixa ---------- */

export function CaixaMarcar({
  estado,
  onAlternar,
  desabilitada = false,
  rotulo,
  rotuloId,
  descricaoId,
  testId = 'caixa',
}: {
  estado: boolean | 'mixed';
  onAlternar: () => void;
  /** Travada ou sem licença: continua focável (o leitor de tela lê o motivo), mas o clique não muda nada. */
  desabilitada?: boolean;
  rotulo?: string;
  rotuloId?: string;
  descricaoId?: string;
  testId?: string;
}) {
  const cheia = estado !== false;
  const cor = desabilitada ? (cheia ? CLASSES_CAIXA.travadaMarcada : CLASSES_CAIXA.travadaVazia) : cheia ? CLASSES_CAIXA.marcada : CLASSES_CAIXA.vazia;
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={estado}
      aria-disabled={desabilitada || undefined}
      aria-label={rotuloId ? undefined : rotulo}
      aria-labelledby={rotuloId}
      aria-describedby={descricaoId}
      onClick={desabilitada ? sem : onAlternar}
      data-testid={testId}
      data-estado={estado === 'mixed' ? 'parte' : estado ? 'marcada' : 'vazia'}
      className={cx(
        'group -m-3 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-[10px] focus-visible:outline-2 focus-visible:outline-offset-[-6px] focus-visible:outline-accent',
        desabilitada ? 'cursor-not-allowed' : 'cursor-pointer',
      )}
    >
      <span
        aria-hidden="true"
        className={cx(
          'inline-flex h-5 w-5 items-center justify-center rounded-[5px] border-[1.5px] transition-transform duration-[120ms] motion-reduce:transition-none',
          !desabilitada && 'group-active:scale-[0.97]',
          cor,
        )}
      >
        {estado === 'mixed' ? <span className="h-[2px] w-2.5 rounded bg-current" /> : estado ? <IconCheck size={14} /> : null}
      </span>
    </button>
  );
}

/* ---------- linha ---------- */

/** Ids derivados de uma linha da tabela. */
export const idsDaLinhaTabela = (id: string) => ({ rotulo: `${id}-rotulo`, motivo: `${id}-motivo`, descricao: `${id}-descricao` });

export interface PropsLinhaPermissao {
  /** Base dos ids (único na página). */
  id: string;
  rotulo: string;
  marcada: boolean;
  onAlternar: (marcada: boolean) => void;
  /** Linha menor embaixo do nome (ex.: o teto do cargo na linha de Dados). */
  descricao?: ReactNode;
  /** Cadeado com o motivo escrito à direita (ex.: "Vendedor nunca entra no BKO"). Na autogestão, passe `motivo` vazio e o aviso no topo. */
  trava?: { motivo?: string } | null;
  /** Grupo sem licença: a linha fica desabilitada, com o valor guardado. */
  semLicenca?: boolean;
  /** Marcada, mas sem efeito (ex.: "Sem efeito: o perfil não entra no BKO"): acinzentada, com o texto à direita. */
  semEfeito?: string;
  /** Slot à direita: `SeletorEscopo`, "de quem" com "Mudar". Sem caixa quando `semCaixa`. */
  direita?: ReactNode;
  /** Linha só de controle à direita (Dados: o nível é o valor). */
  semCaixa?: boolean;
  testId?: string;
}

export function LinhaPermissao({ id, rotulo, marcada, onAlternar, descricao, trava, semLicenca = false, semEfeito, direita, semCaixa = false, testId }: PropsLinhaPermissao) {
  const ids = idsDaLinhaTabela(id);
  const tid = testId ?? `permissao.${id}`;
  const desabilitada = !!trava || semLicenca;
  const motivo = trava?.motivo || semEfeito;
  const comMotivo = !!trava || !!semEfeito;
  const descricaoIds = [descricao && ids.descricao, motivo && ids.motivo].filter(Boolean).join(' ') || undefined;
  return (
    <div
      role="listitem"
      className={cx('flex min-h-12 flex-wrap items-center gap-x-4 gap-y-1 border-b border-line-2 py-1.5 pr-4 pl-4 last:border-b-0', semEfeito && 'bg-ground')}
      data-testid={tid}
      data-travada={trava ? 'sim' : undefined}
    >
      <div className="flex min-w-[120px] flex-1 basis-0 items-center gap-3">
        {!semCaixa && (
          <CaixaMarcar
            estado={marcada}
            onAlternar={() => onAlternar(!marcada)}
            desabilitada={desabilitada}
            rotuloId={ids.rotulo}
            descricaoId={descricaoIds}
            testId={`${tid}.caixa`}
          />
        )}
        <div className="flex min-w-0 flex-col">
          <span id={ids.rotulo} className={cx('text-[15px] [overflow-wrap:anywhere]', desabilitada || semEfeito ? 'text-ink-2' : 'text-ink')}>
            {rotulo}
          </span>
          {descricao && (
            <span id={ids.descricao} className="text-[12px] text-ink-2">
              {descricao}
            </span>
          )}
        </div>
      </div>
      {comMotivo && (
        <span id={ids.motivo} className="ml-auto inline-flex shrink-0 items-center gap-1.5 text-[12px] text-ink-2" data-testid={`${tid}.motivo`}>
          {trava && <IconLock size={13} className="shrink-0" />}
          {trava && motivo ? <span className="sr-only">Travado: </span> : null}
          {motivo}
        </span>
      )}
      {direita && <div className="ml-auto shrink-0">{direita}</div>}
    </div>
  );
}

/* ---------- grupo ---------- */

export interface LinhaDaTabela extends Omit<PropsLinhaPermissao, 'onAlternar' | 'semLicenca'> {
  /** Para a contagem e a caixa do grupo. */
  travada?: boolean;
}

export interface GrupoDaTabela {
  id: string;
  titulo: string;
  linhas: readonly LinhaDaTabela[];
  /** Módulo sem licença: selo "Sem licença" e a frase (`textoSemLicenca`); linhas desabilitadas. */
  semLicenca?: { mensagem: string } | null;
  /** Grupo sem caixa no cabeçalho (ex.: Dados, que só tem o nível). */
  semCaixa?: boolean;
}

export function GrupoPermissoes({
  id,
  titulo,
  contagem,
  estadoCaixa,
  onCaixa,
  aberto,
  onAlternarAberto,
  semLicenca,
  semCaixa = false,
  children,
  testId,
}: {
  id: string;
  titulo: string;
  /** `contagemDoGrupo(linhas)`; ausente esconde o "n de m ligadas". */
  contagem?: { ligadas: number; total: number };
  /** `estadoDaCaixaDoGrupo(linhas)`. */
  estadoCaixa: EstadoDaCaixa;
  onCaixa: () => void;
  aberto: boolean;
  onAlternarAberto: () => void;
  semLicenca?: { mensagem: string } | null;
  semCaixa?: boolean;
  children: ReactNode;
  testId?: string;
}) {
  const tid = testId ?? `grupo.${id}`;
  const painelId = `${id}-linhas`;
  const tituloId = `${id}-titulo`;
  const avisoId = semLicenca ? `${id}-licenca` : undefined;
  const Seta = aberto ? IconChevronDown : IconChevronRight;
  return (
    <section aria-labelledby={tituloId} className="border-b border-line last:border-b-0" data-testid={tid} data-aberto={aberto ? 'sim' : 'nao'}>
      <div className="flex min-h-12 items-center gap-3 bg-ground py-1 pr-4 pl-4">
        {semCaixa ? (
          <span className="w-5 shrink-0" />
        ) : (
          <CaixaMarcar
            estado={ariaCheckedDaCaixa(estadoCaixa)}
            onAlternar={onCaixa}
            desabilitada={estadoCaixa === 'sem-livres'}
            rotulo={rotuloDaCaixaDoGrupo(titulo)}
            descricaoId={avisoId}
            testId={`${tid}.caixa`}
          />
        )}
        <button
          type="button"
          aria-expanded={aberto}
          aria-controls={painelId}
          aria-label={rotuloDaSetaDoGrupo(titulo, aberto)}
          onClick={onAlternarAberto}
          className="-my-1 flex min-h-11 flex-1 items-center gap-2 rounded-[10px] px-1 text-left focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent"
          data-testid={`${tid}.seta`}
        >
          <Seta size={16} className="shrink-0 text-ink-2" />
          <h3 id={tituloId} className="m-0 text-[15px] font-semibold text-ink">
            {titulo}
          </h3>
          {semLicenca && <Badge tone="warning">{SELO_SEM_LICENCA}</Badge>}
          {contagem && (
            <span className="ml-auto text-[12px] font-semibold text-ink-2 tabular-nums" data-testid={`${tid}.contagem`}>
              {textoDaContagem(contagem.ligadas, contagem.total)}
            </span>
          )}
        </button>
      </div>
      {semLicenca && aberto && (
        <p id={avisoId} className="m-0 border-t border-line-2 py-2 pr-4 pl-[52px] text-[12px] text-ink-2" data-testid={`${tid}.licenca`}>
          {semLicenca.mensagem}
        </p>
      )}
      {semLicenca && !aberto && (
        <span id={avisoId} className="sr-only">
          {semLicenca.mensagem}
        </span>
      )}
      <div id={painelId} role="list" aria-labelledby={tituloId} hidden={!aberto}>
        {aberto && children}
      </div>
    </section>
  );
}

/* ---------- tabela ---------- */

export function TabelaPermissoes({
  grupos,
  abertos,
  onAlternarAberto,
  onAlternarLinha,
  onMarcarVarias,
  aviso,
  busca,
  onBusca,
  testId = 'tabela-permissoes',
}: {
  /** Grupos já filtrados pela busca (`filtrarGruposPorBusca`), na ordem da ADR. */
  grupos: readonly GrupoDaTabela[];
  /** Ids dos grupos abertos (a tela guarda; com busca, abra todos). */
  abertos: ReadonlySet<string> | readonly string[];
  onAlternarAberto: (grupoId: string) => void;
  onAlternarLinha: (linhaId: string, marcada: boolean) => void;
  /** Caixa do grupo: só as livres que mudam (`mudancasDaCaixaDoGrupo`). */
  onMarcarVarias: (grupoId: string, mudancas: Record<string, boolean>) => void;
  /** Aviso único no topo (autogestão: "Você usa este perfil…"). Não repita o motivo nas linhas. */
  aviso?: ReactNode;
  /** Busca no topo; sem `onBusca`, o campo não aparece. */
  busca?: string;
  onBusca?: (texto: string) => void;
  testId?: string;
}) {
  const aberto = (id: string) => (Array.isArray(abertos) ? (abertos as readonly string[]).includes(id) : (abertos as ReadonlySet<string>).has(id));
  return (
    <div className="flex flex-col gap-3" data-testid={testId}>
      {aviso && (
        <Notice tone="info" className="text-[15px]">
          {aviso}
        </Notice>
      )}
      {onBusca && (
        <CampoBusca
          rotulo={ROTULO_BUSCA_PERMISSAO}
          value={busca ?? ''}
          onChange={(e) => onBusca(e.currentTarget.value)}
          className="sm:w-full"
          data-testid={`${testId}.busca`}
        />
      )}
      {grupos.length === 0 ? (
        <p className="m-0 rounded-[12px] border border-line bg-surface px-4 py-6 text-center text-[15px] text-ink-2" data-testid={`${testId}.vazio`}>
          {TEXTO_SEM_RESULTADO}
        </p>
      ) : (
        <div className="overflow-hidden rounded-[12px] border border-line bg-surface">
          {grupos.map((g) => {
            const linhas = g.linhas.map((l) => ({ id: l.id, marcada: l.marcada, travada: l.travada ?? !!l.trava, semLicenca: !!g.semLicenca }));
            return (
              <GrupoPermissoes
                key={g.id}
                id={g.id}
                titulo={g.titulo}
                contagem={g.semCaixa ? undefined : contagemDoGrupo(linhas)}
                estadoCaixa={estadoDaCaixaDoGrupo(linhas, !!g.semLicenca)}
                onCaixa={() => onMarcarVarias(g.id, mudancasDaCaixaDoGrupo(linhas, !!g.semLicenca))}
                aberto={aberto(g.id)}
                onAlternarAberto={() => onAlternarAberto(g.id)}
                semLicenca={g.semLicenca}
                semCaixa={g.semCaixa}
                testId={`${testId}.${g.id}`}
              >
                {g.linhas.map((l) => (
                  <LinhaPermissao key={l.id} {...l} semLicenca={!!g.semLicenca} onAlternar={(v) => onAlternarLinha(l.id, v)} testId={`${testId}.${g.id}.${l.id}`} />
                ))}
              </GrupoPermissoes>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ---------- segmentado de escopo ---------- */

export function SeletorEscopo({
  nome,
  niveis,
  valor,
  onChange,
  teto,
  motivoTeto,
  rotulo,
  rotuloId,
  descricaoId,
  desabilitado = false,
  testId = 'escopo',
}: {
  /** `name` dos rádios (único na página). */
  nome: string;
  /** Na ordem, do menor ao maior (Carteira própria, Equipe, Equipes abaixo, Toda a empresa). */
  niveis: readonly NivelDeEscopo[];
  valor: string;
  onChange: (valor: string) => void;
  /** Teto do cargo: os níveis depois dele ficam com cadeado e as setas os pulam. */
  teto?: string | null;
  /** `textoDoTeto(cargo, rotulo)`; falado em cada nível travado (a tela escreve o mesmo texto na `descricao` da linha). */
  motivoTeto?: string;
  rotulo?: string;
  rotuloId?: string;
  descricaoId?: string;
  desabilitado?: boolean;
  testId?: string;
}) {
  const acima = niveisAcimaDoTeto(niveis, teto);
  return (
    <div
      role="radiogroup"
      aria-label={rotuloId ? undefined : rotulo}
      aria-labelledby={rotuloId}
      aria-describedby={descricaoId}
      aria-disabled={desabilitado || undefined}
      className="inline-flex flex-wrap rounded-[10px] border border-line bg-line-2 p-[2px]"
      data-testid={testId}
    >
      {niveis.map((n) => {
        const travado = acima.has(n.valor);
        const off = desabilitado || travado;
        return (
          <label key={n.valor} className={cx('relative', off ? 'cursor-not-allowed' : 'cursor-pointer')} data-travado={travado ? 'sim' : undefined}>
            <input
              type="radio"
              name={nome}
              value={n.valor}
              checked={n.valor === valor}
              disabled={off}
              onChange={() => onChange(n.valor)}
              className="peer sr-only"
              data-testid={`${testId}.${n.valor}`}
            />
            <span
              className={cx(
                'inline-flex min-h-11 items-center gap-1 rounded-[8px] px-3 text-[13px] font-semibold whitespace-nowrap',
                'peer-checked:bg-accent peer-checked:text-on-accent peer-focus-visible:outline-2 peer-focus-visible:outline-offset-1 peer-focus-visible:outline-accent',
                travado ? 'text-ink-2' : 'text-ink-3',
                !off && 'hover:bg-surface peer-checked:hover:bg-accent',
              )}
            >
              {travado && <IconLock size={12} className="shrink-0" />}
              {n.rotulo}
              {travado && motivoTeto && <span className="sr-only">{`, travado: ${motivoTeto}`}</span>}
            </span>
          </label>
        );
      })}
    </div>
  );
}
