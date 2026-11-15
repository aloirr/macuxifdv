import type { ReactElement } from 'react';
import { ParametrosPesquisaSchema } from '../../contracts';

/** Valor em uso: o padrão do contrato (`ParametrosPesquisaSchema`); ainda não há rota de leitura do valor do tenant. */
const EM_USO = ParametrosPesquisaSchema.parse({});

interface Linha {
  rotulo: string;
  valor: string;
}

function Lista({ id, linhas }: { id: string; linhas: readonly Linha[] }): ReactElement {
  return (
    <dl data-testid={`parametros-pesquisa-${id}-valores`} style={{ margin: 0, display: 'grid', gridTemplateColumns: 'max-content 1fr', gap: '8px 24px' }}>
      {linhas.map((l) => (
        <div key={l.rotulo} style={{ display: 'contents' }}>
          <dt>{l.rotulo}</dt>
          <dd style={{ margin: 0, fontWeight: 600 }}>{l.valor}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Parâmetros › Pesquisa › Vigência (RN-PES-04). Só leitura. */
export function ParametrosVigencia(): ReactElement {
  return <Lista id="vigencia" linhas={[{ rotulo: 'Tolerância da vigência', valor: `${EM_USO.tolerancia_vigencia_h} h` }]} />;
}

/** Parâmetros › Pesquisa › Construtor (RN-PES-07; escala: premissa T-0012). Só leitura. */
export function ParametrosConstrutor(): ReactElement {
  return (
    <Lista
      id="construtor"
      linhas={[
        { rotulo: 'Perguntas por questionário', valor: String(EM_USO.max_perguntas) },
        { rotulo: 'Opções por pergunta', valor: String(EM_USO.max_opcoes_por_pergunta) },
        { rotulo: 'Fotos por pergunta', valor: String(EM_USO.max_fotos_por_pergunta) },
        { rotulo: 'Texto', valor: `${EM_USO.texto_max_caracteres} caracteres` },
        { rotulo: 'Amplitude da escala', valor: String(EM_USO.escala_amplitude_max) },
      ]}
    />
  );
}

/** Parâmetros › Pesquisa › Fotos (RN-PES-06). Só leitura. */
export function ParametrosFotos(): ReactElement {
  return (
    <Lista
      id="fotos"
      linhas={[
        { rotulo: 'Maior lado', valor: `${EM_USO.foto_max_lado_px} px` },
        { rotulo: 'Qualidade JPEG', valor: String(EM_USO.foto_jpeg_qualidade) },
      ]}
    />
  );
}
