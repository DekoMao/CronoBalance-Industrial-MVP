# CronoBalance Industrial — Especificação SDD para Evolução Corporativa

**Documento:** SDD-CBI-001  
**Versão:** 1.0  
**Status:** Baseline para implementação  
**Sistema de origem:** CronoBalance Industrial MVP 0.2 — PWA local-first, Vanilla JS/HTML/CSS, `localStorage`  
**Público:** Engenharia de Software, Produto, Engenharia de Manufatura, Qualidade, Segurança e Operações

## Objetivo e escopo

Evoluir o MVP para uma aplicação corporativa web, responsiva, multi-organização, auditável e utilizável offline, preservando a identidade visual e as regras de cronoanálise e balanceamento já existentes. O cliente será uma aplicação TypeScript; a API será REST tipada; PostgreSQL será a fonte persistente compartilhada; IndexedDB será a fila e o cache local para operação offline.

Esta especificação define os comportamentos, fórmulas, contratos, estados, dados, segurança e critérios de aceite que a implementação deve cumprir. O ícone e as duas telas de referência anexadas pelo solicitante são referências de marca e direção visual, não fontes de valores de engenharia. O arquivo comparativo “ANTES (MVP 0.2) / DEPOIS (Pós-SDD)” é conceitual; os elementos legíveis nele não substituem este contrato.

### Decisões de produto e engenharia

| Tema | Decisão normativa |
|---|---|
| Front-end | React + TypeScript + Vite; componentes acessíveis; estado de domínio independente da camada visual. |
| API | REST `/api/v1`, JSON, OpenAPI gerado e validado no CI; operações transacionais. |
| Back-end | Python 3.12+ com FastAPI e validação Pydantic; camada de domínio sem dependência HTTP. |
| Banco | PostgreSQL 16+; chaves UUID; decimais exatos para tempos e moeda; isolamento por organização. |
| Offline | IndexedDB com persistência local e outbox de mutações idempotentes; a nuvem é fonte compartilhada quando conectada. |
| Concorrência | ETag/`If-Match`, versão crescente por estudo e resolução explícita de conflito; nunca sobrescrever silenciosamente. |
| Otimização | Solver determinístico e verificável, com restrições duras de precedência, equipamento e ergonomia; nenhuma proposta é aplicada sem ação explícita do usuário. |
| PWA | Instalação opcional, service worker para shell e recursos estáticos; não cachear respostas autenticadas como conteúdo público. |
| Precisão | Cálculos com `Decimal`; arredondamento apenas na apresentação/exportação. Tempo de entrada aceita até 3 casas decimais; moeda até 2 casas. |

### Vocabulário

- **Estudo (Study/Project):** unidade de análise, associada a uma organização, produto/família, turno, demanda e cenários atual/futuro.
- **Área/Operação (Area):** agrupador de elementos e unidade de classificação VA/NVA; custos operacionais atribuídos à peça são parcelas contábeis separadas da mão de obra.
- **Elemento de Trabalho (WorkElement):** menor unidade cronometrada e alocada a um posto em cada cenário.
- **Posto (Station):** posição indexada `1..N` dentro de um cenário da linha; identificada na interface como `F1..Fn`.
- **VA / NVA:** tempo de atividade que agrega valor / tempo que não agrega valor, conforme classificação do estudo.
- **Ciclo da linha (`TC`):** maior carga calculada entre os postos do cenário.
- **Takt:** tempo disponível por turno dividido pela demanda por turno. É referência de ritmo, não promessa de produção real.
- **Hipótese:** premissa, tempo futuro, alocação ou redução projetada ainda não verificada na operação.
- **Validado:** hipótese marcada como verificada, com responsável, data, método e evidência referenciada. A aplicação não presume validação por conta própria.

---

## 1. UX DESIGN SPECIFICATION — Fluxos, Ergonomia Cognitiva e Estados

### 1.1 Personas e contexto de uso

| Persona | Contexto e objetivos | Ações típicas | Riscos de uso a prevenir |
|---|---|---|---|
| Engenheiro(a) de Processos/Qualidade | Tablet ou notebook no chão de fábrica; conexão intermitente; luvas podem limitar precisão; compara operação observada e hipótese de melhoria. | Criar estudo, registrar VA/NVA, associar área e posto, anotar precedências/equipamento, balancear, exportar. | Perder medições offline; confundir tempo observado com planejado; edição acidental; texto pequeno; arraste impreciso. |
| Gestor(a) Industrial | Desktop; conexão estável; avalia capacidade, custo, cenários e aprovação. | Comparar cenário, revisar premissas, aprovar revisão, consultar histórico e exportar resumo. | Tratar capacidade teórica como produção garantida; somar custo operacional duas vezes; aprovar cenário não validado. |
| Administrador(a) da organização | Desktop; gestão de usuários e acesso. | Convidar usuários, configurar papéis, desativar acesso e consultar trilha de auditoria. | Acesso entre organizações; privilégios excessivos; perda de rastreabilidade. |

### 1.2 Arquitetura de informação

Navegação principal por estudo, com a jornada de análise apresentada como cinco etapas sequenciais. A etapa selecionada mantém visível um resumo compacto dos dados globais e os estados de sincronização.

| Etapa | Pergunta do usuário | Conteúdo e ações | Critério de avanço |
|---|---|---|---|
| 1. Medir | “Qual é o trabalho e quanto tempo ele consome?” | Dados do estudo; áreas; elementos; VA/NVA atual; posto atual; observações e origem da medição. | Estudo tem nome, turno válido, demanda válida e pelo menos um elemento com tempos válidos; incompletude pode ser salva como rascunho. |
| 2. Analisar VA × NVA | “Onde está o tempo que agrega valor e onde estão as perdas?” | Totais por área e cenário, composição VA/NVA, elementos sem classificação, variação entre atual e futuro. | Totais são derivados; campos agregados são somente leitura. A etapa pode ser consultada mesmo com pendências. |
| 3. Balancear | “Como distribuir o trabalho respeitando o processo?” | Gráfico por posto, DAG de precedência, equipamento fixo, zona ergonômica, alocação por arraste ou seleção acessível e comando “Gerar proposta”. | Proposta satisfaz todas as restrições duras ou mostra inviabilidade explicada; não alterar a alocação futura até “Aplicar proposta”. |
| 4. Comparar | “O cenário futuro atende ao takt e qual é o impacto?” | Gráficos atual/futuro com Takt; ciclo; gargalo; capacidade teórica; mão de obra/peça; custos operacionais separados; variação e premissas. | Exibir claramente ciclo futuro acima/abaixo do Takt e premissas não validadas. |
| 5. Realizar | “O que será testado, aprovado e medido na operação?” | Plano de validação; responsável; janela; método; baseline; evidências; estado da revisão; exportar/compartilhar. | Aprovação requer papel autorizado, revisão sem conflito e confirmação das premissas; hipótese não vira ganho real automaticamente. |

### 1.3 Redução de carga cognitiva: matriz de trabalho

Substituir a tabela aninhada por uma área de composição com duas apresentações sincronizadas:

1. **Visão por Área (padrão):** linhas de área expansíveis. O cabeçalho mostra o total derivado de VA, NVA e tempo para cada cenário; a expansão mostra seus elementos.
2. **Visão por Posto:** colunas/lanes `F1..Fn` para o cenário selecionado; cards de elemento mostram nome, área, `VA`, `NVA`, total e alertas. Arrastar altera apenas a alocação do cenário selecionado.
3. A seleção de um elemento abre painel lateral com tempos atual/futuro, alocação, precedências, equipamento, zona ergonômica, observação, status de validação e histórico de alteração.
4. Totais de áreas, barras, ciclo, gargalo e KPIs são somente leitura e são recalculados a partir dos elementos. Não há endpoint nem controle de UI para editar valores agregados.
5. Ações em lote suportam mover elementos selecionados, classificar VA/NVA e atribuir postos. Antes de gravar, apresentar quantidade afetada e restrições violadas.
6. Drag-and-drop não é o único meio de alterar posto. Cada card também tem menu “Mover para posto…” operável por teclado e toque.

### 1.4 Fluxo crítico e transições

```text
Estudos → Criar/Importar → Medir → Analisar → Balancear → Comparar → Validar/Realizar
                                  ↑                  ↓
                         edição de elemento ← proposta de balanceamento
                                  ↓
                     recálculo derivado + gravação local
                                  ↓
                         sincronização/conflicto
```

- Salvar é automático após validação local de cada edição; debounce de persistência local: 150 ms após a última alteração, com flush ao trocar de etapa, ocultar página ou encerrar edição.
- O cálculo em memória inicia no mesmo evento de domínio e tem meta de `p95 < 16 ms` para até 500 elementos e 20 postos em dispositivo de referência desktop. Persistência, rede, animação e renderização não entram nessa métrica. Se o benchmark exceder o limite, mover cálculo para Web Worker sem alterar o contrato.
- UI mostra valores recalculados no próximo frame; não renderizar valor antigo como se estivesse confirmado. Mostrar estado transitório “Calculando” se passar de 100 ms.
- O auto-save local confirma que os dados foram persistidos no dispositivo, não que foram sincronizados com o servidor.

