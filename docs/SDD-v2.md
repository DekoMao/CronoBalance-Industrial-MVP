# MASTER PROMPT — SPEC-DRIVEN DEVELOPMENT (SDD)
## Projeto: CronoBalance Industrial (Enterprise Edition v2.0 AI-Powered)

---

## 1. ROLE, CONTEXT & ARCHITECTURAL MISSION

Atue como um **Arquiteto de Software Principal**, **Engenheiro Sênior de Manufatura (Lean / Cronoanálise)** e **Lead Product Designer**. Sua missão é especificar e/ou implementar integralmente a plataforma **CronoBalance Industrial (v2.0 AI-Powered)** — um sistema corporativo híbrido (**Offline-First PWA + Cloud-Ready SaaS**) para cronoanálise, balanceamento de linhas de produção, simulação estocástica e análise de viabilidade financeira (CAPEX / Payback / ROI).

### Princípios Arquiteturais Inegociáveis
1. **Operação Híbrida (Chão de Fábrica + Web):** A aplicação deve funcionar de forma 100% autônoma no navegador (`localStorage` / `IndexedDB` + exportação de pacote `.html` autônomo e snapshots via URL `#study=...`) sem depender de conexão com a internet, sincronizando com API REST em nuvem quando conectada.
2. **Fonte Única da Verdade (*Single Source of Truth*):** Os tempos exibidos nos gráficos por posto ($F_1 \dots F_n$) e os totais agregados das Áreas/Operações **nunca** são editados diretamente. Todos os indicadores são derivados reativamente da soma dos **Elementos de Trabalho (`WorkElements`)** alocados em cada posto.
3. **Human-in-the-Loop & Governança:** Toda ação automatizada (rebalanceamento RPW, otimização por Simulated Annealing, planos Kaizen da I.A. ou edições manuais) deve registrar um snapshot na pilha de desfazer (`undoStack`, até 25 níveis) e gravar um evento rastreável na **Trilha de Auditoria (`auditLog`)**.
4. **Idioma e Localização:** Interface, relatórios executivos, alertas e formatos numéricos estritamente em **Português do Brasil (`pt-BR`)**, utilizando separador decimal por vírgula e moeda em Real (`R$`).

---

## 2. DOMAIN LOGIC & ENGINEERING EQUATIONS (MATHEMATICAL INVARIANTS)

Todo o motor de cálculo (`computeMetrics`) deve implementar exatamente as definições e fórmulas abaixo:

### 2.1 Hierarquia de Entidades
* **Portfólio (`AppState`):** Contém `activeStudyId` e uma lista `1:N` de **Estudos (`Study`)**.
* **Estudo (`Study`):** Contém parâmetros globais do turno, premissas de OEE/CAPEX, metadados de governança (`author`, `revision`, `auditLog`), contagem de postos (`stations.current`, `stations.future`), lista `1:N` de **Áreas/Operações (`areas`)**, lista `1:N` de **Elementos de Trabalho (`elements`)** e grafo direcionado de **Precedências (`precedences`)**.

### 2.2 Equações Fundamentais de Engenharia de Manufatura
Seja $E$ o conjunto de elementos de trabalho do estudo, $F_{\text{atual}} = \{1, \dots, n_{\text{atual}}\}$ os postos do cenário atual e $F_{\text{futuro}} = \{1, \dots, n_{\text{futuro}}\}$ os postos do cenário futuro:

1. **Tempo do Elemento $e \in E$:**
   $$T_{\text{atual}}(e) = VA_{\text{atual}}(e) + NVA_{\text{atual}}(e)$$
   $$T_{\text{futuro}}(e) = VA_{\text{futuro}}(e) + NVA_{\text{futuro}}(e)$$

2. **Carga Total do Posto $F_i$ ($s$):**
   $$C_{\text{atual}}(F_i) = \sum_{e \in F_i^{\text{atual}}} T_{\text{atual}}(e), \qquad C_{\text{futuro}}(F_i) = \sum_{e \in F_i^{\text{futuro}}} T_{\text{futuro}}(e)$$

