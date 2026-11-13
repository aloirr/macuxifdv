# Base LGPD do tracking (localização contínua do usuário de campo) — T-0145, critério 7

> **RASCUNHO PARA REVISÃO JURÍDICA.** Texto técnico do engenheiro-software, 10/11/2026. Não vale como contrato nem como
> parecer até a revisão de um advogado (LGPD e trabalhista) e a aprovação do dono do produto. Valores entre [colchetes] são
> parâmetros propostos. Complementa o [termo de uso dos dados do ERP](../seguranca/termo-dado-erp.md) e a RN-CORE-13/RN-CORE-37.

**Regra de ouro:** o tracking **só liga** para um usuário quando as três peças abaixo existem: finalidade publicada (§2), aviso
mostrado (§6) e termo de ciência registrado (§7). Sem uma delas, o app pede a permissão (RN-CORE-37), mas **não grava trajeto**.

## 1. Papéis
- **Empresa cliente (controladora)**: decide usar o tracking e para quê, dentro do §2. É ela que responde ao vendedor (titular).
  Indica o seu encarregado (DPO) e o canal de atendimento, que aparecem no aviso e no termo.
- **Macuxi (operador)**: trata a localização só por ordem da empresa e só para as finalidades do §2 (LGPD art. 39).
- **Titular**: o usuário do app Campo (vendedor e promotor), empregado ou representante comercial.
- **Suboperadores**: os mesmos do termo do ERP (nuvem e armazenamento na Magalu Cloud, região Brasil; túnel HTTPS). Nenhum
  provedor de mapa recebe o trajeto; se um dia receber, entra no anexo de suboperadores com aviso prévio.

## 2. Finalidade (fechada)
O trajeto serve **só** para:
1. comprovar a visita ao cliente (chegada, permanência e saída), junto do check-in e do checkout;
2. planejar e corrigir a rota (cobertura, ordem das visitas, distância percorrida);
3. apoiar o vendedor no campo (ex.: localizar o cliente mais próximo).

**Não** serve para: vigiar a vida pessoal; monitorar fora do expediente, em folga, férias ou afastamento; decidir punição ou
desligamento **só** com base no trajeto, sem revisão humana (art. 20); vender, ceder ou cruzar com dados de outras empresas;
treinar modelos de IA.

## 3. Base legal (proposta para o jurídico)
- **Legítimo interesse** da empresa (art. 7º, IX), com o teste de balanceamento do §9, e **execução do contrato** de trabalho ou
  de representação (art. 7º, V) para a comprovação de visita.
- **Não** usar consentimento como base: na relação de trabalho ele não é livre (desequilíbrio entre as partes) e poderia ser
  revogado a qualquer momento, desligando a comprovação de visita. O **termo do §7 é de ciência** (transparência, art. 6º, VI),
  não de consentimento.
- Representante comercial autônomo (Lei 4.886/65): o jurídico confirma se o contrato de representação prevê a comprovação de
  visita; se não previr, a empresa ajusta o contrato antes de ligar o tracking para ele.

## 4. O que é coletado (minimização, art. 6º, III)
- Ponto: latitude, longitude, precisão (m), instante (UTC), velocidade quando o aparelho der, e o id do usuário e do aparelho.
- Só **dentro do expediente** do usuário ([jornada do tenant, ex.: seg–sex 08:00–18:00, sáb 08:00–12:00], fuso do tenant) e
  **com o usuário logado**. Fora disso o app não grava ponto nenhum, nem guarda para mandar depois.
- Frequência: [1 ponto a cada 5 min parado; a cada 200 m em deslocamento]; nada de áudio, câmera, contatos ou apps do aparelho.
- O Android mostra a notificação fixa "Macuxi Campo — localização ativa no expediente" enquanto grava (serviço em primeiro plano);
  o vendedor sempre sabe quando está sendo registrado.
- Botão "Pausar por motivo pessoal" [opcional, decisão do dono do produto]: pausa por até [60] min, registra só a pausa (sem o motivo).

## 5. Quem vê e por quanto tempo
| Dado | Quem vê | Retenção |
|---|---|---|
| Pontos do trajeto | o próprio usuário; supervisor da equipe; gerente das equipes abaixo; admin | **[90] dias** e então apagados |
| Resumo diário (km, tempo em cliente, visitas comprovadas) | os mesmos + analista (relatórios) | [5] anos (base das metas e da RV) |
| Termo de ciência (quem, quando, versão, aparelho) | admin | enquanto o usuário existir + [5] anos (prova da transparência) |

- Isolamento por empresa (RLS), como todo dado do Macuxi. Promotor e vendedor não veem o trajeto de colegas.
- **Nunca em log**: coordenada, trajeto e endereço não vão para log técnico, mensagem de erro, Sentry nem telemetria; o log leva
  só id do usuário, contagem de pontos e tempo.