### 1.5 Micro-interações e prevenção de erros

| Ação/evento | Resposta obrigatória |
|---|---|
| Alterar VA/NVA | Validar número, unidade e limites; recalcular o elemento, total da área, carga dos postos, ciclo, gargalo, capacidade, indicadores e gráficos em uma única atualização atômica. |
| Tempo inválido | Manter edição visível, associar erro ao campo, não atualizar cálculo confirmado e não enfileirar mutação inválida. Mensagem explica a faixa/formato esperado. |
| Reduzir NVA futuro | Marcar como “Hipótese” até registrar validação; nunca usar cor, texto ou selo de ganho realizado sem evidência de validação. |
| Alterar pressuposto financeiro | Mostrar diferença antes/depois, exigir confirmação se já existir uma revisão aprovada e gerar evento de auditoria com valor anterior e novo. |
| Excluir posto | Bloquear se houver elemento alocado ou referência de restrição; listar elementos que precisam ser movidos. Permitir excluir após realocação e confirmação. |
| Violação de precedência | Mostrar aresta violada, elemento predecessor/sucessor, postos envolvidos e ação “Ir para elemento”. Bloquear aplicação da proposta. |
| Arrastar card | Pré-visualizar destino; destacar compatibilidade; ao soltar, recalcular; se violar restrição, rejeitar e manter origem com explicação. |
| Aplicar proposta | Mostrar ciclo previsto, Takt, número de postos, restrições satisfeitas, restrições não atendidas e premissas. Exigir confirmação; gravar nova revisão. |
| Estado sem rede | Salvar localmente e adicionar operação à outbox. Badge “Offline · alterações neste dispositivo”. |
| Envio em progresso | “Sincronizando n alterações”; impedir alegação de sincronização completa até resposta confirmada. |
| ETag divergente | “Conflito de versão”; abrir comparação entre campos locais e remotos com opções explícitas: manter local, aceitar remoto ou mesclar campos sem sobreposição. |
| Sucesso do sync | “Sincronizado na nuvem · HH:mm”; atualizar ETag e limpar somente operações confirmadas pelo servidor. |

### 1.6 Matriz de estados de interface

| Estado | Condição | Apresentação | Interação permitida |
|---|---|---|---|
| Vazio — sem estudos | Usuário ainda não possui estudos acessíveis. | Empty state com “Criar estudo”, “Importar JSON” e explicação curta. | Criar/importar; navegação de ajuda. |
| Vazio — estudo sem elementos | Estudo salvo sem áreas/elementos. | Prompt contextual “Adicionar área ou elemento”; não desenhar gráfico fictício. | Criar área e primeiro elemento; editar parâmetros. |
| Carregamento inicial | Busca de estudo ainda não concluiu. | Skeleton com dimensões equivalentes aos componentes reais; `aria-busy=true`. | Cancelar navegação; sem edição. |
| Atualização em curso | Cálculo >100 ms ou ação remota pendente. | Indicador não bloqueante; preservar valor anterior com rótulo “último cálculo confirmado” quando aplicável. | Outras leituras; evitar submissão duplicada. |
| Erro de validação | Valor malformado, negativo, fora do limite ou referência inválida. | Estado junto ao campo, mensagem acionável, resumo anunciado por leitor de tela. | Corrigir; dados válidos não são perdidos. |
| Ciclo > Takt | `TC_futuro > Takt` ou Takt inválido. | Card futuro vermelho/âmbar sem confundir com erro de salvamento; mostrar excesso em segundos e percentual quando Takt válido. | Ajustar tempos, restrições/postos ou demanda/turno. |
| Linha atende ao Takt | `Takt > 0` e `TC_futuro <= Takt`. | Card futuro verde e texto “Atende ao Takt (teórico)”; incluir premissa de capacidade teórica. | Comparar, salvar proposta, iniciar validação. |
| Offline com fila | Sem rede e mutações locais pendentes. | Badge cinza/âmbar “Offline · n alterações salvas neste dispositivo”. | Continuar edição, exportar backup, abrir detalhes da fila. |
| Sincronizando | Requests da outbox em curso. | Spinner discreto e progresso `n/N`; por item, estado pendente/confirmado. | Leitura e edição local permitidas; bloquear replay duplicado por idempotency key. |
| Conflito de versão | Resposta 412 com campos sobrepostos. | Tela de comparação lado a lado; nenhuma escolha pré-selecionada. | Resolver campo a campo, exportar cópia ou descartar alterações locais com confirmação. |
| Sucesso sincronizado | Nenhuma mutação pendente e última versão confirmada. | Badge verde discreto com hora e versão. | Fluxo normal. |
| Falha recuperável | Timeout/5xx/limite temporário. | Aviso persistente com “Tentar novamente”; manter outbox. | Continuar offline; retry exponencial com jitter. |
| Acesso negado | Papel sem permissão ou recurso de outra organização. | Mensagem neutra; não revelar existência de objeto alheio. | Voltar ou solicitar acesso ao administrador. |

### 1.7 Acessibilidade e operação no chão de fábrica

- Conformidade alvo WCAG 2.2 AA; contraste de texto normal `≥4.5:1`, texto grande e componentes gráficos `≥3:1`.
- Foco visível permanente; sequência de Tab acompanha ordem de leitura; teclado completo para tabela, filtros, menus, modais, drag alternative e resolução de conflito.
- Alvos de toque `≥44×44 CSS px`; suporte a zoom de 200%; nenhuma informação transmitida somente por cor.
- Inputs de tempo exibem unidade “s”; moeda indica `R$/peça` ou `R$/turno`; descrições de gráfico incluem dados tabulares acessíveis.
- Tabelas conservam cabeçalho em scroll, permitem fixar coluna de nome e exibem foco e edição sem depender de hover.
- Anúncios de alteração agregada usam `aria-live="polite"`; erros críticos e conflito usam `assertive` somente quando a ação precisa de resposta imediata.

---

## 2. UI DESIGN SYSTEM & FRONT-END SPECIFICATION

### 2.1 Direção visual e referências

Preservar a leitura industrial da tela atual: cabeçalho azul-marinho, ouro como acento, vermelho para gargalo/estado atual, verde para condição futura atendida e azul para barras regulares. Evoluir o painel para organização visual mais limpa e tolerante a telas menores. O tema escuro é fosco, sem neon; o tema claro é técnico e de alto contraste.

O ícone fornecido deve ser tratado como marca gráfica: fundo `#103653`, símbolo dourado `#F4BA25`, cronômetro como cronoanálise, barras como distribuição de cargas e conexão geométrica como precedência/sincronização. Preservar desenho e proporção; gerar derivados SVG/PNG em tamanhos `16, 32, 48, 192, 512 px`, máscara PWA e favicon sem alterar o conceito. O ícone não deve ser refeito com texto renderizado em imagem.

### 2.2 Tokens cromáticos semânticos

Os tokens abaixo são contratos; componentes devem consumir tokens semânticos, nunca valores hex avulsos. O tema pode ser definido por `[data-theme="light"]` ou `[data-theme="dark"]`.

| Token | Light Industrial | Matte Obsidian Dark | Uso |
|---|---:|---:|---|
| `--brand-navy-900` | `#103653` | `#103653` | Marca, header, navegação ativa. |
| `--brand-navy-700` | `#174765` | `#174765` | Header secundário, tabela destacada. |
| `--accent-gold` | `#F4BA25` | `#F4BA25` | Ação primária, destaque de foco de marca. |
| `--bg-canvas` | `#F3F6F8` | `#171B1F` | Fundo geral. |
| `--bg-surface` | `#FFFFFF` | `#22282D` | Painel e cartão. |
| `--bg-surface-raised` | `#F8FAFB` | `#2B3339` | Popover, painel elevado. |
| `--bg-input` | `#FFFFFF` | `#1D2328` | Campos editáveis. |
| `--border-subtle` | `#CFD8DE` | `#46515A` | Separadores e bordas discretas. |
| `--border-strong` | `#82939E` | `#71808A` | Controles focados/limites de painel. |
| `--text-primary` | `#17252E` | `#F2F5F6` | Texto principal. |
| `--text-secondary` | `#425661` | `#C1CCD2` | Texto secundário. |
| `--text-muted` | `#5C707B` | `#9BAAB2` | Ajuda; nunca texto crítico pequeno. |
| `--semantic-bottleneck` | `#C92C31` | `#EF6267` | Gargalo/alerta atual; adicionar ícone e rótulo. |
| `--semantic-bottleneck-surface` | `#FFF2F1` | `#3A2527` | Fundo de alerta/gargalo. |
| `--semantic-balanced` | `#16822C` | `#48B765` | Linha futura dentro do Takt, validada visualmente por rótulo. |
| `--semantic-balanced-surface` | `#EAF7ED` | `#20372A` | Fundo de condição equilibrada. |
| `--chart-bar` | `#2584BD` | `#4BA5D8` | Postos sem destaque. |
| `--chart-bottleneck` | `#CE2D33` | `#EF6267` | Barra do posto gargalo. |
| `--chart-takt` | `#A86600` | `#F4BA25` | Linha tracejada de Takt e legenda. |
| `--delta-good` | `#16822C` | `#48B765` | Redução/ganho favorável. |
| `--delta-bad` | `#B4232A` | `#EF6267` | Variação desfavorável. |
| `--focus-ring` | `#005FCC` | `#79B8FF` | Indicador de foco acessível. |
| `--overlay` | `rgb(16 54 83 / 42%)` | `rgb(0 0 0 / 62%)` | Modal e drawer. |