3. **Tempo de Ciclo da Linha ($TC$, em segundos) e Gargalo Crítico:**
   $$TC_{\text{atual}} = \max_{1 \le i \le n_{\text{atual}}} C_{\text{atual}}(F_i), \qquad TC_{\text{futuro}} = \max_{1 \le i \le n_{\text{futuro}}} C_{\text{futuro}}(F_i)$$
   $$\text{Gargalo} = \arg\max_{F_i} C(F_i)$$

4. **Takt Time Efetivo ($\text{Takt}$, em segundos):**
   Considerando o fator de eficiência planejada ($\text{OEE} \in [0{,}10; 1{,}00]$) e o multiplicador de sazonalidade ($S_{\%} \in [-30\%; +50\%]$):
   $$T_{\text{disp, efetivo}} = T_{\text{turno}} \times \left(\frac{\text{OEE}}{100}\right), \qquad D_{\text{efetiva}} = D_{\text{turno}} \times \left(1 + \frac{S_{\%}}{100}\right)$$
   $$\text{Takt} = \frac{T_{\text{disp, efetivo}}}{D_{\text{efetiva}}}$$

5. **Eficiência de Balanceamento ($\eta_{\text{bal}}$), Balance Delay e Postos Mínimos Teóricos ($N_{\min}$):**
   $$\eta_{\text{bal}} = \frac{\sum_{e \in E} T(e)}{n \times TC} \times 100\%, \qquad \text{Balance Delay} = 100\% - \eta_{\text{bal}}$$
   $$N_{\min} = \max\left(1, \left\lceil \frac{\sum_{e \in E} T_{\text{futuro}}(e)}{\text{Takt}} \right\rceil\right)$$

6. **Índice de Suavidade (*Smoothness Index* — $SI$, em segundos):**
   $$SI = \sqrt{\sum_{i=1}^{n_{\text{futuro}}} \left(TC_{\text{futuro}} - C_{\text{futuro}}(F_i)\right)^2}$$

7. **Capacidade Teórica ($\text{Cap}$, em unidades/turno):**
   $$\text{Cap}_{\text{atual}} = \frac{T_{\text{disp, efetivo}}}{TC_{\text{atual}}}, \qquad \text{Cap}_{\text{futuro}} = \frac{T_{\text{disp, efetivo}}}{TC_{\text{futuro}}}$$

8. **Separação Contábil Explícita (Mão de Obra Direta vs. Custo Operacional Alocado):**
   * **Custo de Mão de Obra por Peça ($CMO$, em $\text{R\$}$):**
     $$CMO_{\text{atual}} = \frac{\text{Custo Equipe}_{\text{atual}}}{\text{Cap}_{\text{atual}}}, \qquad CMO_{\text{futuro}} = \frac{\text{Custo Equipe}_{\text{futuro}}}{\text{Cap}_{\text{futuro}}}$$
   * **Custo Operacional Alocado por Peça ($COP$, em $\text{R\$}$):** Soma direta dos custos atribuídos por área ($\sum_{a \in \text{Areas}} \text{cost}_a$), mantida como parcela distinta e exibida no gráfico Donut de composição unitária sem dupla contagem.

9. **Economia Mensal Estimada ($\Delta_{\text{mês}}$), Payback e ROI Anual:**
   $$V_{\text{dia, efetivo}} = V_{\text{dia}} \times \left(1 + \frac{S_{\%}}{100}\right)$$
   $$\Delta_{\text{mês}} = \left(CMO_{\text{atual}} - CMO_{\text{futuro}}\right) \times V_{\text{dia, efetivo}} \times \text{Dias Produtivos/Mês}$$
   $$\text{Payback (meses)} = \frac{\text{CAPEX}}{\Delta_{\text{mês}}} \quad (\text{para } \Delta_{\text{mês}} > 0), \qquad \text{ROI}_{\text{anual}} = \frac{(\Delta_{\text{mês}} \times 12) - \text{CAPEX}}{\text{CAPEX}} \times 100\%$$

---

## 3. UX DESIGN & COGNITIVE ERGONOMICS SPECIFICATION

