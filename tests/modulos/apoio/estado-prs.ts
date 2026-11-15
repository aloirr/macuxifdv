/**
 * Estado do repositório quando um PR de outro dono ainda não entrou no main: cada teste afetado vale nos DOIS estados e
 * decide pelo fonte. Uma detecção, um lugar: os testes importam daqui em vez de repetir a regra.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const RAIZ = join(__dirname, '..', '..', '..');
const existe = (rel: string) => existsSync(join(RAIZ, rel));

/** PR do modulo-vendedor (R-20261114-151000, Catálogo só para consulta): a extensão do Catálogo é "Adicionar ao orçamento". */
export const SO_ORCAMENTO = /id: 'adicionar-ao-orcamento'/.test(readFileSync(join(RAIZ, 'modules/vendedor/app/index.ts'), 'utf8'));

/** PR #243 (ADR 0048): o passo Empresa do portal confere o CNPJ na Receita (falsa nos testes, sem rede). */
export const COM_RECEITA = existe('apps/api/src/consulta-cnpj.ts');

/**
 * PR #258 (modulo-core, R-20261114-150000/150500): a folha do check-in só abre a ficha (`checkin-abrir-ficha`), o Check-in volta ao
 * rodapé da ficha (RN-CORE-51) e o check-in fora da rota do dia depende de `visita.checkin_fora_de_rota` (RN-CORE-52).
 */
export const CHECKIN_NA_FICHA = existe('modules/core/domain/checkin-rota.ts');

/** 0069 (banco-dados, R-20261114-153500): um perfil por usuário (exclusão adiada `usuario_perfil_um_vivo`). */
export const UM_PERFIL = existe('db/migrations/0069_core_cargo_hierarquia.up.sql');

/**
 * T-0176 (RN-CORE-39 revista, R-20261115-073000 e R-20261115-080000): filial do usuário. Três PRs de donos diferentes:
 *  - `FILIAL_USUARIO_CORE`: modulo-core (`nuvem/filial-usuario-modulo-core`): domain, `filial_ids` em criar/editar/ler, `sem_filial` no
 *    login e no sync `usuario`, carga do ERP. Com ele no main, `POST /v1/core/usuarios` de vendedor, promotor, supervisor e gerente
 *    EXIGE `filial_ids` (422 sem ela);
 *  - `FILIAL_USUARIO_BANCO`: banco-dados (`nuvem/filial-usuario-banco-dados`): migração 0077 `core.usuario_filial` e a fixture
 *    (vendedor-1 e supervisor de A com filial; vendedor-2 sem; vendedor-B na Campinas). Só entra depois da 0070–0076 no main;
 *  - `VENDEDOR_FILIAL_HUB`: modulo-integracao (`nuvem/marca-codigo-modulo-integracao`): `filial_external_id` do vendedor no Hub, aviso
 *    `vendedor_sem_filial` e a filial antes do vendedor na ordem de carga.
 */
export const FILIAL_USUARIO_CORE = existe('modules/core/domain/filial-usuario.ts');
export const FILIAL_USUARIO_BANCO = existe('db/migrations/0077_core_usuario_filial.up.sql');
/** A API do Core da T-0176 lê e grava `core.usuario_filial`: os testes de API precisam dos dois PRs. */
export const FILIAL_USUARIO = FILIAL_USUARIO_CORE && FILIAL_USUARIO_BANCO;
export const VENDEDOR_FILIAL_HUB = existe('modules/integracao/domain/vendedor-filial.ts');
