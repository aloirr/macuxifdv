/**
 * T-0093 (RN-CORE-32): lista "A senha precisa ter" ao vivo, para o passo Empresa do portal, o formulário de usuário do BKO, o
 * aceite do convite e as telas de senha da T-0094. Só exibe as faltas que a tela entrega (`faltasNaSenha` do Core); nunca
 * recebe a senha. Spec: docs/design/portal-entrar.md §5.
 *
 * Acessível: cada regra diz "ok" ou "falta" em texto (não só a cor: o sinal muda de forma, ✓ ou círculo vazio) e uma região viva
 * educada lê o resumo quando ele muda ("Falta um número."). Ligue o campo com `aria-describedby={id}`.
 * T-0094: com `repeticao` (tela "Crie sua senha"), o item "As duas senhas iguais" fica fora da lista, com a mesma marca e o mesmo
 * "ok"/"falta" falado das regras (`estadoFalado`; R-20261115-080000-alexandre). O item tem o id `<id>-repeticao`, para o
 * `aria-describedby` do campo "Repita a senha", e a região viva lê as duas coisas.
 * Sem hooks (o teste chama o componente como função).
 */
import {
  estadoFalado,
  itemDaRepeticao,
  itensDasRegras,
  resumoComRepeticao,
  resumoDaTela,
  TITULO_REGRAS_DA_SENHA,
  type EstadoRegraSenha,
  type RepeticaoSenha,
} from '../comum/senha';
import { IconCheck, IconX } from './icons';
import { cx } from './ui';

export {
  CAMPO_REPITA_A_SENHA,
  CAMPO_SENHA_NOVA,
  ESCONDER_SENHA,
  ESTADO_FALADO_REGRA,
  EXEMPLO_REGRA_SENHA,
  faltasEmOrdem,
  itemDaRepeticao,
  itensDasRegras,
  MOSTRAR_SENHA,
  OCULTAR_SENHA,
  REGRAS_DA_SENHA,
  resumoComRepeticao,
  resumoDaTela,
  rotuloDaRegraSenha,
  rotuloDoOlhoDaSenha,
  SENHA_ATENDE_AS_REGRAS,
  TEXTO_REPETICAO_SENHA,
  TITULO_REGRAS_DA_SENHA,
} from '../comum/senha';
export type { EstadoRegraSenha, FinalidadeSenha, ItemRegraSenha, ItemRepeticaoSenha, RegraSenha, RepeticaoSenha } from '../comum/senha';

const COR_DO_TEXTO: Record<EstadoRegraSenha, string> = { ok: 'text-ink', falta: 'text-ink-2', erro: 'font-semibold text-danger' };

function marca(estado: EstadoRegraSenha) {
  if (estado === 'ok') {
    return (
      <span aria-hidden="true" className="inline-flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full bg-success-soft text-success">
        <IconCheck size={12} />
      </span>
    );
  }
  if (estado === 'erro') {
    return (
      <span aria-hidden="true" className="inline-flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full bg-danger-soft text-danger">
        <IconX size={12} />
      </span>
    );
  }
  return <span aria-hidden="true" className="inline-block h-[18px] w-[18px] shrink-0 rounded-full border-2 border-field" />;
}

export function RegrasDaSenha({
  faltas,
  destacar = false,
  resumo,
  minimo,
  id,
  className,
  repeticao,
  testId = 'regras-da-senha',
}: {
  /** `faltasNaSenha(senha)` do Core (campo vazio = as quatro). */
  faltas: readonly string[];
  /** Depois de tentar salvar com falta: as faltas ficam em vermelho, com ✕. */
  destacar?: boolean;
  /**
   * Frase da região viva: `mensagemDaSenha(faltas)` do Core (RD-0021, obrigatório; o kit não monta frase). `null`/`undefined` (nada falta) =
   * "A senha atende às regras.".
   */
  resumo: string | null | undefined;
  /** Mínimo de caracteres da RN-CORE-32: passe `SENHA_MIN_CARACTERES` do Core (RD-0021, obrigatório; o kit não escreve o número). */
  minimo: number;
  /** Para o `aria-describedby` do campo de senha. */
  id?: string;
  className?: string;
  /** T-0094: resultado do campo "Repita a senha" (a tela compara). Ausente = sem a linha (portal, formulário de usuário). */
  repeticao?: RepeticaoSenha;
  testId?: string;
}) {
  const itens = itensDasRegras(faltas, minimo, destacar);
  const conferencia = itemDaRepeticao(repeticao, destacar);
  return (
    <div id={id} className={cx('flex flex-col gap-1.5', className)} data-testid={testId}>
      <span className="text-[12px] font-semibold text-ink-2" aria-hidden="true">
        {TITULO_REGRAS_DA_SENHA}
      </span>
      <ul aria-label={TITULO_REGRAS_DA_SENHA} className="m-0 flex list-none flex-col gap-1 p-0">
        {itens.map((i) => (
          <li key={i.regra} data-testid={`${testId}.${i.regra}`} data-estado={i.estado} className={cx('flex items-center gap-2 text-[13px]', COR_DO_TEXTO[i.estado])}>
            {marca(i.estado)}
            <span>
              {i.rotulo}
              {i.exemplo && <span aria-hidden="true" className="text-ink-2">{` (${i.exemplo})`}</span>}
              <span className="sr-only">{`: ${estadoFalado(i.estado)}`}</span>
            </span>
          </li>
        ))}
      </ul>
      {conferencia && (
        <p
          id={id ? `${id}-repeticao` : undefined}
          data-testid={`${testId}.repeticao`}
          data-estado={conferencia.estado}
          className={cx('m-0 mt-1 flex items-center gap-2 text-[13px]', COR_DO_TEXTO[conferencia.estado])}
        >
          {marca(conferencia.estado)}
          <span>
            {conferencia.texto}
            <span className="sr-only">{`: ${estadoFalado(conferencia.estado)}`}</span>
          </span>
        </p>
      )}
      <span role="status" aria-live="polite" className="sr-only" data-testid={`${testId}.resumo`}>
        {resumoComRepeticao(resumoDaTela(resumo), repeticao, destacar)}
      </span>
    </div>
  );
}