O status futuro é semântico: verde só quando `Takt > 0` e `TC_futuro <= Takt`. Em hipótese não validada, usar verde com rótulo “projeção atende ao Takt”, sem selo “ganho realizado”. Vermelho representa gargalo/violação, nunca simplesmente um valor financeiro negativo sem explicação.

### 2.3 Tokens de forma, espaçamento e movimento

| Grupo | Escala contratual |
|---|---|
| Tipografia | Família `Inter, system-ui, sans-serif`; fallback nativo; títulos `24/32/40 px`; corpo `14–16 px`; metadados mínimo `12 px`. |
| Números | `font-variant-numeric: tabular-nums lining-nums`; obrigatório em inputs numéricos, células, gráficos, tabelas, cartões KPI e comparação. |
| Espaçamento | Base 4 px: `--space-1:4px`, `2:8px`, `3:12px`, `4:16px`, `5:20px`, `6:24px`, `8:32px`, `10:40px`, `12:48px`. |
| Raios | `--radius-sm:4px`, `md:8px`, `lg:12px`, `xl:16px`, `pill:999px`. |
| Elevação | Light: sombras neutras de baixa opacidade; Dark: borda primeiro, sombra discreta; sem glow/neon. |
| Motion | 120–180 ms para estados locais; curva `cubic-bezier(.2,.8,.2,1)`; respeitar `prefers-reduced-motion`. |
| Densidade | `compact`, `comfortable`; padrão `comfortable`; preferências do usuário persistidas no perfil. |

Exemplo normativo:

```css
:root {
  font-variant-numeric: tabular-nums lining-nums;
  --content-max: 1600px;
  --target-touch: 44px;
}
[data-theme="light"] { color-scheme: light; }
[data-theme="dark"] { color-scheme: dark; }
.numeric, input[type="number"], td[data-numeric], .kpi-value {
  font-variant-numeric: tabular-nums lining-nums;
}
```

### 2.4 Tipos centrais do front-end

```ts
type UUID = string;
type DecimalString = string; // decimal canônico; não usar float para persistência

type Scenario = "current" | "future";
type SyncState =
  | { kind: "local-saved"; pending: number }
  | { kind: "syncing"; pending: number; total: number }
  | { kind: "synced"; version: number; syncedAt: string }
  | { kind: "conflict"; serverVersion: number; conflictingPaths: string[] }
  | { kind: "offline"; pending: number }
  | { kind: "error"; pending: number; retryable: boolean };

interface StudyParameters {
  name: string;
  productFamily: string;
  shiftSeconds: DecimalString;
  demandPerShift: DecimalString;
  productiveDaysPerMonth: number;
  baselineUnitsPerDay: DecimalString;
  laborCostPerShiftCurrent: DecimalString;
  laborCostPerShiftFuture: DecimalString;
}
interface Area {
  id: UUID;
  name: string;
  operationalCostPerPieceCurrent: DecimalString;
  operationalCostPerPieceFuture: DecimalString;
  sortOrder: number;
}
interface WorkElement {
  id: UUID;
  areaId: UUID;
  name: string;
  current: { stationId: UUID; vaSeconds: DecimalString; nvaSeconds: DecimalString };
  future: { stationId: UUID; vaSeconds: DecimalString; nvaSeconds: DecimalString };
  ergonomicZone: "green" | "yellow" | "red" | null;
  fixedEquipmentId: UUID | null;
  validation: { status: "hypothesis" | "validated"; validatedAt: string | null; validatedBy: UUID | null; evidenceRef: string | null };
}
interface ScenarioMetrics {
  stationLoadsSeconds: Record<UUID, DecimalString>;
  cycleSeconds: DecimalString;
  bottleneckStationIds: UUID[];
  theoreticalCapacityPerShift: DecimalString | null;
  meetsTakt: boolean | null;
}
interface StudyViewModel {
  id: UUID;
  version: number;
  parameters: StudyParameters;
  areas: Area[];
  elements: WorkElement[];
  current: ScenarioMetrics;
  future: ScenarioMetrics;
  sync: SyncState;
}
```

`DecimalString` must be converted to a decimal library/domain value before arithmetic. JavaScript `number` may only be used for drawing coordinates and non-authoritative animation; chart labels derive from canonical decimal calculations.

### 2.5 Component contracts

| Componente | Entradas/props | Estado local | Eventos/contrato |
|---|---|---|---|
| `HeroHeader` | `studyName`, `syncState`, `user`, `permissions`, `installAvailable`, `revision` | menu do usuário, menu de exportação, confirmação de instalação | `onInstall()`, `onExport({format:"json"\|"csv"\|"xlsx", scope:"study"\|"report"})`, `onImport(file)`, `onOpenAudit()`, `onOpenRevisionHistory()`; esconder ações sem permissão. |
| `ProjectControlBar` | `parameters`, `derived.taktSeconds`, `permissions`, `validationErrors` | campo ativo, confirmação de premissa financeira | `onParameterChange({field,value,clientMutationId})`; parâmetros aceitos: `name`, `productFamily`, `shiftSeconds`, `demandPerShift`, `productiveDaysPerMonth`, `baselineUnitsPerDay`, `laborCostPerShiftCurrent`, `laborCostPerShiftFuture`. Totais não pertencem aqui. |
| `ScenarioComparisonCharts` | `current`, `future`, `stations`, `taktSeconds`, `selectedScenario`, `locale` | tooltip, seleção de posto, zoom opcional | `onStationSelect({scenario,stationId})`; cada gráfico oferece tabela acessível idêntica; destacar todos os postos empatados no máximo, e desenhar linha Takt somente quando `Takt > 0`. |
| `WorkCompositionMatrix` | `areas`, `elements`, `stations`, `selectedScenario`, `permissions`, `violations`, `density` | área expandida, ordenação, filtros, seleção múltipla, drawer do elemento | `onElementPatch({elementId,patch,baseVersion,clientMutationId})`, `onMoveElements({elementIds,scenario,targetStationId})`, `onCreateArea`, `onCreateElement`, `onDeleteElement`, `onReorderAreas`; campos agregados são derivados e sem handlers de edição. |
| `ComparativeKPIsPanel` | `currentMetrics`, `futureMetrics`, `areaCostCurrent`, `areaCostFuture`, `assumptions`, `validationSummary` | painel de premissas expandido | somente eventos de navegação `onOpenAssumptions()` e `onOpenValidation()`; valores derivados read-only. CMO e custo operacional ocupam linhas diferentes. |
| `ExecutiveResultsBand` | delta de ciclo/capacidade/CMO/economia, `scenarioStatus`, `validationStatus`, `revision` | nenhum estado de domínio | `onOpenApproval()`; conclusão dinâmica deve dizer “potencial/estimado” até validação e aprovação formal. |
| `SyncStatus` | `syncState`, `lastSync`, `queueItems` | detalhes de fila abertos/fechados | `onRetry()`, `onResolveConflict(choice)`, `onExportLocalBackup()`; nunca descartar fila sem confirmação. |
| `PrecedenceGraph` | `elements`, `precedences`, `stations`, `violations`, `selectedElementId` | viewport, nó selecionado | `onPrecedenceCreate`, `onPrecedenceDelete`, `onElementSelect`; rejeitar ciclos antes de persistir. |

### 2.6 Gráficos e apresentação numérica

- Gráficos são derivados de soma dos elementos alocados. Eixo `y` sempre começa em zero, unidade `s`, ticks adequados à faixa e uma linha horizontal tracejada para o Takt válido.
- Cores: barras regulares `--chart-bar`; todo posto empatado com ciclo máximo usa `--chart-bottleneck`; futuramente, o gargalo atual é destacado apenas no painel atual. Não presumir que o maior posto é o gargalo se ciclo inválido/sem elementos.
- Rótulo textual no card: `Gargalo: F3 · 256,3 s`; se empate, `Gargalo compartilhado: F2 e F3 · 150 s`.
- Linha futura: `Atende ao Takt (teórico)` apenas se `Takt > 0` e `TC_futuro <= Takt`; caso contrário mostrar `X s acima do Takt`. Sem Takt, mostrar “Informe demanda e tempo disponível”.
- Formatação `pt-BR`, decimal com vírgula, moeda BRL; comparação financeira usa sinal e semântica textual além da cor. Mostrar precisão de tempo de até uma casa por padrão e três no detalhe; precisão interna não é truncada.

### 2.7 Responsividade

