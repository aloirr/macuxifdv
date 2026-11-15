/**
 * T-0111 (ADR 0033, RN-CORE-35): peças da página "Perfis de acesso" do BKO e do campo "Perfis" do formulário de usuário.
 * Spec: docs/design/perfis-de-acesso.md §9. Sem hooks e sem regra: a tela decide o valor, a trava e o que está desabilitado
 * (pelo SDK, `travaDaChave`, e pelo domain do Core); o kit só desenha e fala. Os testes chamam os componentes como função.
 *
 * - `Cadeado`: ícone de cadeado que mostra a regra ao passar o mouse, ao focar com o teclado ou ao tocar (o toque liga o :hover
 *   no iOS e o foco no Android); o texto também vai como descrição para o leitor de tela.
 * - `Interruptor`: liga/desliga com "Sim"/"Não" escrito ao lado (cor nunca sozinha), `role="switch"`, alvo de 44 px. Com
 *   `estadoEscrito="so-desligada"` (liga/desliga geral da regra, T-0180): ligado sem texto; desligado com o selo neutro "Desligada".
 * - `SeletorDeNivel`: escolha de um nível em botões lado a lado (rádios nativos: as setas do teclado andam entre eles). Opção
 *   desabilitada leva o motivo, falado na própria opção e escrito embaixo do grupo com o cadeado.
 * - `LinhaDePermissao`: rótulo, ajuda, cadeado e o controle à direita; "Padrão: X" quando o valor difere do de fábrica.
 * - `SeletorDePerfis`: seleção múltipla de perfis (alvos da redefinição de senha e o campo "Perfis" do usuário).
 * - `ResumoDasMudancas`: o "o que mudou" antes de salvar e no histórico, agrupado por seção.
 */
import type { ReactNode } from 'react';
import { CLASSES_DESTAQUE } from './cores';
import { IconLock } from './icons';
import {
  agruparMudancas,
  ALVO_TODOS_PERFIS,
  contagemDeMudancas,
  ROTULO_CADEADO,
  TEXTO_INTERRUPTOR,
  textoDaMudanca,
  textoDosAfetados,
  textoFaladoDaMudanca,
  type MudancaDePermissao,
} from './perfis';
import { Badge, cx } from './ui';

export * from './perfis';

/** Ids derivados de uma linha (para `aria-labelledby` e `aria-describedby` do controle que a tela põe dentro dela). */
export const idsDaLinha = (id: string) => ({ rotulo: `${id}-rotulo`, ajuda: `${id}-ajuda`, trava: `${id}-trava` });

/** Junta ids de descrição, sem vazios (`aria-describedby`). */
const juntarIds = (...ids: Array<string | false | null | undefined>): string | undefined => {
  const v = ids.filter(Boolean).join(' ');
  return v || undefined;
};

const sem = () => undefined;

/* ---------- cadeado ---------- */

export function Cadeado({ id, mensagem, className, testId = 'cadeado' }: { id: string; mensagem: string; className?: string; testId?: string }) {
  return (
    <span className={cx('group relative inline-flex shrink-0', className)} data-testid={testId}>
      <button
        type="button"
        aria-label={ROTULO_CADEADO}
        aria-describedby={id}
        onClick={sem}
        className="-my-2 inline-flex h-11 w-11 items-center justify-center rounded-[10px] text-ink-2 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-[-4px] focus-visible:outline-accent"
        data-testid={`${testId}.botao`}
      >
        <IconLock size={16} />
      </button>
      <span
        id={id}
        role="tooltip"
        className="pointer-events-none absolute top-full left-0 z-20 mt-1 hidden w-max max-w-[300px] rounded-[10px] bg-ink px-3 py-2 text-[12px] leading-snug font-medium text-white shadow-lg group-focus-within:block group-hover:block"
        data-testid={`${testId}.texto`}
      >
        {mensagem}
      </span>
    </span>
  );
}

/* ---------- interruptor ---------- */

