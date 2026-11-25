/**
 * T-0195 (ADR 0070 §D2): identidade do app em toda chamada à API (`x-macuxi-app: <variante>/<versão>`). Import com efeito, na
 * carga do bundle (index.ts, antes do roteador e das tarefas sem tela): a variante e a versão vêm do próprio build
 * (`app.config.ts`, `scripts/eas/versao.json`). A parte pura e o `ApiClient` ficam em `lib/versao-app.ts` e `services/api.ts`.
 */
import Constants from 'expo-constants';

import { varianteAtual } from '@/lib/variante';
import { definirIdentidadeDoApp } from '@/lib/versao-app';

definirIdentidadeDoApp(varianteAtual(), Constants.expoConfig?.version);