### 3.1 Arquitetura Espacial (Sidebar Retrátil + Workspace Contextual)
Para evitar poluição visual no cabeçalho e agrupar ferramentas por domínio operacional, a interface deve adotar uma **Barra Lateral Retrátil (`#app-sidebar`)** combinada com um **Cabeçalho Superior Contextual**:

* **Barra Lateral Retrátil (`256px` expandida / `68px` recolhida via botão `«` / drawer deslizante em mobile `< 1024px`):**
  1. *Portfólio de Estudos:* `Novo Estudo`, `Duplicar Cenário`, `Renomear Estudo` (edição inline no topo), `Comparar Cenários` (`Estudo A × Estudo B`) e `Excluir Estudo`.
  2. *Engenharia & Fábrica:* `Copiloto I.A. (Kaizen)`, `Cronometrar Tempos`, `Premissas, OEE & CAPEX` e `Guia Metodológico` (*O que é?* e *Como aplicar em 5 etapas*).
  3. *Governança & Nuvem:* `Trilha de Auditoria` e `Compartilhar / PWA`.
  4. *Dados & Exportação:* `Baixar Projeto (.html)`, `Importar JSON`, `Exportar JSON`, `Exportar CSV / Excel` (`;` com BOM UTF-8) e `Imprimir / PDF` (`@media print`).
* **Cabeçalho Superior Contextual:** Contém apenas o título do sistema com badge `SDD v2.0 AI`, o **Seletor Customizado do Estudo Ativo** (menu dropdown em tema escuro Obsidian com subtítulo de produto, elementos e postos), atalhos rápidos para `✨ Copiloto I.A.` e `Cronometrar`, e a pílula interativa de status (`Sincronizado na Nuvem` $\leftrightarrow$ `Offline-First (Local)`).

### 3.2 Fluxos Críticos & Prevenção de Erros
1. **Exclusão Segura de Estudos (`openDeleteStudyModal`):** Ao acionar `Excluir Estudo`, exibir modal dedicado com:
   * Cartão de destaque evidenciando nominalmente qual estudo será removido;
   * Lista com **caixas de seleção (`checkboxes`)** permitindo marcar um ou múltiplos estudos do portfólio (bloqueando a seleção caso reste apenas 1 estudo);
   * **Checkbox obrigatório de confirmação definitiva** antes de habilitar o botão `🗑 Excluir Definitivamente`.
2. **Controle Numérico Customizado (`.num-stepper`):** Substituir todos os *spinbuttons* brancos nativos do navegador por componentes integrados em tema escuro com botões táteis `▲` / `▼` e `color-scheme: dark` em todos os `<select>`.
3. **Matriz Mestre-Detalhe Expansível:** Na tabela *Work Composition & Financials*, cada linha de Área possui o botão explícito **`+ mostrar detalhes`** (que alterna para **`− ocultar detalhes`** quando aberta), filtro instantâneo por área/elemento/posto (`F1..Fn`) e ordenação interativa por coluna (`⇅` / `↑` / `↓`).

---

## 4. UI DESIGN SYSTEM & VISUAL TOKENS

### 4.1 Paleta de Cores (Matte Obsidian & Industrial Navy)
| Token Semântico | Hexadecimal | Aplicação na Interface |
| :--- | :--- | :--- |
| `--bg-canvas` | `#091019` | Fundo principal da aplicação com gradiente radial sutil |
| `--bg-card` | `#131E2D` | Superfície elevada de cartões e painéis (`panel-surface`) |
| `--bg-slot` | `#0F1824` | Campos de entrada, slots de postos e fundo de gráficos |
| `--border-subtle` | `#243449` | Bordas estruturais e divisores de tabela |
| `--navy-header` | `#103653` | Cabeçalho institucional superior e topo da barra lateral |
| `--accent-gold` | `#F4BA25` | Bordas de parâmetros-chave, linha de Takt Time, destaques ativos |
| `--data-cyan` | `#38BDF8` / `#1E90B8` | Barras normais dos gráficos de ciclo e tempo VA |
| `--semantic-gain` | `#10B981` | Redução de ciclo, aumento de capacidade, economia mensal, linha balanceada |
| `--semantic-alert` | `#F43F5E` | Posto gargalo (`Gargalo +Xs`), violações de precedência, ações destrutivas |
| `--ai-violet` | `#8B5CF6` | Ações de Inteligência Artificial (`✨ Otimizar (I.A.)`, `✨ Copiloto I.A.`, PLN) |