export function Interruptor({
  ligado,
  onChange,
  misto = false,
  rotuloId,
  rotulo,
  descricaoId,
  desabilitado = false,
  id,
  testId = 'interruptor',
  estadoEscrito = 'sim-nao',
}: {
  ligado: boolean;
  onChange: (ligado: boolean) => void;
  /** Linha agrupada com chaves em valores diferentes: mostra "Em parte"; o toque liga todas. */
  misto?: boolean;
  /** Id do rótulo visível (o da `LinhaDePermissao`). Sem ele, passe `rotulo`. */
  rotuloId?: string;
  rotulo?: string;
  descricaoId?: string;
  /** Travado (cadeado) ou sem permissão de editar. */
  desabilitado?: boolean;
  id?: string;
  testId?: string;
  /**
   * O que fica escrito ao lado do trilho. `sim-nao` (padrão): "Sim"/"Não". `so-desligada` (liga/desliga geral de uma regra,
   * Parâmetros › Alertas, T-0180): ligado não escreve nada; desligado mostra o selo neutro "Desligada". O estado continua no
   * `aria-checked` para o leitor de tela.
   */
  estadoEscrito?: 'sim-nao' | 'so-desligada';
}) {
  const marcado = ligado && !misto;
  const texto = misto ? TEXTO_INTERRUPTOR.misto : ligado ? TEXTO_INTERRUPTOR.sim : TEXTO_INTERRUPTOR.nao;
  const soDesligada = estadoEscrito === 'so-desligada' && !misto;
  return (
    <button
      type="button"
      role="switch"
      id={id}
      aria-checked={marcado}
      aria-labelledby={rotuloId}
      aria-label={rotuloId ? undefined : rotulo}
      aria-describedby={descricaoId}
      disabled={desabilitado}
      onClick={() => onChange(!marcado)}
      data-testid={testId}
      data-estado={misto ? 'misto' : ligado ? 'sim' : 'nao'}
      className="group inline-flex h-11 shrink-0 items-center gap-2 rounded-[10px] px-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed"
    >
      <span
        aria-hidden="true"
        className={cx(
          'relative inline-block h-6 w-10 rounded-full transition-colors motion-reduce:transition-none',
          marcado ? 'bg-ink' : misto ? 'bg-ink-2' : 'bg-disabled',
          desabilitado && 'opacity-50',
        )}
      >
        <span
          className={cx(
            'absolute top-[3px] h-[18px] w-[18px] rounded-full bg-white shadow transition-[left] duration-[120ms] motion-reduce:transition-none',
            marcado ? 'left-[19px]' : misto ? 'left-[11px]' : 'left-[3px]',
          )}
        />
      </span>
      {soDesligada ? (
        marcado ? null : (
          <span aria-hidden="true" data-testid={`${testId}.desligada`}>
            <Badge tone="neutral">{TEXTO_INTERRUPTOR.desligada}</Badge>
          </span>
        )
      ) : (
        <span aria-hidden="true" className={cx('min-w-[52px] text-left text-[13px] font-semibold', desabilitado ? 'text-ink-2' : 'text-ink')}>
          {texto}
        </span>
      )}
    </button>
  );
}

/* ---------- seletor de nível ---------- */

export interface OpcaoDeNivel {
  valor: string;
  rotulo: string;
  /** Acima do permitido (escopo da base) ou travada por regra. */
  desabilitada?: boolean;
  /** Por que está desabilitada (com a regra). Falado na opção e escrito embaixo do grupo. */
  motivo?: string;
}

export function SeletorDeNivel({
  nome,
  opcoes,
  valor,
  onChange,
  rotuloId,
  rotulo,
  descricaoId,
  desabilitado = false,
  testId = 'nivel',
}: {
  /** `name` dos rádios (único na página). */
  nome: string;
  opcoes: readonly OpcaoDeNivel[];
  valor: string;
  onChange: (valor: string) => void;
  rotuloId?: string;
  rotulo?: string;
  descricaoId?: string;
  /** O grupo todo travado (cadeado na linha) ou sem permissão de editar. */
  desabilitado?: boolean;
  testId?: string;
}) {
  const motivos = [...new Set(opcoes.filter((o) => o.desabilitada && o.motivo).map((o) => o.motivo as string))];
  const notaId = motivos.length > 0 ? `${nome}-motivos` : undefined;
  return (
    <div className="flex flex-col items-end gap-1">
      <div
        role="radiogroup"
        aria-labelledby={rotuloId}
        aria-label={rotuloId ? undefined : rotulo}
        aria-describedby={descricaoId}
        aria-disabled={desabilitado || undefined}
        className={cx('inline-flex flex-wrap justify-end rounded-[12px] border border-field bg-surface p-[2px]', desabilitado && 'opacity-60')}
        data-testid={testId}
      >
        {opcoes.map((o) => {
          const off = desabilitado || !!o.desabilitada;
          return (
            <label key={o.valor} title={o.desabilitada ? o.motivo : undefined} className={cx('relative', off ? 'cursor-not-allowed' : 'cursor-pointer')}>
              <input
                type="radio"
                name={nome}
                value={o.valor}
                checked={o.valor === valor}
                disabled={off}
                onChange={() => onChange(o.valor)}
                className="peer sr-only"
                data-testid={`${testId}.${o.valor}`}
              />
              <span
                className={cx(
                  'inline-flex min-h-[40px] items-center gap-1 rounded-[10px] px-3 text-[13px] font-semibold whitespace-nowrap text-ink-3',
                  'peer-checked:bg-ink peer-checked:text-white peer-focus-visible:outline-2 peer-focus-visible:outline-offset-1 peer-focus-visible:outline-accent',
                  o.desabilitada && 'text-disabled',
                  !off && 'hover:bg-ground peer-checked:hover:bg-ink',
                )}
              >
                {o.desabilitada && <IconLock size={12} />}
                {o.rotulo}
                {o.desabilitada && o.motivo && <span className="sr-only">{`, travado: ${o.motivo}`}</span>}
              </span>
            </label>
          );
        })}
      </div>
      {notaId && (
        <p id={notaId} aria-hidden="true" className="m-0 flex items-center gap-1 text-right text-[12px] text-ink-2" data-testid={`${testId}.motivos`}>
          <IconLock size={12} className="shrink-0" />
          {motivos.join(' ')}
        </p>
      )}
    </div>
  );
}

