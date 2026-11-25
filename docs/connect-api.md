# API interna do CS REDE CONNECT

O checkout envia `Authorization: Bearer <CONNECT_TOKEN>` a partir do backend. Use HTTPS entre hosts. A rede Docker privada da instalação pode usar HTTP com `CONNECT_PRIVATE_HTTP=true`. A identidade do lojista é a instalação e o banco exclusivo. O token do Connect e a chave do cofre são distintos.

| Método e caminho | Operação |
| --- | --- |
| GET `/v1/health` | Identidade do serviço, versão e disponibilidade dos módulos. |
| GET `/v1/network` | Mede a saída via sonda HTTPS e informa data e mudança no processo atual. O backend mantém o histórico no PostgreSQL. |
| GET `/v1/rede/:environment` | Mostra configuração, conta mascarada e data da autenticação. |
| PUT `/v1/rede/:environment` | Valida `clientId` e `clientSecret` no OAuth e substitui atomicamente a credencial. |
| POST `/v1/rede/:environment/test` | Testa a credencial gravada e devolve somente o estado da verificação. |
| DELETE `/v1/rede/:environment` | Desconecta a credencial da instalação. |
| POST `/v1/rede/sandbox/pix/create` | Solicita Pix Sandbox por `reference` e `cents`. |
| POST `/v1/rede/sandbox/pix/query` | Consulta o Pix por referência e compara o valor. |
| POST `/v1/rede/sandbox/pix/refund` | Pede estorno integral com referência, valor e `tid`. |

Somente `sandbox` e `production` são ambientes válidos. As rotas financeiras do Connect bloqueiam Produção. O Connect resolve método e destino oficiais no código e rejeita redirecionamentos. O navegador chama a API protegida do backend, que valida proprietário, origem e CSRF antes de chegar ao Connect. A API do painel exige `Idempotency-Key` na emissão e confirmação explícita antes de solicitar estorno.

O cofre usa AES-256-GCM. A chave `CONNECT_REDE_KEY` fica no Connect. O banco guarda a conta mascarada e o conteúdo cifrado, vinculado ao ambiente e à revisão. O token OAuth fica em memória durante a chamada. Erros devolvem códigos e descrições limitados, quando disponíveis. As APIs administrativas usam respostas sem cache.
