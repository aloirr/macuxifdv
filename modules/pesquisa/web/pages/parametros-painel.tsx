import { useParametros } from '@macuxi/platform-sdk/react';
import type { ReactElement } from 'react';
import { formatarParametro, ListaParametros } from '@macuxi/ui/web';
import { valorDoParametro } from '../lib/parametros-valor';

/** A lista do kit (RD-1583) com o testId que os testes da tela já usam. */
const Lista = ({ id, linhas }: { id: string; linhas: { rotulo: string; valor: ReturnType<typeof valorDoParametro> }[] }): ReactElement => (
  <ListaParametros testId={`parametros-pesquisa-${id}-valores`} linhas={linhas.map((l) => ({ rotulo: l.rotulo, ...l.valor }))} />
);

const unidade = formatarParametro.unidade;

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