/* ---------- linha ---------- */

export function LinhaDePermissao({
  id,
  rotulo,
  ajuda,
  padrao,
  trava,
  children,
  abaixo,
  erro,
  testId,
}: {
  /** Base dos ids (`idsDaLinha(id)`); o controle usa `rotuloId` e `descricaoId` daí. */
  id: string;
  rotulo: string;
  ajuda?: ReactNode;
  /** "Padrão: Equipe" (`textoDoPadrao`), só quando o valor difere do de fábrica. */
  padrao?: string;
  /** Linha travada: o cadeado com o texto da regra; o controle vem desabilitado pela tela. */
  trava?: { mensagem: string } | null;
  /** O controle (Interruptor, SeletorDeNivel). */
  children: ReactNode;
  /** Bloco embaixo da linha, na largura toda (ex.: a lista de perfis-alvo quando a redefinição de senha está ligada). */
  abaixo?: ReactNode;
  /** Recusa da API nesta linha (texto da tela, já traduzido). */
  erro?: string | null;
  testId?: string;
}) {
  const ids = idsDaLinha(id);
  const tid = testId ?? `permissao.${id}`;
  return (
    <div className="flex flex-col gap-2 border-b border-line-2 py-3 last:border-b-0" data-testid={tid} data-travada={trava ? 'sim' : undefined}>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="flex min-w-[220px] flex-1 flex-col gap-0.5">
          <div className="flex items-center gap-1">
            <span id={ids.rotulo} className="text-[14px] font-semibold text-ink">
              {rotulo}
            </span>
            {trava && <Cadeado id={ids.trava} mensagem={trava.mensagem} testId={`${tid}.cadeado`} />}
          </div>
          {ajuda && (
            <span id={ids.ajuda} className="text-[12px] text-ink-2">
              {ajuda}
            </span>
          )}
          {padrao && <span className="text-[12px] text-ink-2" data-testid={`${tid}.padrao`}>{padrao}</span>}
        </div>
        {children}
      </div>
      {abaixo}
      {erro && (
        <p role="alert" className="m-0 text-[12px] font-semibold text-danger" data-testid={`${tid}.erro`}>
          {erro}
        </p>
      )}
    </div>
  );
}

/** `aria-describedby` do controle de uma linha: ajuda e, se travada, o texto do cadeado. */
export const descricaoDaLinha = (id: string, opts: { ajuda?: boolean; travada?: boolean }): string | undefined => {
  const ids = idsDaLinha(id);
  return juntarIds(opts.ajuda && ids.ajuda, opts.travada && ids.trava);
};

/* ---------- seletor de perfis (seleção múltipla) ---------- */

export interface OpcaoDePerfil {
  valor: string;
  rotulo: string;
  /** Linha menor embaixo do nome ("Base: Vendedor"). */
  detalhe?: string;
  /** Selo ao lado do nome ("Padrão"). */
  selo?: string;
  desabilitada?: boolean;
  /** Por que não pode ser marcado (com a regra); escrito ao lado, com o cadeado. */
  motivo?: string;
}

