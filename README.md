# CronoBalance Industrial

Aplicação PWA de cronoanálise e balanceamento de linhas, evoluída do MVP local-first para uma arquitetura web com front-end offline, API corporativa, PostgreSQL, revisões, auditoria e solver CP-SAT.

## Acesso publicado

A interface está publicada no GitHub Pages: <https://dekomao.github.io/CronoBalance-Industrial-MVP/>. O Pages hospeda a interface estática; por padrão ela funciona local-first no navegador e **não sincroniza com uma nuvem**. A sincronização corporativa exige API acessível por HTTPS, autenticação OIDC e variáveis de ambiente de implantação configuradas. A URL pública não deve receber dados industriais confidenciais.

## O que está implementado

- Interface React + TypeScript responsiva, PWA instalável, tema claro/escuro e gráficos SVG responsivos, seguindo a identidade industrial navy/dourado e o layout de referência.
- Persistência local IndexedDB por Dexie, fila de alterações offline e estado de sincronização/conflito.
- API REST FastAPI com PostgreSQL, isolamento por organização, papéis admin/engenheiro/visualizador, autenticação OIDC, ETags/If-Match, deduplicação de mutações em lote, revisões e auditoria.
- Entidades normalizadas para organização, usuário, estudo, revisão, área, elemento de trabalho, posto, alocação, equipamento fixo, precedência e auditoria.
- Edição em lote dos elementos, importação/migração JSON v1/v2, exportação JSON/CSV/XLSX e snapshots versionados.
- Balanceador CP-SAT que respeita precedência DAG, equipamento fixo, exceções ergonômicas aprovadas, quantidade de postos e limite de ciclo/Takt.
- Docker Compose com PostgreSQL, migração Alembic, API e front-end para execução local em rede.

## Regras de cálculo

- Tempo do elemento: `VA + NVA` para cada cenário.
- Carga do posto: soma dos elementos alocados no posto.
- Ciclo da linha: maior carga entre os postos; esse posto é o gargalo.
- Takt: tempo disponível por turno dividido pela demanda por turno. Demanda zero torna o Takt não avaliável.
- Capacidade teórica: tempo disponível por turno dividido pelo ciclo; ciclo zero torna a capacidade não avaliável.
- CMO por peça: custo da equipe por turno dividido pela capacidade teórica. O custo operacional alocado por área é apresentado separadamente e não entra no CMO.
- Economia mensal estimada: `(CMO atual − CMO futuro) × produção base/dia × dias produtivos/mês`.
- Totais, gráficos, ciclo e KPIs são derivados dos elementos; não são editáveis diretamente.

## Executar localmente com Docker

Requer Docker Desktop com Compose v2. Na raiz do repositório:

```bash
cp .env.example .env
docker compose up --build
```

Acesse `http://localhost:4173`. A API fica em `http://localhost:8000`; documentação OpenAPI em `http://localhost:8000/api/v1/openapi.json`. O perfil local cria uma organização e um usuário de demonstração e usa o token indicado em `.env.example`. Esse token é exclusivamente local: defina `APP_ENV=production`, OIDC e segredos próprios antes de expor o serviço fora da máquina/rede confiável.

Para parar sem remover os dados do banco: `docker compose down`. Para apagar permanentemente o volume PostgreSQL de demonstração: `docker compose down -v`.

## Executar somente o front-end

Requer Node.js 20+:

```bash
cd frontend
npm ci
npm run dev
```

Acesse `http://localhost:5173`. Sem `VITE_API_BASE_URL`, os dados ficam neste navegador/dispositivo; a instalação PWA e a fila local não criam por si só uma nuvem compartilhada.

## Configuração corporativa

Copie `.env.example` para `.env` e configure valores reais antes de uma implantação online:

| Variável | Finalidade |
|---|---|
| `POSTGRES_PASSWORD` | Senha forte do PostgreSQL |
| `APP_ENV` | `production` desativa autenticação de demonstração |
| `OIDC_ISSUER` | Emissor OIDC cujo endpoint JWKS valida os tokens da API |
| `OIDC_AUDIENCE` | Audiência aceita pela API |
| `OIDC_JWKS_URL` | URL JWKS opcional; vazia usa `jwks_uri` do discovery OIDC |
| `VITE_API_BASE_URL` | URL HTTPS da API incluída no build do front-end |
| `CORS_ORIGINS` | Origens HTTPS permitidas pela API, separadas por vírgula |
| `VITE_OIDC_AUTHORITY` | Autoridade OIDC usada pelo cliente web |
| `VITE_OIDC_CLIENT_ID` | Client ID público do cliente OIDC |

O usuário OIDC precisa ser provisionado em `users` e associado a uma organização em `organization_memberships`. A API não cria associações corporativas automaticamente. O cliente OIDC deve permitir Authorization Code + PKCE e usar a URL de callback `${origem}/auth/callback`.

O deployment do Pages desta branch é público e sem API configurada. Para sincronização multiusuário, hospede `api` e PostgreSQL em infraestrutura gerenciada pela organização e configure as variáveis de build/ambiente descritas acima.

## API v1

| Método e rota | Contrato |
|---|---|
| `GET /api/v1/health/live` | Liveness |
| `GET /api/v1/health/ready` | Conectividade com PostgreSQL |
| `GET /api/v1/studies` | Lista paginada por organização |
| `POST /api/v1/studies` | Cria estudo e primeira revisão |
| `GET /api/v1/studies/{id}` | Estudo, derivações e `ETag` |
| `PATCH /api/v1/studies/{id}/elements/batch` | Atualização em lote; exige `If-Match` e `clientMutationId` |
| `PUT /api/v1/studies/{id}/precedences` | Substitui o DAG após validar ciclos |
| `POST /api/v1/studies/{id}/optimize` | Gera proposta CP-SAT para uma revisão |
| `POST /api/v1/studies/{id}/optimization-proposals/apply` | Aplica proposta validada com controle de versão |
| `POST /api/v1/studies/import-legacy` | Importa JSON legado v1/v2 (máx. 5 MiB, 500 elementos, 100 áreas e 20 postos/cenário) |
| `GET /api/v1/studies/{id}/revisions` | Histórico de revisões |
| `GET /api/v1/studies/{id}/revisions/{n}` | Snapshot imutável da revisão |
| `POST /api/v1/studies/{id}/approve` | Aprovação por perfil admin com comentário obrigatório |
| `GET /api/v1/studies/{id}/audit` | Trilha de auditoria recente |

Mutação concorrente com ETag desatualizada retorna HTTP 412. Envie o ETag retornado pelo servidor em `If-Match`; não tente resolver conflitos sobrescrevendo silenciosamente a revisão remota.

## Verificações

```bash
cd frontend && npm ci && npm run build
cd ../backend && python -m pip install -r requirements.txt -r requirements-dev.txt && pytest
```

A suíte de backend cobre cálculos, DAG, alteração de NVA e gargalo, semáforo de Takt, bloqueio de posto ocupado, rebalanceamento com precedência, importação legada e conflito de revisão. O build de produção é executado também pelo GitHub Actions antes da publicação.

## Limites de prontidão

O repositório entrega uma base executável localmente e publicável como front-end estático. A operação corporativa compartilhada depende de provisionamento OIDC, segredo real de PostgreSQL, API HTTPS e hospedagem de backend. Antes de tratar propostas de balanceamento como padrão aprovado, valide os dados e as restrições da linha com Engenharia, Segurança, Ergonomia e responsáveis pelo processo. O solver otimiza a alocação matemática declarada; não certifica segurança ou viabilidade física por conta própria.

## Licença

Consulte a licença definida pelo repositório antes de redistribuir ou operar como produto comercial.