| Faixa | Layout obrigatório |
|---|---|
| `≥1600 px` | Shell centrado com `max-width:1600px`; barra de parâmetros em grid; comparação atual/futuro lado a lado; matriz e KPIs em proporção aproximada `3:2`. |
| `1025–1599 px` | Shell fluido com padding 24 px; gráficos lado a lado enquanto cada card tiver largura mínima de 360 px; composição em duas colunas se couber. |
| `768–1024 px` | Tablet de fábrica: padding 16 px; cabeçalho compacto; parâmetros em 2 colunas; gráficos empilhados ou em carrossel com indicadores de posição; matriz em área expansível com colunas numéricas roláveis; controles touch. |
| `<768 px` | Mobile: padding 12 px; navegação em etapas compacta; parâmetros em lista/drawer; gráficos empilhados; uma área/elemento por card ou tabela horizontal com primeira coluna fixa; KPI em grade 2 colunas; drawer vira tela; sem drag obrigatório. |
| `≥1600 px` | Nenhum conteúdo essencial pode ultrapassar o shell nem exigir scroll horizontal da página; tabela larga pode ter scroll interno controlado. |

### 2.8 Fronteiras de estado e performance

- **Estado de domínio:** store central normalizado por `studyId`, `areaId`, `elementId`; reducers puros para comandos locais; seleções, drawer e filtros não são persistidos na revisão.
- **Estado local durável:** snapshot IndexedDB, outbox, IDs de mutação e preferência de tema/densidade.
- **Estado do servidor:** estudo atual, revisão e ETag; invalidar/refetch após aplicação de revisão.
- **Derivações:** módulo puro `domain/calculations`; proibir cópia dos cálculos em componentes.
- **Renderização:** atualizar só cartões/áreas/postos afetados; entrada não pode perder foco durante renderização; usar virtualização em listas acima de 200 elementos.
- **Orçamento de desempenho:** cálculo local p95 <16 ms até 500 elementos; primeira renderização interativa p75 <2,5 s em desktop de referência e <4 s em tablet de fábrica com rede 4G; alterações de input não podem disparar download de bundle ou requisição para cada tecla.

---

## 3. BACK-END & DATA ARCHITECTURE SPECIFICATION

### 3.1 Arquitetura lógica

```text
React/TypeScript PWA
  ├─ domínio local + cálculos puros
  ├─ IndexedDB: snapshot, cache, outbox e migração local
  └─ REST HTTPS + OIDC/JWT + ETag
             ↓
FastAPI: authz → schema validation → use cases → domain rules
             ↓ transação
PostgreSQL: tenant → study → areas/elements/constraints/revisions/audit
             ↓
Worker de otimização: solver CP-SAT determinístico com limite de execução
```

- A API e o otimizador não podem aceitar valores agregados do cliente como verdade. Validam entidades, recalculam métricas no servidor e armazenam somente inputs editáveis e resultados derivados/versionados necessários para consulta.
- O worker é assíncrono para otimizações que possam exceder 500 ms. Retorno inicial `202 Accepted` com `jobId`; polling `GET /api/v1/optimization-jobs/{jobId}`. Uma otimização nunca altera o estudo; devolve proposta identificada pela revisão/versão de origem.
- PostgreSQL é fonte compartilhada autoritativa. IndexedDB é fonte operacional local enquanto offline, nunca um mecanismo de sincronização implícita entre usuários.
- O deploy deve separar web, API, worker e banco; migrações SQL versionadas e rollback planejado. Comunicação entre serviços usa TLS; segredos não entram no bundle front-end.

### 3.2 Modelo de dados e invariantes

#### Regras de domínio formais

Para cada elemento `e`:

```text
T_atual(e)  = VA_atual(e)  + NVA_atual(e)
T_futuro(e) = VA_futuro(e) + NVA_futuro(e)
```

Para cada posto existente `F_i` e cenário `s`:

```text
C_s(F_i) = Σ T_s(e), para todo e alocado em F_i no cenário s
TC_s = max_i C_s(F_i)
Bottleneck_s = { F_i | C_s(F_i) = TC_s }
Takt = shift_seconds / demand_per_shift, quando demanda > 0
Cap_s = shift_seconds / TC_s, quando TC_s > 0
CMO_s = labor_cost_per_shift_s / Cap_s, quando Cap_s > 0
Delta_month = (CMO_current - CMO_future) × baseline_units_per_day × productive_days_per_month
```

- `Areas.va/nva/total`, `Stations.load`, `TC`, `Bottleneck`, `Takt`, `Capacity`, `CMO` e deltas são projeções calculadas; nunca recebem `PATCH` independente.
- Custos operacionais atribuídos por área (`operational_cost_per_piece_current/future`) são somados separadamente e **não** entram em CMO nem em `Delta_month`.
- Unidade monetária é BRL; a fórmula mensal representa potencial teórico com produção-base informada. Não aplicar saturação, perdas, OEE ou arredondamento, pois não foram especificados como variáveis do modelo. A interface deve exibir a premissa.
- Se `demand_per_shift = 0`, Takt é `null` e estado `not_evaluable`; API rejeita valor negativo, mas permite zero para rascunho/estudo incompleto.
- Se `TC = 0`, capacidade/CMO são `null`, não infinito nem zero; se elemento soma zero, continua válido, mas cenário sem carga é “não avaliável”.
- `shift_seconds > 0`, `demand_per_shift >= 0`, `productive_days_per_month ∈ [0,31]`, `baseline_units_per_day >= 0`, custos e tempos `>=0`; tempos têm no máximo três casas decimais; dinheiro no máximo duas casas decimais.
- Posto indexado de cenário deve existir: `1 ≤ station_index ≤ station_count ≤ 20` no import legado. A versão corporativa permite configuração até 100 postos por estudo; limite de import v1/v2 continua 20 para compatibilidade.
- Empate no máximo produz múltiplos gargalos. Capacidades são decimais; arredondamento `ROUND_HALF_UP` a duas casas só na UI/exportação.

#### Algoritmo de balanceamento

**Entradas:** elementos com tempo futuro `VA+NVA`, número alvo de postos, precedências, equipamento fixo (monumento), zonas ergonômicas, tempo de ciclo alvo opcional (por padrão Takt válido), cenário base e versão do estudo.

**Restrições duras:**

1. Cada elemento pertence a exatamente uma área e exatamente um posto futuro.
2. Atribuição a posto deve respeitar equipamento/monumento fixo; elemento ligado a equipamento com posto fixo não pode ser movido para outro posto.
3. Para precedência `u → v`, a ordem do posto deve satisfazer `station(u) <= station(v)`. Se no mesmo posto houver sequência interna registrada, `order(u) < order(v)`; sem sequência interna, o solver deve retornar erro de dados de ordenação e não inventar ordem.
4. Ciclo no grafo é inválido; rejeitar antes de solver com lista de arestas que formam ciclo.
5. Zonas ergonômicas `red` não podem ser alocadas sem exceção formal aprovada por usuário Admin/Engenheiro autorizado com motivo, responsável, timestamp e expiração. Zonas `yellow` geram penalidade/alerta, não bloqueiam. Zona `green` não tem penalidade.
6. Elemento sem tempo futuro válido, posto inexistente, equipamento sem posto ou ciclo na precedência impede execução.
7. Não dividir elemento de trabalho entre postos na versão 1.0. Paralelismo ou divisão requer decomposição prévia em novos elementos e novas precedências.

**Objetivo lexicográfico determinístico:**

1. Encontrar solução que satisfaça todas as restrições duras.
2. Se Takt válido e a meta for `meetTakt=true`, minimizar número de postos adicionais até `maxStations`; se inviável, devolver melhor ciclo obtido e causa de inviabilidade, sem afirmar atendimento.
3. Minimizar `max_i C(F_i)` (ciclo da linha).
4. Minimizar soma de penalidades de ergonomia amarela e movimento em relação ao cenário-base, usando pesos configuráveis/versionados.
5. Desempate determinístico por ordem topológica estável e UUID lexical, garantindo mesma entrada/semente produz mesma solução.

Usar OR-Tools CP-SAT ou solver equivalente. Limite inicial: 5 s para até 500 elementos/20 postos; 15 s para até 2.000 elementos/100 postos. Solver produz `optimal`, `feasible_timeout`, `infeasible` ou `invalid_input`, com gap/limite quando aplicável. `feasible_timeout` pode ser aplicada após confirmação, com rótulo “melhor solução encontrada dentro do limite”, não “ótimo”. Cada resposta inclui explicação de restrições satisfeitas e violadas; violações de restrições duras implicam proposta não aplicável.

**Verificador independente:** antes de mostrar “Aplicar proposta”, recalcular todas as somas e verificar DAG, equipamento, ergonomia e posto no domínio do servidor. Proposta não passa se `inputVersion` já não for igual ao ETag atual.

### 3.3 Esquema SQL PostgreSQL

DDL normativo resumido; migrations devem aplicar enum/check/índices correspondentes. Timestamps em UTC; interface converte para `America/Manaus` conforme perfil.