export function SeletorDePerfis({
  nome,
  legenda,
  ajuda,
  opcoes,
  marcados,
  onChange,
  todos,
  erro,
  desabilitado = false,
  testId = 'perfis',
}: {
  nome: string;
  legenda: string;
  ajuda?: string;
  opcoes: readonly OpcaoDePerfil[];
  marcados: readonly string[];
  /** Recebe a seleção nova; a tela monta com `alternarMarcado`. */
  onChange: (valor: string, marcar: boolean) => void;
  /** Opção "todos" no topo (valor `*`): marcada, as outras aparecem marcadas e desabilitadas. */
  todos?: { rotulo: string };
  erro?: string | null;
  desabilitado?: boolean;
  testId?: string;
}) {
  const tudo = !!todos && marcados.includes(ALVO_TODOS_PERFIS);
  const ajudaId = ajuda ? `${nome}-ajuda` : undefined;
  const erroId = erro ? `${nome}-erro` : undefined;
  const caixa = (valor: string, rotulo: string, marcado: boolean, off: boolean, extra?: { detalhe?: string; selo?: string; motivo?: string }) => (
    <li key={valor}>
      <label className={cx('flex min-h-[44px] items-center gap-3 rounded-[10px] px-2 py-1.5', off ? 'cursor-not-allowed' : 'cursor-pointer hover:bg-ground')}>
        <input
          type="checkbox"
          name={nome}
          value={valor}
          checked={marcado}
          disabled={off}
          onChange={(e) => onChange(valor, e.target.checked)}
          className={cx('h-[18px] w-[18px] shrink-0 accent-[var(--color-ink)]', CLASSES_DESTAQUE.foco)}
          data-testid={`${testId}.${valor === ALVO_TODOS_PERFIS ? 'todos' : valor}`}
        />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className={cx('flex flex-wrap items-center gap-1.5 text-[14px]', off ? 'text-ink-2' : 'text-ink')}>
            {rotulo}
            {extra?.selo && <span className="rounded-lg bg-neutral-soft px-2 py-[2px] text-[11px] font-bold text-ink-3">{extra.selo}</span>}
          </span>
          {extra?.detalhe && <span className="text-[12px] text-ink-2">{extra.detalhe}</span>}
          {extra?.motivo && (
            <span className="flex items-center gap-1 text-[12px] text-ink-2">
              <IconLock size={12} className="shrink-0" />
              {extra.motivo}
            </span>
          )}
        </span>
      </label>
    </li>
  );
  return (
    <fieldset
      className="m-0 flex min-w-0 flex-col gap-1 border-0 p-0"
      aria-describedby={juntarIds(ajudaId, erroId)}
      aria-invalid={erro ? true : undefined}
      disabled={desabilitado}
      data-testid={testId}
    >
      <legend className="mb-1 p-0 text-[12px] font-semibold text-ink-2">{legenda}</legend>
      {ajuda && (
        <span id={ajudaId} className="text-[12px] text-ink-2">
          {ajuda}
        </span>
      )}
      <ul className={cx('m-0 flex list-none flex-col p-0', erro && 'rounded-[10px] ring-1 ring-danger')}>
        {todos && caixa(ALVO_TODOS_PERFIS, todos.rotulo, tudo, desabilitado)}
        {opcoes.map((o) => caixa(o.valor, o.rotulo, tudo ? !o.desabilitada : marcados.includes(o.valor), desabilitado || tudo || !!o.desabilitada, o))}
      </ul>
      {erro && (
        <p id={erroId} role="alert" className="m-0 text-[12px] font-semibold text-danger" data-testid={`${testId}.erro`}>
          {erro}
        </p>
      )}
    </fieldset>
  );
}

/* ---------- resumo "o que mudou" ---------- */

export function ResumoDasMudancas({
  mudancas,
  afetados,
  testId = 'resumo-mudancas',
}: {
  mudancas: readonly MudancaDePermissao[];
  /** Quantos usuários têm este perfil (linha "Afeta 12 usuários."). */
  afetados?: number;
  testId?: string;
}) {
  const grupos = agruparMudancas(mudancas);
  const total = grupos.reduce((n, g) => n + g.itens.length, 0);
  return (
    <div className="flex flex-col gap-3" data-testid={testId}>
      <p className="m-0 text-[14px] font-semibold text-ink" data-testid={`${testId}.contagem`}>
        {contagemDeMudancas(total)}
        {afetados !== undefined && total > 0 && <span className="font-normal text-ink-2">{` · ${textoDosAfetados(afetados)}`}</span>}
      </p>
      {grupos.map((g) => (
        <section key={g.secao} aria-labelledby={`${testId}-${g.secao}`} className="flex flex-col gap-1" data-testid={`${testId}.${g.secao}`}>
          <h3 id={`${testId}-${g.secao}`} className="m-0 text-[12px] font-bold tracking-wide text-ink-2 uppercase">
            {g.titulo}
          </h3>
          <ul className="m-0 flex list-none flex-col gap-1 p-0">
            {g.itens.map((m, i) => (
              <li key={`${m.rotulo}-${i}`} className="text-[13px] text-ink">
                <span aria-hidden="true">
                  {m.rotulo}: <span className="text-ink-2">{m.antes}</span> → <span className="font-semibold">{m.depois}</span>
                </span>
                <span className="sr-only">{textoFaladoDaMudanca(m)}</span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

/** Texto plano do resumo (para o histórico exportado e para conferir nos testes). */
export const resumoEmTexto = (mudancas: readonly MudancaDePermissao[]): string[] => agruparMudancas(mudancas).flatMap((g) => g.itens.map((m) => `${g.titulo} · ${textoDaMudanca(m)}`));