- Usuário desligado: os pontos seguem o prazo de [90] dias e são apagados; o resumo fica pelo prazo da tabela.
- Exportação para fora do Macuxi: só o resumo diário, nunca os pontos brutos.

## 6. Aviso ao vendedor (transparência, art. 9º)
**Na tela de permissões (antes do login; T-0145, imagem do designer-ux)** — texto curto da localização:
> **Localização o tempo todo**
> Durante o expediente, o Macuxi registra o seu trajeto para comprovar as visitas e planejar a rota. Fora do expediente, nada é registrado.

O Google Play exige este aviso **antes** do pedido de localização em segundo plano ("prominent disclosure"); o texto acima atende.

**Na Ajuda do app e no Perfil** — aviso completo: os itens 1 a 5 em linguagem simples, o nome da empresa (controladora), o
contato do encarregado dela e o link "Ver meu trajeto" (§8).

## 7. Termo de ciência (depois do 1º login, antes de o tracking ligar)
Mostrado uma vez por usuário e a cada **versão nova** do termo; o tracking não grava antes do "Li e estou ciente".

> **Termo de ciência — localização no expediente** (versão [1], [data])
>
> A [Empresa] usa o Macuxi Campo para registrar a sua localização **somente durante o expediente** ([jornada]), para:
> comprovar as visitas aos clientes, planejar e corrigir a rota e apoiar você no campo.
>
> - Fora do expediente, em folga, férias ou afastamento, **nada é registrado**. Quando o registro está ligado, o Android mostra a
>   notificação "localização ativa no expediente".
> - Veem o seu trajeto: você, o seu supervisor, o gerente da sua área e o administrador da [Empresa]. Os pontos ficam [90] dias;
>   o resumo do dia (km, visitas, tempo em cliente) fica [5] anos, para as metas e a remuneração variável.
> - O trajeto não é usado, sozinho, para punição ou desligamento: sempre há revisão de uma pessoa.
> - Você pode ver o seu trajeto no app, pedir correção e tirar dúvidas com [encarregado/DPO da Empresa, contato].
> - A [Empresa] é a controladora destes dados; o Macuxi é o operador e os trata só por ordem dela (LGPD, arts. 7º, 9º, 18 e 39).
>
> [ Li e estou ciente ]

Registro do aceite (banco, a desenhar com o tracking): usuário, instante UTC, versão do termo, aparelho. Sem esse registro, o
tracking não liga para o usuário.

## 8. Direitos do titular (art. 18)
- **Acesso**: "Meu trajeto" no app (os próprios pontos dos últimos [90] dias e o resumo).
- **Correção**: o usuário contesta um dia ("estava em visita, sem sinal") pelo próprio app; o supervisor revisa.
- **Informação e oposição**: pelo encarregado da empresa. Oposição ao tracking em expediente é tratada pela empresa no contrato
  (a comprovação de visita continua pelo check-in e checkout, que já gravam o GPS do momento, RN-CORE-13).
- **Eliminação**: no fim dos prazos do §5, ou antes por decisão da empresa.

## 9. Teste de balanceamento (legítimo interesse, art. 10) — resumo para o RIPD da empresa
| Pergunta | Resposta |
|---|---|
| Interesse legítimo? | Sim: comprovar a visita paga e planejar rotas de uma equipe externa. |
| Necessário? | O check-in já prova a chegada; o trajeto prova a permanência e mede a rota — não há meio menos invasivo que faça as duas coisas. |
| Expectativa do titular? | Atendida por aviso, notificação fixa, termo e limite de expediente. |
| Salvaguardas | Fora do expediente nada é gravado; retenção curta dos pontos; acesso só da cadeia de gestão; sem log; sem decisão só automatizada; "Meu trajeto". |

O **Relatório de Impacto (RIPD, art. 38)** é da empresa controladora; o Macuxi fornece este texto como modelo.

## 10. O que precisa existir antes de ligar o tracking (semana de 16/11)
1. Revisão jurídica deste texto e aprovação do dono do produto (valores entre colchetes).
2. Jornada do expediente por tenant (e por usuário, se houver turnos) — parâmetro do Core.
3. Registro do aceite do termo (banco-dados + modulo-core) e o bloqueio "sem aceite, sem gravação" no app (engenheiro-apps).
4. Expurgo diário dos pontos com mais de [90] dias (worker).
5. "Meu trajeto" no app e o acesso por perfil (motor de permissões, ADR 0033).
6. Item "localização" no checklist de segurança (`docs/seguranca/checklist.md`): sem coordenada em log, conferido por teste.