```sql
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 160),
  slug text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id uuid PRIMARY KEY,
  oidc_subject text NOT NULL UNIQUE,
  email text NOT NULL,
  display_name text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE organization_memberships (
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  role text NOT NULL CHECK (role IN ('admin','engineer','viewer')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, user_id)
);

CREATE TABLE studies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 160),
  product_family text NOT NULL DEFAULT '' CHECK (length(product_family) <= 120),
  shift_seconds numeric(12,3) NOT NULL CHECK (shift_seconds > 0),
  demand_per_shift numeric(12,3) NOT NULL DEFAULT 0 CHECK (demand_per_shift >= 0),
  productive_days_per_month smallint NOT NULL DEFAULT 22 CHECK (productive_days_per_month BETWEEN 0 AND 31),
  baseline_units_per_day numeric(12,3) NOT NULL DEFAULT 0 CHECK (baseline_units_per_day >= 0),
  labor_cost_current numeric(14,2) NOT NULL DEFAULT 0 CHECK (labor_cost_current >= 0),
  labor_cost_future numeric(14,2) NOT NULL DEFAULT 0 CHECK (labor_cost_future >= 0),
  current_station_count smallint NOT NULL DEFAULT 1 CHECK (current_station_count BETWEEN 1 AND 100),
  future_station_count smallint NOT NULL DEFAULT 1 CHECK (future_station_count BETWEEN 1 AND 100),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','in_review','approved','archived')),
  version bigint NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  updated_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE INDEX studies_org_updated_idx ON studies(organization_id, updated_at DESC) WHERE deleted_at IS NULL;

CREATE TABLE areas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  study_id uuid NOT NULL REFERENCES studies(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 120),
  sort_order integer NOT NULL DEFAULT 0,
  operational_cost_current numeric(14,2) NOT NULL DEFAULT 0 CHECK (operational_cost_current >= 0),
  operational_cost_future numeric(14,2) NOT NULL DEFAULT 0 CHECK (operational_cost_future >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (study_id, id),
  UNIQUE (study_id, sort_order)
);
CREATE INDEX areas_study_order_idx ON areas(study_id, sort_order);

CREATE TABLE equipment_resources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  study_id uuid NOT NULL REFERENCES studies(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 160),
  fixed_station_index smallint CHECK (fixed_station_index BETWEEN 1 AND 100),
  UNIQUE (study_id, id)
);

CREATE TABLE line_stations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  study_id uuid NOT NULL REFERENCES studies(id) ON DELETE CASCADE,
  scenario text NOT NULL CHECK (scenario IN ('current','future')),
  station_index smallint NOT NULL CHECK (station_index BETWEEN 1 AND 100),
  label text NOT NULL,
  fixed_equipment_id uuid,
  UNIQUE (study_id, scenario, station_index),
  UNIQUE (study_id, scenario, id),
  FOREIGN KEY (study_id, fixed_equipment_id) REFERENCES equipment_resources(study_id, id) ON DELETE RESTRICT
);

CREATE TABLE work_elements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  study_id uuid NOT NULL REFERENCES studies(id) ON DELETE CASCADE,
  area_id uuid NOT NULL,
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 200),
  sort_order integer NOT NULL DEFAULT 0,
  current_va_seconds numeric(12,3) NOT NULL CHECK (current_va_seconds >= 0),
  current_nva_seconds numeric(12,3) NOT NULL CHECK (current_nva_seconds >= 0),
  future_va_seconds numeric(12,3) NOT NULL CHECK (future_va_seconds >= 0),
  future_nva_seconds numeric(12,3) NOT NULL CHECK (future_nva_seconds >= 0),
  fixed_equipment_id uuid,
  ergonomic_zone text CHECK (ergonomic_zone IN ('green','yellow','red')),
  ergonomic_exception jsonb,
  validation_status text NOT NULL DEFAULT 'hypothesis' CHECK (validation_status IN ('hypothesis','validated')),
  validated_at timestamptz,
  validated_by uuid REFERENCES users(id) ON DELETE RESTRICT,
  evidence_ref text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (study_id, area_id) REFERENCES areas(study_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (study_id, fixed_equipment_id) REFERENCES equipment_resources(study_id, id) ON DELETE RESTRICT,
  UNIQUE (study_id, id)
);

CREATE TABLE element_assignments (
  study_id uuid NOT NULL,
  element_id uuid NOT NULL,
  scenario text NOT NULL CHECK (scenario IN ('current','future')),
  station_id uuid NOT NULL,
  sequence_order integer NOT NULL DEFAULT 1 CHECK (sequence_order >= 1),
  PRIMARY KEY (element_id, scenario),
  FOREIGN KEY (study_id, element_id) REFERENCES work_elements(study_id, id) ON DELETE CASCADE,
  FOREIGN KEY (study_id, scenario, station_id) REFERENCES line_stations(study_id, scenario, id) ON DELETE RESTRICT
);
CREATE INDEX work_elements_area_idx ON work_elements(study_id, area_id, sort_order);
CREATE INDEX element_assignments_station_idx ON element_assignments(study_id, scenario, station_id, sequence_order);

CREATE TABLE element_precedences (
  study_id uuid NOT NULL REFERENCES studies(id) ON DELETE CASCADE,
  predecessor_id uuid NOT NULL,
  successor_id uuid NOT NULL,
  created_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (study_id, predecessor_id, successor_id),
  CHECK (predecessor_id <> successor_id),
  FOREIGN KEY (study_id, predecessor_id) REFERENCES work_elements(study_id, id) ON DELETE CASCADE,
  FOREIGN KEY (study_id, successor_id) REFERENCES work_elements(study_id, id) ON DELETE CASCADE
);
CREATE INDEX precedence_successor_idx ON element_precedences(study_id, successor_id);

CREATE TABLE study_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  study_id uuid NOT NULL REFERENCES studies(id) ON DELETE RESTRICT,
  revision_number bigint NOT NULL,
  source_version bigint NOT NULL,
  snapshot jsonb NOT NULL,
  change_summary text NOT NULL CHECK (length(change_summary) BETWEEN 1 AND 500),
  created_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (study_id, revision_number),
  UNIQUE (study_id, source_version)
);
CREATE INDEX revisions_study_time_idx ON study_revisions(study_id, created_at DESC);

CREATE TABLE audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  study_id uuid REFERENCES studies(id) ON DELETE RESTRICT,
  actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid,
  before_data jsonb,
  after_data jsonb,
  reason text,
  request_id text NOT NULL,
  client_mutation_id uuid,
  occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_study_time_idx ON audit_logs(study_id, occurred_at DESC);
CREATE INDEX audit_org_time_idx ON audit_logs(organization_id, occurred_at DESC);
```

A chave primária `(element_id, scenario)` permite exatamente uma alocação de cada elemento por cenário. Os dois FKs compostos garantem que o elemento e o posto pertençam ao mesmo estudo e que o posto pertença ao cenário informado. A aplicação também valida que `fixed_station_index` do equipamento corresponde ao posto escolhido; uma atribuição incompatível é rejeitada antes de gravar.

### 3.4 Revisões e auditoria

- Cada transação de alteração válida incrementa `studies.version` em 1, registra `audit_logs` e cria snapshot imutável em `study_revisions` na mesma transação. Alterações de foco/filtro e leituras não criam revisão.
- Uma proposta do solver não é revisão até ser aplicada. Ao aplicar, verificar ETag de entrada, recalcular, persistir alocações e revisão como uma transação atômica.
- Aprovação de estudo grava `status=approved`, usuário, data, revisão aprovada e resumo das premissas. Aprovar nova revisão exige reaprovação; o estado aprovado anterior continua no histórico, mas a nova versão fica em `in_review`/`draft`.
- Eventos de auditoria mínimos: criação, importação, atualização de tempo, alteração de premissas de turno/demanda/volume/custo, alteração de custo de área, criação/remoção/movimentação de elemento, mudança de precedência, exceção ergonômica, otimização aplicada, mudança de estado, aprovação, exportação e resolução de conflito.
- Auditoria é append-only para papéis de aplicação; nenhum endpoint de edição/exclusão. Armazenar valores anteriores/novos apenas dos campos alterados, evitar dados pessoais e texto livre excessivo.

### 3.5 Contratos REST

#### Convenções

- Base `/api/v1`; JSON UTF-8; TLS obrigatório; datas ISO-8601 UTC; UUID minúsculo; decimal transmitido como string decimal canônica.
- Autorização OIDC Bearer JWT; `organizationId` derivado do contexto autorizado, nunca confiado apenas no body.
- `GET /studies/{id}` retorna `ETag: "study-{id}-v{version}"`. Escritas exigem `If-Match` igual ao ETag da versão base. `POST` de criação recebe `Idempotency-Key`.
- Mutação offline inclui `clientMutationId` UUID; servidor armazena resultado por organização/estudo/mutation ID. Repetição retorna a resposta original, sem nova auditoria ou revisão.
- Erros seguem Problem Details (`application/problem+json`) com `type`, `title`, `status`, `detail`, `instance`, `code`, `fieldErrors`, `requestId`.

#### `POST /api/v1/studies`

Cria estudo rascunho e entidades iniciais em transação. `201 Created`, `Location`, `ETag`.

