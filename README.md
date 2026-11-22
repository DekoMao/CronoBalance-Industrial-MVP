# CronoBalance Industrial

MVP PWA para cronoanálise, comparação entre estado atual e futuro e leitura de capacidade e custos. A interface segue a composição da referência: cabeçalho industrial azul, gráfico atual em vermelho, cenário futuro em verde, tabela de operações, indicadores e faixa de resultados.

## Acesso web

O GitHub Actions publica a PWA em GitHub Pages quando há atualização na branch `main`:

**https://dekomao.github.io/CronoBalance-Industrial-MVP/**

Na primeira publicação, confirme em **Settings → Pages** que a origem está definida como **GitHub Actions**. Consulte a aba **Actions** para acompanhar a conclusão do deploy. O repositório é público e o site também; não informe dados confidenciais. Os estudos ficam no armazenamento local do navegador e não são enviados ao GitHub.

## O que está funcionando

- Cadastro de elementos de trabalho, tempos VA/NVA e alocação atual/futura por posto.
- Gráficos, ciclos, totais VA/NVA e atendimento ao takt calculados a partir da mesma lista de elementos; não há edição isolada dos tempos dos gráficos.
- Edição dos custos operacionais atribuídos às áreas, separados do cálculo de mão de obra por peça.
- Cálculo de takt, ciclo da linha, capacidade por turno, custo estimado por peça e economia mensal estimada.
- Sugestão de balanceamento futuro por distribuição heurística das tarefas pelo posto com menor carga.
- Adição/remoção de áreas, elementos e postos.
- Salvamento automático no navegador e backup/restauração por arquivo JSON.
- PWA instalável e shell offline depois da primeira abertura em endereço `localhost` ou HTTPS.
- Layout responsivo para desktop, tablet e celular.

## Executar localmente

Requer Python 3.10 ou superior. Abra um terminal dentro da pasta e execute:

```bash
python3 -m http.server 4173
```

No Windows, também é possível abrir `start-local.bat`. Acesse `http://localhost:4173`.

## Executar com Docker

Requer Docker Desktop e o plugin Docker Compose:

```bash
docker compose up --build -d
```

Abra `http://localhost:8080`. Para trocar a porta, execute `PORT=8090 docker compose up --build -d` (PowerShell: `$env:PORT=8090; docker compose up --build -d`). Para parar: `docker compose down`.

O container serve os arquivos estáticos. Para disponibilizar a aplicação em uma rede industrial ou na internet, publique a imagem em uma infraestrutura aprovada, configure DNS/HTTPS no proxy ou gateway corporativo e libere apenas os segmentos de rede necessários. O navegador dos usuários deve acessar o endereço HTTPS para instalar a PWA fora do modo localhost.

## Deploy pelo GitHub Actions

O workflow `.github/workflows/deploy-pages.yml` copia somente os arquivos da aplicação para `_site`, envia esse diretório como artefato e publica no GitHub Pages. O README, arquivos de desenvolvimento e configuração Docker ficam fora do artefato do site. Os caminhos relativos permitem que a mesma aplicação funcione no Pages e no servidor local.

## Como os números são calculados

- **Takt:** tempo disponível no turno ÷ demanda informada por turno.
- **Ciclo da linha:** maior tempo entre os postos do cenário.
- **Capacidade teórica por turno:** tempo disponível no turno ÷ ciclo da linha.
- **Mão de obra teórica por peça:** custo de mão de obra informado para o turno ÷ capacidade teórica do mesmo cenário. O custo operacional por área é uma parcela diferente e não é somado a este indicador.
- **Economia mensal estimada:** diferença de custo teórico por peça × produção base por dia × dias produtivos.
- **Ciclo por posto:** soma VA + NVA dos elementos alocados naquele posto; o ciclo da linha é a maior dessas somas.
- **Rebalancear:** ordena os elementos pelo tempo futuro, do maior para o menor, e aloca cada elemento ao posto com menor carga acumulada. É uma heurística, não um otimizador de precedências. Decomponha tarefas grandes e verifique precedências, ergonomia, qualidade, abastecimento e viabilidade física antes de aplicar.

Os valores de abertura são um exemplo didático coerente: os tempos atuais e futuros por posto são somas dos elementos associados. O cenário futuro pressupõe redução de atividades NVA; trate essa redução como hipótese a validar, não como ganho já realizado. Atualize as premissas com dados cronometrados e custos validados. Os cálculos de capacidade são teóricos e não substituem OEE, perdas, refugo, microparadas, variação de operador, estudo de tolerância ou validação de Engenharia/Qualidade.

## Armazenamento e limites desta versão

Cada navegador guarda seu próprio projeto no armazenamento local do dispositivo. Exportar/importar JSON permite transportar um estudo entre dispositivos. A versão 0.2 migra estudos locais 0.1 e aceita arquivos JSON 0.1, recalculando ciclos a partir das operações e redistribuindo elementos futuros; confira a conversão após importar. **Ainda não há contas, acesso simultâneo, sincronização central, banco de dados de fábrica nem trilha de auditoria**; por isso, esta versão é adequada para avaliação de fluxo e piloto controlado, mas não deve ser tratada como sistema corporativo de registro oficial.

## Próxima etapa para implantação multiusuário

Manter esta interface como PWA e conectar a uma API central com autenticação corporativa e banco PostgreSQL. O modelo mínimo deve versionar organização, planta, linha, família de produto, estudos, operações, postos e medições; cada revisão precisa registrar autor, data, valores anteriores, aprovação e evidências. Adicionar perfis de acesso, auditoria imutável, backup/restore testado, segregação por planta, observabilidade, gestão de segredos e implantação redundante antes de escalar para uso operacional. O MVP não cria esses serviços nem inventa controles de segurança que ainda não existem.

## Estrutura

```text
index.html            tela e componentes acessíveis
styles.css            tema claro, gráficos e layout responsivo
app.js                elementos, alocações, cálculos, edição e importação/exportação
service-worker.js     cache da aplicação para uso offline
manifest.webmanifest  instalação como PWA
Dockerfile            imagem estática de produção
compose.yaml          execução local/container
nginx.conf            servidor e cabeçalhos básicos
.github/workflows/    publicação automática pelo GitHub Pages
```