### 4.2 Tipografia & Hierarquia Numérica
* **Família Tipográfica:** `Inter`, sans-serif.
* **Alinhamento Numérico:** Uso obrigatório de `font-variant-numeric: tabular-nums` em todos os KPIs, células de tempo, inputs numéricos, eixos de canvas e cronômetro para eliminar trepidação visual durante recálculos em tempo real.

### 4.3 Componentes Visuais Principais
1. **Faixa Superior de 4 Cards Dourados (`.gold-card`):** `Produto / família`, `Demanda / turno (un)` (com badge dinâmico de Takt), `Produção base / dia` e `Equipe Atual ➜ Futura (R$/turno)`.
2. **Barra de Simulação "What-If" & Retorno:** Slider de sazonalidade (`-30%` a `+50%`), leitura de demanda/Takt simulados e badges contínuos de `CAPEX`, `Payback` e `ROI Anual`.
3. **Workspace Intermediário de 3 Colunas:**
   * **Coluna 1 — Precedência & Balanceamento:** Grafo DAG interativo em SVG com setas direcionadas, tooltip por posto, contador de regras/fixos, alerta automático de violação técnica com botão `Corrigir` e modal `⇄ Regras`.
   * **Coluna 2 — Station Drag-and-Drop:** Postos `F1..Fn` com suporte a HTML5 Drag-and-Drop, botão de trava de monumento (`📌` / `○`) por elemento, barra de telemetria (`Eficiência %`, `Smoothness Index SI`, badge `Risco Takt %` de Monte Carlo e botão `N mín`) e controles `↶`, `− Posto`, `+ Posto`, `Rebalancear ↻` e `✨ Otimizar (I.A.)`.
   * **Coluna 3 — Gráfico Analítico Interativo (`<canvas>`):** Seletor de 4 modos de visualização:
     * `Futuro`: Barras verticais de carga por posto vs. linha tracejada dourada de `Takt Time`.
     * `Yamazumi`: Barras empilhadas mostrando **VA** (azul), **NVA** (âmbar) e **Ociosidade** (área tracejada até o Takt).
     * `Atual`: Diagnóstico inicial destacando o posto gargalo em vermelho.
     * `Atual × Futuro`: Barras pareadas lado a lado por posto com tooltip detalhado ao passar o mouse.
4. **Painel Executivo Inferior:**
   * Grid `4×2` de cartões KPI (4 cartões Hero superiores + 4 cartões de telemetria `Atual ➜ Futuro` inferiores);
   * **Gráfico Donut SVG** de Composição Unitária (`Mão de obra` vs. `Custos operacionais` com percentuais e comparação com custo total anterior);
   * **Barras Horizontais Duplas** de Redução de Custos (`Atual 100%` vs. `Futuro proporcional`);
   * **Banner Dinâmico de Conclusão** que adapta o diagnóstico conforme `Ciclo Futuro <= Takt` ou `Ciclo Futuro > Takt`.

---

## 5. ARTIFICIAL INTELLIGENCE ENGINE SPECIFICATION (THE 4 PILLARS)

### Pilar 1: Edge AI Offline (Otimizador Meta-Heurístico & Simulação de Monte Carlo)
1. **Balanceamento Topológico RPW (`rebalanceRPW`):** Calcula o *Ranked Positional Weight* de cada elemento no grafo DAG, fixa primeiramente os monumentos (`fixedStation != null`) e aloca os demais elementos respeitando precedências técnicas.
2. **Otimizador Multi-Objetivo Simulated Annealing (`optimizeSimulatedAnnealingAI`):** Executa $900$ iterações estocásticas com resfriamento exponencial ($T_0 = 45{,}0$, $\alpha = 0{,}994$), avaliando apenas movimentações topologicamente válidas que preservam monumentos fixos, minimizando a função objetivo combinada:
   $$J = 12 \cdot TC_{\text{futuro}} + SI$$