```json
{
  "name": "Linha de montagem — Estudo 2026-11",
  "productFamily": "Produto A",
  "parameters": {
    "shiftSeconds": "27000",
    "demandPerShift": "180",
    "productiveDaysPerMonth": 22,
    "baselineUnitsPerDay": "35.2",
    "laborCostPerShiftCurrent": "1710.00",
    "laborCostPerShiftFuture": "1425.00"
  },
  "stations": { "current": 6, "future": 5 },
  "areas": [
    { "clientId": "a-1", "name": "Recebimento", "sortOrder": 1,
      "operationalCostPerPieceCurrent": "0.81", "operationalCostPerPieceFuture": "0.63" }
  ],
  "elements": [
    { "clientId": "e-1", "areaClientId": "a-1", "name": "Separar material", "sortOrder": 1,
      "current": { "stationIndex": 1, "vaSeconds": "24", "nvaSeconds": "12" },
      "future": { "stationIndex": 1, "vaSeconds": "24", "nvaSeconds": "4" },
      "ergonomicZone": "green", "fixedEquipmentId": null }
  ],
  "precedences": []
}
```

#### `GET /api/v1/studies/{studyId}`

Retorna estudo, áreas, elementos, postos, precedências, métricas derivadas, status, versão e resumo de validação. Resposta omite dados de outras organizações. `404` para ID inexistente e para ID fora do escopo autorizado.

```json
{
  "id": "01900000-0000-7000-8000-000000000001",
  "version": 7,
  "etag": "\"study-01900000-0000-7000-8000-000000000001-v7\"",
  "status": "draft",
  "name": "Linha de montagem — Estudo 2026-11",
  "productFamily": "Produto A",
  "parameters": {
    "shiftSeconds": "27000", "demandPerShift": "180",
    "taktSeconds": "150", "productiveDaysPerMonth": 22,
    "baselineUnitsPerDay": "35.2",
    "laborCostPerShiftCurrent": "1710.00", "laborCostPerShiftFuture": "1425.00"
  },
  "stations": { "current": [{"id":"01900000-0000-7000-8000-000000000002","index":1,"label":"F1","loadSeconds":"70"}],
                "future": [{"id":"01900000-0000-7000-8000-000000000003","index":1,"label":"F1","loadSeconds":"152"}] },
  "areas": [{ "id":"01900000-0000-7000-8000-000000000004", "name":"Recebimento", "sortOrder":1,
              "derivedCurrent":{"vaSeconds":"46","nvaSeconds":"24","totalSeconds":"70"},
              "derivedFuture":{"vaSeconds":"46","nvaSeconds":"9","totalSeconds":"55"},
              "operationalCostPerPieceCurrent":"0.81", "operationalCostPerPieceFuture":"0.63" }],
  "elements": [], "precedences": [],
  "metrics": { "current":{"cycleSeconds":"256.3","bottleneckStationIds":["01900000-0000-7000-8000-000000000005"],"theoreticalCapacityPerShift":"105.267"},
               "future":{"cycleSeconds":"154","bottleneckStationIds":["01900000-0000-7000-8000-000000000003"],"theoreticalCapacityPerShift":"175.325"},
               "futureMeetsTakt":false,
               "cmoPerPieceCurrent":"16.23", "cmoPerPieceFuture":"8.13",
               "monthlyLaborSavingEstimate":"6276.00",
               "operationalCostCurrent":"8.04", "operationalCostFuture":"5.63" },
  "validation": { "isValid": true, "hypothesisCount": 15, "unresolvedWarnings": [] }
}
```

Fields in `metrics` are server-derived, with `null` in place of undefined values. Example values are illustrative and must not be hardcoded; they may differ from a particular seed or revision.

#### `PATCH /api/v1/studies/{studyId}/elements/batch`

Applies 1–100 element/area/parameter changes atomically; maximum request body 1 MiB. Required headers: `If-Match`, `Idempotency-Key`. Reject duplicate target/field operations in one batch. `200 OK` returns new version, ETag, canonical entities, derived metrics and per-operation result. Failure rejects entire batch.

```json
{
  "clientMutationId": "01900000-0000-7000-8000-0000000000aa",
  "operations": [
    { "op":"replace", "entity":"workElement", "id":"01900000-0000-7000-8000-000000000006",
      "changes":{"future.nvaSeconds":"3.5"} },
    { "op":"move", "entity":"workElement", "id":"01900000-0000-7000-8000-000000000006",
      "changes":{"future.stationIndex":3} },
    { "op":"replace", "entity":"studyParameters", "changes":{"demandPerShift":"185"} }
  ]
}
```

Allowed `workElement` patch paths: `name`, `areaId`, `sortOrder`, `current.stationIndex`, `current.vaSeconds`, `current.nvaSeconds`, `future.stationIndex`, `future.vaSeconds`, `future.nvaSeconds`, `ergonomicZone`, `fixedEquipmentId`, `validation.status`, `validation.evidenceRef`. Allowed `area` patch paths: `name`, `sortOrder`, `operationalCostPerPieceCurrent`, `operationalCostPerPieceFuture`. Allowed `studyParameters`: fields enumerated in §2.4, with `stations.current/future` changed only through the dedicated station endpoints. No paths beginning with `metrics`, `derived`, `cycle`, `capacity`, `bottleneck`, `takt` are writable.

#### `POST /api/v1/studies/{studyId}/optimize`

Request is read-only against a specific study version and returns a proposal. `202 Accepted` for job execution; `200 OK` permitted for completed synchronous result under 500 ms.

```json
{
  "inputVersion": 7,
  "scenario": "future",
  "targetStationCount": 5,
  "maxStationCount": 20,
  "meetTakt": true,
  "cycleTargetSeconds": "150",
  "weights": { "yellowErgonomicZone": 100, "moveFromBaseline": 1 },
  "solverTimeLimitSeconds": 5
}
```

Completed result:

```json
{
  "jobId":"01900000-0000-7000-8000-0000000000bb",
  "status":"feasible_timeout",
  "inputVersion":7,
  "objective":{"cycleSeconds":"149.5","targetMet":true,"optimalityGap":"0.02"},
  "assignments":[{"elementId":"01900000-0000-7000-8000-000000000006","stationIndex":1,"sequence":1}],
  "checks":{"precedence":"pass","fixedEquipment":"pass","ergonomics":"pass","takt":"pass"},
  "warnings":["Solução viável encontrada dentro do limite; otimalidade não comprovada."],
  "canApply":true
}
```

`canApply` only true when every hard constraint passes, input version still current at application time, and solver status is `optimal` or `feasible_timeout`. Infeasible result includes a structured conflict set and no assignments marked applicable.

`POST /api/v1/studies/{studyId}/optimization-proposals/{proposalId}/apply` requires `If-Match` equal to `inputVersion`; recalculates validations server-side, persists all assignment changes and one revision atomically.

#### `POST /api/v1/studies/import-legacy`

- Requires authenticated Engineer/Admin, `Idempotency-Key`, body max 5 MiB, JSON only.
- Accepts `schemaVersion:1` and `schemaVersion:2` formats exported by MVP. Max 500 elements, 100 areas, 20 stations per scenario, 200 precedence edges on import (v1/v2 have no precedence; the importer initializes empty graph).
- Validate duplicate/missing names and references, finite nonnegative decimals, exact array sizes and file depth ≤16; reject `__proto__`, `constructor`, `prototype` keys and unknown oversized fields. No partial import.
- Aceitar tanto `version` (export nativo do MVP 0.2) quanto `schemaVersion` (envelope da API); normalizar para `schemaVersion` no pipeline. V1 `operations[]` mapeia cada operação para uma área e um elemento de mesmo nome; custos são copiados para a área. Posto atual segue a ordem original, limitado a `currentStationCount` (`F1..Fn`); posto futuro é gerado pela heurística legada: elementos ordenados por tempo futuro decrescente, desempate pela ordem original, alocação ao posto com menor carga acumulada, desempate pelo menor índice. Preservar hash da origem e relatório; não declarar que os agregados antigos foram medições de elementos.
- V2 `areas[]` mapeia para áreas; `elements[]` para elementos; `element.area` é resolvido por igualdade exata após normalização Unicode NFC e trim. Preservar parâmetros e alocações atuais/futuras. Referência ausente ou ambígua é erro com caminho JSON; não criar área implícita.
- Return `201` with new study ID, new version, warnings and mapping counts. Browser migration of localStorage v1 follows the same mapping rules and stores a v2 IndexedDB snapshot only after successful validation; original localStorage keys remain untouched until user verifies migration/export.

#### Endpoints adicionais obrigatórios

| Método e rota | Resultado |
|---|---|
| `GET /api/v1/studies?cursor=&limit=&status=` | Lista paginada apenas da organização autorizada; `limit` 1–100; cursor opaco. |
| `POST /api/v1/studies/{id}/areas` / `DELETE /api/v1/studies/{id}/areas/{areaId}` | Criar área; excluir somente se não houver elementos; `409 AREA_NOT_EMPTY` com IDs se houver. |
| `POST /api/v1/studies/{id}/elements` / `DELETE /api/v1/studies/{id}/elements/{elementId}` | Criar/excluir elemento; excluir atualiza grafo e revisão, com confirmação da UI. |
| `PUT /api/v1/studies/{id}/precedences` | Substituir conjunto de arestas de modo atômico; rejeitar DAG inválido/ciclo. |
| `POST /api/v1/studies/{id}/stations` / `DELETE /api/v1/studies/{id}/stations/{stationId}` | Criar posto; excluir somente sem elementos, equipamento fixo ou restrição referenciando-o. |
| `GET /api/v1/studies/{id}/revisions` / `GET /api/v1/studies/{id}/revisions/{revision}` | Histórico e snapshot imutável; comparação por campo. |
| `POST /api/v1/studies/{id}/revisions/{revision}/restore` | Criar nova revisão a partir do snapshot histórico; nunca reescrever/apagar revisões existentes. Exige `If-Match`. |
| `POST /api/v1/studies/{id}/approve` | Aprovar versão atual com comentário e checklist; exige Engineer/Admin habilitado por política. |
| `GET /api/v1/optimization-jobs/{jobId}` | Consultar `queued/running/succeeded/failed/cancelled`; mesma organização. |
| `GET /api/v1/health/live`, `GET /api/v1/health/ready` | Liveness e readiness, sem dados ou segredos. |

