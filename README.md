# CronoBalance Industrial

Aplicação de cronoanálise e balanceamento para engenharia de processos. O engenheiro mede e edita elementos de trabalho, testa a redistribuição entre postos e compara capacidade, mão de obra e custo operacional. O gestor pode consultar revisões e aprovar cenários na instalação corporativa.

**[Abrir o painel no GitHub Pages](https://dekomao.github.io/CronoBalance-Industrial-MVP/)** · [Especificação corporativa](docs/SDD-corporativo.md) · [Especificação da interface e das simulações](docs/SDD-v2.md) · [Execuções dos testes e publicação](../../actions/workflows/deploy-pages.yml)

## Onde os dados ficam

| Instalação | Persistência | Acesso |
| --- | --- | --- |
| GitHub Pages e PWA | IndexedDB no navegador. A PWA armazena a interface para reabertura offline depois do primeiro carregamento completo. | Abra a URL acima. O botão de estado informa **Salvo localmente**. |
| Arquivo HTML portátil | Uma cópia do portfólio fica incorporada ao arquivo no momento da exportação. Edições posteriores ficam no navegador. | No menu lateral, escolha **Baixar Projeto (.html)**. Abra o arquivo em Chrome ou Edge. Exporte novamente para transportar alterações. |
| Instalação local com Docker | API FastAPI, PostgreSQL em volume persistente e cache IndexedDB no cliente. | Front-end em `http://localhost:4173`. Documentação interativa da API em `http://localhost:8000/docs`. |
| Instalação corporativa | Uma API HTTPS compartilhada, PostgreSQL e login OIDC. A API aplica os perfis e o isolamento por organização. | Configure a implantação abaixo. A indicação **Sincronizado na nuvem** depende da sessão autenticada e da fila confirmada pelo servidor. |

## Verificar a linha de montagem

Abra **Linha de Montagem - Produto A**. O estudo de demonstração tem 6 operações, 15 elementos e 10 relações de precedência. Use **+ mostrar detalhes** em Recebimento para editar um elemento.

| Indicador derivado | Atual | Futuro |
| --- | ---: | ---: |
| Ciclo da linha | 256,3 s · F3 | 96,0 s · F1 a F5 empatados |
| Capacidade teórica | 105,35 un/turno | 281,25 un/turno |
| Custo da equipe | R$ 1.710,00/turno | R$ 1.425,00/turno |
| Mão de obra direta | R$ 16,23/peça | R$ 5,07/peça |
| Operacional alocado | R$ 8,04/peça | R$ 5,63/peça |

Com 27.000 s/turno, demanda de 180 unidades, OEE planejado de 100% e sazonalidade de 0%, o Takt é 150 s. A economia projetada de mão de obra é **R$ 8.646,69 por mês** com 35,2 unidades/dia e 22 dias. O painel executivo arredonda a apresentação para R$ 8.647. A base de cálculo mantém a precisão antes do arredondamento. O CAPEX demonstrativo de R$ 15.000 resulta em payback de 1,73 mês e ROI anual de +591,7%. São hipóteses até o registro da evidência de medição.

- Altere o NVA futuro de **Separar e identificar material** de 4 para 58 s. F1 chega ao Takt. Com 59 s, F1 chega a 151 s e o painel indica excesso de 1 s. Use **Desfazer** para recuperar a edição.
- Alterne **Futuro**, **Yamazumi**, **Atual** e **Atual × Futuro**. O gráfico usa os mesmos elementos da matriz e das cargas dos postos.
- Use **Regras** para examinar o DAG e **Restrições e evidências** para associar equipamentos, zonas ergonômicas e referências de validação. Arraste uma tarefa ou altere seu seletor de posto na matriz. Um posto ocupado bloqueia a exclusão.
- **Rebalancear** propõe alocações por peso posicional (RPW). **Otimizar** avalia ciclo e índice de suavidade por recozimento simulado. A proposta apresenta os postos de origem e destino antes de aplicar. O solver CP-SAT está no painel de sincronização das instalações com API.
- O cronômetro registra voltas, média, desvio padrão e amostragem. O modo de câmera requer permissão do navegador e conta a sequência das três zonas. A bancada simulada funciona sem câmera.
- O copiloto local identifica oportunidades de redução de NVA e emite um parecer. O envio opcional de indicadores a um gateway generativo exige a ação explícita do operador. A chave do gateway fica em memória durante a sessão.
- Para intercâmbio, use JSON do portfólio, CSV com BOM e separador ponto e vírgula, Excel XLSX, impressão/PDF ou HTML autônomo. O snapshot no fragmento do link inclui dados do estudo e pode ser lido por quem receber o link.

## Executar em Windows, Linux ou macOS

Com Git e Docker Compose v2 instalados, execute na pasta do repositório:

```sh
git clone https://github.com/DekoMao/CronoBalance-Industrial-MVP.git
cd CronoBalance-Industrial-MVP
docker compose up --build
```

No Windows, `start-local.bat` inicia a mesma instalação. No Linux ou WSL, use `./start-local.sh`. Os serviços de demonstração escutam no loopback. A API aplica as migrações no início. `docker compose down` encerra a instalação e conserva o volume do banco. A raiz do projeto também possui um Dockerfile para hospedar somente o front-end.

Para trabalhar apenas no front-end com Node 22:

```sh
cd frontend
npm ci
npm run dev
```

O servidor de desenvolvimento usa a porta 5173 por padrão. Para testar o service worker e a exportação HTML, execute `npm run build` seguido de `npm run preview`. O build inclui fonte, estilos, biblioteca de planilhas e ícones com a distribuição.

## Implantar a API corporativa

1. Provisione PostgreSQL, configure backup e forneça `DATABASE_URL` ao contêiner construído a partir de `backend/Dockerfile`. O formato com o driver do projeto é `postgresql+psycopg://usuario:senha@host:5432/banco`. Aplique `alembic upgrade head` antes de iniciar múltiplas réplicas.
2. Configure `APP_ENV=production`, `AUTO_CREATE_SCHEMA=false`, `OIDC_ISSUER`, `OIDC_AUDIENCE` e, opcionalmente, `OIDC_JWKS_URL`. Em produção a API exige um token do emissor configurado. Publique atrás de HTTPS. Use `/api/v1/health/live` e `/api/v1/health/ready` para monitorar o processo e a conexão.
3. No provedor OIDC, cadastre o front-end como cliente público de Authorization Code com PKCE e a URL exata da aplicação como retorno, com barra final. Cadastre em PostgreSQL a organização, o usuário pelo `sub` e seu vínculo em `organization_memberships`. Os papéis são `viewer`, `engineer` e `admin`.
4. Informe a origem HTTPS do front-end em `CORS_ORIGINS`. Para Pages, a origem é `https://dekomao.github.io`. No repositório, defina as variáveis de Actions `VITE_API_BASE_URL`, `VITE_OIDC_AUTHORITY` e `VITE_OIDC_CLIENT_ID`. Para uma instalação com usuários vinculados a múltiplas organizações, defina também `VITE_ORGANIZATION_ID` para a organização da instalação. Reexecute o workflow de publicação.
5. Entre pelo botão de sincronização. Uma edição sincronizada produz uma revisão com ETag e auditoria. A fila do IndexedDB conserva as alterações durante uma desconexão. Edições em campos independentes são conciliadas. Em conflito no mesmo campo, o engenheiro pode preservar uma cópia local, selecionar a revisão remota ou manter sua edição sobre a revisão atual.

Detalhes de tipos, eventos, fórmulas, esquema e cenários Given/When/Then estão nos dois SDDs em `docs/`. Os contratos publicados pela API em execução estão em `/api/v1/openapi.json`.

## Verificação

```sh
cd backend
python -m pip install -r requirements.txt -r requirements-dev.txt
python -m pytest -q
cd ../frontend
npm ci
npm run build
npx playwright install chromium
npm test
```

O workflow executa os testes da API em SQLite e PostgreSQL 16, aplica as migrações, constrói o pacote sob o subcaminho do Pages e executa o Playwright em Chromium. O relatório de testes e as capturas desktop, tablet e mobile ficam no artefato **verificacao-industrial**. O deploy do fluxo depende da aprovação desses jobs. Para cronometria de campo, valide a frequência de amostragem, o dispositivo, as condições de captura e a evidência antes de aprovar o ganho.