3. **Simulação Estocástica de Monte Carlo (`runMonteCarloSimulation`):** Executa $600\text{--}800$ turnos virtuais aplicando ruído gaussiano (Box-Muller) calibrado pelo coeficiente de variação empírico do cronômetro (ou CV padrão Lean: $0{,}65 \cdot CV$ para VA e $1{,}35 \cdot CV$ para NVA), retornando a **probabilidade percentual de estouro do Takt Time** e o **ciclo P95**.

### Pilar 2: Copiloto Kaizen & Parecer Executivo (`openAiCopilotModal`)
1. **Diagnóstico Prescritivo de Perdas NVA (`buildKaizenDiagnostic`):** Analisa semanticamente os elementos com maior tempo NVA, classifica a oportunidade (*Poka-Yoke Integrado*, *Kitting Point-of-Use*, *Gabarito Zero-Ajuste*, *SMED*), estima a economia em segundos e permite aplicar todas as contramedidas com **1 clique** (`applyAiKaizenPlan`).
2. **Gerador de Parecer Técnico para CAPEX:** Redige automaticamente um relatório executivo estruturado em 3 seções (*Diagnóstico*, *Proposta Balanceada SDD v2.0 AI*, *Viabilidade Financeira & ROI*) com cópia em 1 clique.
3. **Gateway LLM Opcional:** Suporte a configuração local de endpoint e API Key (BYOK) armazenados exclusivamente no dispositivo.

### Pilar 3: Engenharia Assistida por PLN (Processamento de Linguagem Natural)
1. **Inferência Automática de Precedências (`inferPrecedencesNLP`):** Classifica verbos e substantivos técnicos em português em 5 estágios operacionais (*1. Recebimento/Kitting $\rightarrow$ 2. Preparação $\rightarrow$ 3. Montagem/Fixação $\rightarrow$ 4. Teste/Inspeção $\rightarrow$ 5. Acabamento/Embalagem*) para gerar automaticamente as arestas do grafo DAG.
2. **Classificação Automática VA × NVA (`classifyOperationNLP`):** Ao cadastrar uma nova Área/Operação, identifica em tempo real se a atividade é de transformação direta (predomínio VA) ou suporte/verificação (predomínio NVA) e preenche os tempos sugeridos.

### Pilar 4: Cronoanálise por Visão Computacional & Estatística (`openStopwatchModal`)
1. **Cronômetro Digital Estatístico:** Registra múltiplas tomadas (*Laps*), aplica **Ritmo do Operador (%)** e **Fator de Tolerância / Fadiga (%)**, calcula o **Tempo Padrão ($TP$)** e determina o tamanho mínimo da amostra ($N_{\text{req}}$) para $95\%$ de confiança e $\pm 5\%$ de erro relativo:
   $$N_{\text{req}} = \max\left(2, \left\lceil \left(\frac{1{,}96 \cdot s}{0{,}05 \cdot \bar{x}}\right)^2 \right\rceil\right)$$
2. **Visão Computacional Óptica (`setStopwatchMode('vision')`):** Monitora via câmera WebRTC (ou pelo **Simulador de Bancada Óptica** integrado) a movimentação nas 3 zonas da bancada (**Z1: Pick**, **Z2: Montagem**, **Z3: Liberação**), disparando automaticamente o registro de ciclo (`recordStopwatchLap`) ao detectar a conclusão da sequência operacional.

---

## 6. DATA SCHEMA & PERSISTENCE CONTRACT (JSON / REST API)