### 3.6 Sincronização offline e conflitos

**IndexedDB stores:** `studySnapshots`, `outbox`, `syncMetadata`, `legacyMigrationState`. Cada outbox item guarda `clientMutationId`, `studyId`, `baseVersion`, `operations`, `createdAt`, `deviceId` e status. Outbox é ordenada por estudo e instante; operações do mesmo estudo enviam em sequência para evitar reordenação lógica.

**Protocolo de sync:**

1. Ao reconectar, buscar ETag atual e servidor desde `baseVersion`.
2. Se a versão não mudou, enviar operação em lote com `If-Match` e chave idempotente.
3. Se mudou, comparar `JSON Pointer` paths modificados localmente e remotamente desde `baseVersion`.
4. Se não há sobreposição e não há dependência semântica (ex.: estação excluída remotamente usada localmente), reaplicar automaticamente sobre a última versão em uma nova mutação com novo `If-Match`; preservar ID original para auditoria da origem e marcar merge automático.
5. Se existe sobreposição de path ou dependência semântica, manter operação pendente, apresentar conflito e exigir escolha explícita. Nunca usar last-write-wins para tempos, alocações, precedências ou premissas financeiras.
6. Em `200`, substituir cache pelo snapshot canônico, limpar apenas mutation IDs confirmados e armazenar novo ETag. Em `412`, executar comparação; em `401`, renovar sessão e repetir uma vez; em `403`, parar e preservar backup local; em `429/5xx/timeout`, retry exponencial `1,2,4,8,16,30 s` com jitter `±20%`, no máximo 10 tentativas automáticas e opção manual.
7. Mudança de permissão, organização desativada ou estudo arquivado impede sincronização; preservar e permitir exportar dados pendentes antes de limpar sessão.

Retenção local: estudos são isolados por usuário, organização e `studyId`. Logout não apaga automaticamente rascunhos offline; perguntar se deseja manter neste dispositivo ou limpar. Logout em dispositivo compartilhado oferece “limpar dados locais desta conta” destacado.

### 3.7 Segurança, multi-tenancy e privacidade

#### RBAC

| Ação | Viewer | Engineer | Admin |
|---|---:|---:|---:|
| Listar/ler estudo da organização | Sim | Sim | Sim |
| Editar parâmetros, áreas, elementos e precedências | Não | Sim | Sim |
| Otimizar e aplicar proposta | Não | Sim | Sim |
| Aprovar versão | Não | Conforme política da organização; por padrão não aprova a própria revisão | Sim |
| Convidar/desativar usuários e alterar papéis | Não | Não | Sim |
| Consultar auditoria | Leitura restrita ao estudo autorizado | Sim | Sim |
| Alterar exceção ergonômica de zona vermelha | Não | Com motivo e autorização definida | Sim |

- Toda consulta/mutação aplica `organization_id` no servidor e testa membership/role na mesma transação; não aceitar tenant id livre do cliente como autorização.
- JWT curto com audience/issuer verificados; refresh token seguro via cookie `HttpOnly`, `Secure`, `SameSite`; proteção CSRF quando aplicável; revogação em logout/usuário desativado.
- Sanitizar texto por escape contextual ao renderizar. Proibir HTML arbitrário em nomes, descrições e notas; exportação CSV neutraliza células que iniciem com `=`, `+`, `-`, `@`, tab ou CR para mitigar formula injection.
- Proteções: CORS allowlist por ambiente, CSP estrita, HSTS, limites de corpo e taxa, SQL parametrizado/ORM, validação de arquivos por extensão/MIME/assinatura, timeouts e limites solver, secrets em secret manager.
- Auditoria não deve armazenar token, senha, dados de sessão ou cabeçalhos sensíveis. Logs estruturados incluem `requestId`, estudo/org, ator, rota, status e duração com redaction.
- Dados de estudo industriais são privados por padrão; não publicar estudo ou página com dados sem ação explícita e aprovação de política da organização.

### 3.8 Observabilidade e confiabilidade

- Métricas: `api_request_duration_seconds`, `api_requests_total`, `sync_queue_age_seconds`, `sync_conflicts_total`, `solver_duration_seconds`, `solver_status_total`, `calculation_validation_failures_total`, `db_pool_wait_seconds`.
- Tracing distribuído com `requestId` propagado ao worker; logs sem texto sensível de operação salvo quando necessário para auditoria autorizada.
- Alertas iniciais: erro 5xx >2% por 5 min; p95 GET study >1 s por 10 min; p95 cálculo API >250 ms por 10 min; fila do worker mais antiga >2 min; backup diário falho; readiness indisponível >2 min.
- Backup PostgreSQL diário com teste periódico de restauração; retenção e RPO/RTO definidos pelo operador antes da produção. Sem afirmar continuidade industrial/alta disponibilidade até teste documentado de failover e restauração.
- API deve ter `requestId`; mensagens ao usuário mostram código rastreável, sem stacktrace.

---

## 4. ACCEPTANCE CRITERIA & VERIFICATION MATRIX (GHERKIN)

Os cenários abaixo são critérios binários de aceite. Os cálculos devem ser verificados também por testes unitários com decimal e testes de integração no PostgreSQL; valores em UI arredondados não alteram asserts de domínio.

### Cenário 1 — Alteração NVA recalcula gargalo automaticamente

```gherkin
Feature: Cálculo derivado da linha
  Scenario: Alterar NVA atualiza o posto gargalo e os totais derivados
    Given um estudo com 2 postos no cenário atual
      And o posto F1 contém elementos cuja carga total é 80 segundos
      And o posto F2 contém elementos cuja carga total é 100 segundos
      And o elemento E2 do F2 tem NVA atual de 20 segundos
    When a pessoa Engenheira altera o NVA atual de E2 para 35 segundos
    Then T_atual(E2) deve ser VA_atual(E2) + 35 segundos
      And a carga de F2 deve aumentar em 15 segundos
      And o ciclo atual deve ser recalculado como max(C(F1), C(F2))
      And F2 deve continuar sendo gargalo se sua nova carga for maior que F1
      And os totais da Área de E2 devem refletir o novo NVA sem edição direta
      And o cliente deve persistir localmente e enfileirar uma mutação idempotente
```

### Cenário 2 — Estado do Futuro muda conforme Takt

```gherkin
Feature: Comparação com Takt
  Scenario Outline: Classificar cenário futuro com ciclo acima ou dentro do Takt
    Given tempo disponível por turno de 27000 segundos
      And demanda por turno de 180 unidades
      And portanto Takt calculado de 150 segundos
      And o ciclo futuro derivado dos postos é <ciclo> segundos
    When o painel de comparação é atualizado
    Then o estado futuro deve ser <estado>
      And a comparação deve usar ciclo não arredondado para decidir
      And o card deve informar que a capacidade é teórica

    Examples:
      | ciclo | estado |
      | 150   | atende ao Takt (teórico) |
      | 150.001 | acima do Takt |
      | 154   | acima do Takt |
```

### Cenário 3 — Bloquear exclusão de posto alocado

```gherkin
Feature: Integridade de posto
  Scenario: Não excluir posto com elemento vinculado
    Given F3 possui ao menos um elemento alocado no cenário futuro
    When a pessoa solicita excluir F3
    Then a API deve responder 409 com code STATION_NOT_EMPTY
      And a resposta deve listar os IDs e nomes dos elementos vinculados
      And o posto e as alocações devem permanecer inalterados
      And a interface deve oferecer realocar elementos antes de tentar novamente
```

### Cenário 4 — Rebalanceamento respeita DAG de precedência

```gherkin
Feature: Solver de balanceamento
  Scenario: Proposta mantém predecessor no mesmo posto ou em posto anterior
    Given E1 precede E2 e E2 precede E3
      And o grafo não possui ciclos
      And todos os elementos têm tempos e postos compatíveis
    When o solver gera uma proposta futura
    Then station(E1) deve ser menor ou igual a station(E2)
      And station(E2) deve ser menor ou igual a station(E3)
      And todas as cargas devem ser soma dos tempos futuros atribuídos
      And a proposta deve incluir status, objetivo, limites e verificações
      And o estudo só deve mudar após a ação explícita Aplicar proposta
```

### Cenário 5 — Ciclo no grafo bloqueia balanceamento

