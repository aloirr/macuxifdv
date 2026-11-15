import { useParametros } from '@macuxi/platform-sdk/react';
import type { ReactElement } from 'react';
import { numeroPtBr, valorDoParametro, type ValorParametro } from '../lib/parametros-valor';

interface Linha {
  rotulo: string;
  valor: ValorParametro;
}

function Lista({ id, linhas }: { id: string; linhas: readonly Linha[] }): ReactElement {
  return (
    <dl data-testid={`parametros-pesquisa-${id}-valores`} className="m-0 grid grid-cols-[minmax(0,1fr)_auto] gap-x-6 gap-y-2 text-[15px]">
      {linhas.map((l) => (
        <div key={l.rotulo} className="contents">
          <dt className="font-semibold text-ink">{l.rotulo}</dt>
          <dd className="m-0 text-right tabular-nums">
            {l.valor.texto}
            {l.valor.padrao !== null ? <span className="block text-[13px] text-ink-3">Padrão: {l.valor.padrao}</span> : null}
          </dd>
        </div>
      ))}
    </dl>
  );
}

const unidade = (u: string) => (v: number) => `${numeroPtBr(v)} ${u}`;

/** Parâmetros › Pesquisa › Vigência (RN-PES-04). Só leitura; valor do tenant com fallback ao padrão. */
export function ParametrosVigencia(): ReactElement {
  const p = useParametros('pesquisa');
  return <Lista id="vigencia" linhas={[{ rotulo: 'Tolerância', valor: valorDoParametro(p, 'tolerancia_vigencia_h', unidade('h')) }]} />;
}

/** Parâmetros › Pesquisa › Construtor (RN-PES-07; escala: premissa T-0012). Só leitura. */
export function ParametrosConstrutor(): ReactElement {
  const p = useParametros('pesquisa');
  return (
    <Lista
      id="construtor"
      linhas={[
        { rotulo: 'Perguntas por questionário', valor: valorDoParametro(p, 'max_perguntas') },
        { rotulo: 'Opções por pergunta', valor: valorDoParametro(p, 'max_opcoes_por_pergunta') },
        { rotulo: 'Fotos por pergunta', valor: valorDoParametro(p, 'max_fotos_por_pergunta') },
        { rotulo: 'Texto', valor: valorDoParametro(p, 'texto_max_caracteres', unidade('caracteres')) },
        { rotulo: 'Amplitude da escala', valor: valorDoParametro(p, 'escala_amplitude_max') },
      ]}
    />
  );
}

/** Parâmetros › Pesquisa › Fotos (RN-PES-06). Só leitura. */
export function ParametrosFotos(): ReactElement {
  const p = useParametros('pesquisa');
  return (
    <Lista
      id="fotos"
      linhas={[
        { rotulo: 'Maior lado', valor: valorDoParametro(p, 'foto_max_lado_px', unidade('px')) },
        { rotulo: 'Qualidade JPEG', valor: valorDoParametro(p, 'foto_jpeg_qualidade') },
      ]}
    />
  );
}