### 6.1 Contrato JSON de Persistência e Intercâmbio (`v2.0`)
```json
{
  "activeStudyId": "study-condensadora-x9",
  "studies": [
    {
      "id": "study-condensadora-x9",
      "name": "Linha Final - Condensadora Split Inverter X9",
      "product": "Condensadora Inverter 18k BTU",
      "shiftSeconds": 28800,
      "days": 22,
      "demand": 220,
      "dailyVolume": 44.0,
      "laborCurrent": 2160,
      "laborFuture": 1440,
      "oee": 92,
      "capex": 38000,
      "seasonalityPct": 0,
      "author": "Eng. Carlos Mendes",
      "revision": "Rev. 2.0-AI",
      "stations": { "current": 6, "future": 4 },
      "areas": [
        { "name": "Preparação & Kitting Base", "costCurrent": 1.15, "costFuture": 0.78 }
      ],
      "elements": [
        {
          "id": "c01",
          "area": "Preparação & Kitting Base",
          "name": "Separar chassi e coxins antivibração",
          "currentStation": 1,
          "vaCurrent": 22.0,
          "nvaCurrent": 16.5,
          "futureStation": 1,
          "vaFuture": 22.0,
          "nvaFuture": 5.0,
          "fixedStation": null
        }
      ],
      "precedences": [["c01", "c02"]],
      "auditLog": [
        {
          "ts": "22/11/2026 01:45",
          "actor": "Eng. Carlos Mendes",
          "action": "Baseline",
          "detail": "Estudo inicializado"
        }
      ]
    }
  ]
}
```

### 6.2 Contratos de API Back-End (Evolução Cloud Sync)
* `GET /api/v1/studies` — Lista o portfólio de estudos da organização.
* `POST /api/v1/studies` — Cria ou importa um estudo validando limites de segurança ($\le 500$ elementos, $\le 100$ áreas, $\le 12$ postos futuros).
* `PUT /api/v1/studies/:id` — Sincroniza o estado completo com controle de concorrência otimista (`revision` / `ETag`).
* `POST /api/v1/studies/:id/optimize` — Executa o solver multi-objetivo no servidor para linhas de grande porte.

---

## 7. ACCEPTANCE CRITERIA & VERIFICATION MATRIX (GHERKIN)

```gherkin
Feature: CronoBalance Industrial v2.0 AI-Powered

  Scenario: Fonte Única da Verdade e Recálculo Reativo de Gargalo
    Given um estudo ativo com elementos alocados nos postos F1 a F5
    When o engenheiro altera o tempo NVA Futuro de um elemento no posto F3
    Then a carga total do posto F3, o Ciclo da Linha, a Eficiência de Balanceamento, o gráfico e todos os KPIs financeiros devem ser recalculados instantaneamente sem recarregar a página.

  Scenario: Otimização Multi-Objetivo por I.A. respeitando Monumentos e Precedências
    Given um estudo com regras de precedência DAG e um elemento fixado com monumento (📌) no posto F3
    When o usuário aciona "✨ Otimizar (I.A.)"
    Then o algoritmo Simulated Annealing deve manter o monumento fixado no posto F3, não gerar nenhuma violação de precedência e minimizar o Ciclo da Linha e o Smoothness Index (SI).

  Scenario: Visualização Empilhada Yamazumi
    Given o painel de gráficos no estado futuro
    When o usuário seleciona a aba "Yamazumi"
    Then cada barra de posto F1..Fn deve exibir empilhados o tempo VA (azul), o tempo NVA (âmbar) e a ociosidade tracejada até a linha do Takt Time.

  Scenario: Exclusão Segura de Estudo com Caixas de Seleção
    Given um portfólio contendo 2 ou mais estudos
    When o usuário clica em "Excluir Estudo" na barra lateral
    Then um modal deve destacar nominalmente o estudo selecionado, exibir checkboxes para escolha dos estudos a remover e manter o botão de exclusão desabilitado até que a caixa de confirmação definitiva seja marcada.

  Scenario: Cronoanálise Estatística e Visão Computacional
    Given o modal "Cronometrar" na aba "📷 Visão Computacional (Câmera)"
    When o modo de bancada óptica registra ciclos completos (Z1 -> Z2 -> Z3)
    Then o sistema deve calcular a média, o desvio padrão, o tamanho amostral N necessário para 95% de confiança e permitir aplicar o Tempo Padrão calculado diretamente em qualquer elemento do estudo.

  Scenario: Portabilidade Offline-First e Exportação
    Given o usuário operando sem conexão com a internet
    When ele edita parâmetros, executa o plano Kaizen da I.A. e clica em "Baixar Projeto (.html)" ou "Exportar JSON"
    Then todas as alterações devem persistir localmente e gerar arquivos válidos prontos para reabertura em qualquer dispositivo.
```