```gherkin
Feature: Validação de precedências
  Scenario: Rejeitar arestas que formam ciclo
    Given existem precedências E1→E2 e E2→E3
    When alguém tenta adicionar E3→E1
    Then a API deve responder 422 com code PRECEDENCE_CYCLE
      And deve informar pelo menos um ciclo fechado de elementos
      And nenhuma aresta nova deve ser persistida
      And nenhuma revisão deve ser criada
```

### Cenário 6 — Migração legada v1 para modelo v2/corporativo

```gherkin
Feature: Importação de estudo legado
  Scenario: Importar exportação JSON versão 1 sem perder origem
    Given um JSON válido com schemaVersion 1 e 4 operações
      And cada operação contém nome, tempos VA/NVA atual/futuro e custos
    When a pessoa importa o arquivo
    Then a API deve criar 4 áreas e 4 elementos conforme mapeamento legado
      And os custos devem ser associados às respectivas áreas
      And a alocação futura deve usar ordenação decrescente por tempo futuro
      And empates devem usar a ordem original para obter resultado determinístico
      And as precedências devem iniciar vazias
      And a resposta deve apresentar relatório e hash da origem
      And um arquivo acima de 500 elementos deve ser rejeitado sem importação parcial
```

### Cenário 7 — Offline salva e resolve conflito ao reconectar

```gherkin
Feature: Sincronização offline
  Scenario: Alterações locais em campos conflitantes exigem resolução
    Given o dispositivo está offline e o estudo está na versão 7
      And uma alteração local de NVA futuro foi salva na outbox
      And outro usuário alterou o mesmo NVA no servidor, criando versão 8
    When a conexão retorna e o dispositivo sincroniza
    Then o cliente deve detectar conflito de campo e manter a alteração local pendente
      And a interface deve mostrar valor local, valor remoto, autor/data remotos e versão-base
      And nenhuma alteração pode ser descartada ou escolhida silenciosamente
      And após escolha explícita a mutação deve usar novo If-Match e idempotency key
      And o sucesso deve atualizar o snapshot local para o ETag confirmado
```

### Cenário 8 — Alterações sem sobreposição podem ser mescladas

```gherkin
Feature: Sincronização otimista
  Scenario: Reaplicar campos distintos sem conflito semântico
    Given o dispositivo está na versão 12 e altera o NVA de E1
      And outro usuário altera o nome de E2 na versão 13
      And E1 e E2 não compartilham uma restrição removida ou dependência inválida
    When o dispositivo reconecta
    Then o cliente pode reaplicar a mudança de E1 sobre a versão 13
      And a API deve persistir a nova versão sem sobrescrever o nome de E2
      And o log deve identificar merge automático e mutation ID original
```

### Cenário 9 — Custos operacionais não são somados ao CMO

```gherkin
Feature: Métricas financeiras distintas
  Scenario: Exibir mão de obra e custo operacional em parcelas separadas
    Given capacidade atual e futura válidas
      And custos de mão de obra por turno informados
      And custos operacionais por área informados
    When a API calcula os indicadores
    Then CMO atual deve ser custo de mão de obra atual dividido pela capacidade atual
      And CMO futuro deve ser custo de mão de obra futuro dividido pela capacidade futura
      And a economia mensal deve usar somente diferença de CMO vezes volume-base vezes dias
      And custos operacionais devem aparecer em campos separados
      And alterar custo operacional não deve alterar CMO nem economia mensal calculada
```

### Cenário 10 — Segurança multi-tenant e RBAC

```gherkin
Feature: Isolamento entre organizações
  Scenario: Usuário não acessa estudo fora da sua organização
    Given usuário U pertence à organização A como Viewer
      And estudo S pertence à organização B
    When U solicita GET ou PATCH de S
    Then a API deve responder 404 para não revelar existência do estudo
      And nenhum dado de S deve aparecer no body, log de cliente ou busca
      And nenhuma revisão/auditoria de mutação deve ser criada
```

### Cenário 11 — Revisão e aprovação não apagam histórico

```gherkin
Feature: Governança de cenário
  Scenario: Aprovar revisão e preservar baseline aprovada
    Given a versão 20 está aprovada
      And uma nova alteração válida cria a versão 21
    When uma pessoa autorizada aprova a versão 21
    Then a aprovação deve registrar usuário, instante, versão, comentário e checklist
      And a revisão 20 deve permanecer imutável e consultável
      And o painel deve identificar qual revisão está aprovada
      And alteração posterior deve retirar aprovação ativa da nova revisão sem apagar a anterior
```

### Cenário 12 — Arredondamento não muda decisão de Takt

```gherkin
Feature: Precisão de engenharia
  Scenario: Mostrar ciclo arredondado sem falsamente aprovar a linha
    Given o Takt é 150 segundos
      And o ciclo futuro calculado em decimal é 150.001 segundos
      And a UI apresenta uma casa decimal, exibindo 150,0 segundos
    When o sistema classifica o atendimento ao Takt
    Then deve classificar como acima do Takt usando o valor não arredondado
      And deve exibir precisão detalhada suficiente para explicar a diferença
      And não deve mostrar badge de cenário aprovado
```

### Matriz de verificação

| ID | Tipo | Componente | Critério verificável |
|---|---|---|---|
| D-01 | Unitário | `domain/calculations` | Fórmulas de tempo, carga, ciclo, empate de gargalo, Takt, capacidade, CMO e economia com Decimal. |
| D-02 | Unitário | `domain/precedence` | DAG válido, ciclo detectado, mesmo posto com sequência e ordenação topológica determinística. |
| D-03 | Unitário | `domain/optimizer-validation` | Rejeitar proposta violando posto fixo, zona vermelha, posto inexistente, precedência ou versão de entrada. |
| D-04 | Integração | API + PostgreSQL | `If-Match`, atualização em lote atômica, rollback de operação inválida e idempotência de mutação. |
| D-05 | Integração | Multi-tenant | Todas as rotas restringem organização; `404` uniforme para objeto fora do escopo. |
| D-06 | Integração | Importador | Fixtures v1 e v2; limites; path errors; ausência de gravação parcial; hash e relatório. |
| D-07 | Integração | Auditoria | Premissas financeiras, elementos e aprovação geram eventos before/after na mesma transação. |
| D-08 | E2E | Jornada UI | 5 etapas concluídas com teclado, tablet viewport e sem perda de foco em edição inline. |
| D-09 | E2E | Offline | Editar offline, fechar/reabrir PWA, restaurar fila, sincronizar e resolver sobreposição. |
| D-10 | Acessibilidade | UI | WCAG AA automatizado e inspeção manual de teclado, foco, contraste, leitor de tela e gráficos. |
| D-11 | Performance | Front-end | Cálculo p95 <16 ms em 500 elementos/20 postos em hardware de referência publicado. |
| D-12 | Segurança | API/web | CSRF/CORS/CSP, XSS, CSV injection, limites de payload, brute force, JWT e autorização testados. |
| D-13 | Solver | Worker | Fixture determinística reproduz o mesmo resultado; limite de execução e status de timeout corretos. |
| D-14 | Recuperação | Operação | Backup restaurado em ambiente isolado com resultado e duração registrados. |

### Definição de pronto

Uma release só pode ser declarada pronta quando: os 12 cenários Gherkin passarem; todos os itens D-01 a D-14 tiverem evidência; cálculo de domínio for reproduzível entre cliente e servidor; importador mantiver compatibilidade; migrações tiverem teste de upgrade/rollback; não houver vulnerabilidade crítica/alta aberta; acessibilidade WCAG AA for verificada; e o procedimento de backup/restauração tiver sido executado. A indicação “pronto para uso industrial” fica condicionada a homologação em processo representativo, aprovação das premissas e política operacional da organização.

---

## Apêndice A — Critérios de fidelidade da identidade

1. Paleta de marca azul-marinho `#103653` + dourado `#F4BA25` permanece identificável em qualquer tema.
2. Ícone comunica cronômetro + barras de carga + conexão; preservar contorno e contraste em tamanho pequeno e grande.
3. A tela comparativa deve preservar a leitura de estado atual, gargalo, futuro, linha de Takt, composição do trabalho, indicadores e resultado financeiro.
4. Não copiar números do mockup pós-SDD como cálculo de produção: os valores em tela são sempre derivados do estudo carregado.
5. Nunca usar a expressão “sem gargalo” se `TC` ainda excede Takt; uma linha pode não ter gargalo crítico isolado e ainda não atender ao ritmo requerido.

## Apêndice B — Ordem recomendada de entrega técnica

1. Congelar o contrato de domínio e criar testes de cálculo decimal com fixtures do MVP 0.2.
2. Implementar schema PostgreSQL, tenant isolation, versionamento e audit log.
3. Implementar API de estudo/importação e verificação idempotente; preservar um exportador de backup legível.
4. Implementar cliente React/TypeScript e design tokens; migrar primeiro a visualização e os formulários sem alterar cálculo.
5. Implementar IndexedDB/outbox, protocolo ETag e tela de conflitos.
6. Implementar grafo DAG, restrições ergonômicas/equipamento e solver; liberar primeiro como proposta revisável.
7. Implementar histórico/aprovação, relatórios CSV/XLSX, observabilidade e teste de restauração.
8. Fazer piloto controlado com dados anonimizados e tempos validados; somente então declarar aptidão para produção corporativa.
