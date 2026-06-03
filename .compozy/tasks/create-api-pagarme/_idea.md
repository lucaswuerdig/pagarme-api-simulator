# Fake Pagar.me API — Especificação de Implementação

Documento de especificação para implementar uma **API fake do Pagar.me (v5)** que substitua o ambiente de
homologação do Pagar.me nos testes de pagamento de cartão de crédito. O objetivo é eliminar a dependência da
disponibilidade do ambiente de homologação do Pagar.me.

> Este documento é o contrato. Um modelo de IA (ou qualquer dev) deve conseguir implementar a API fake apenas
> lendo daqui. A stack é livre (Node/Express, PHP/Laravel, Python/FastAPI, etc.) — o que importa é cumprir os
> contratos de **rota**, **request** e **response** descritos abaixo.

---

## 1. Contexto: como o sistema fala com o Pagar.me hoje

Toda comunicação com o Pagar.me passa por **um único ponto de saída**: o método `makeRequest()` em
`app/Services/Gateways/Pagarme.php`. Ele monta a URL como:

```php
$this->httpClient->request($httpVerb, $this->apiUrl . $resource, [...]);
```

- `$this->apiUrl` hoje é **fixo** em `https://api.pagar.me` (método `setApiUrl()`, `Pagarme.php:127`).
- `$resource` é o path da rota (ex.: `/core/v5/orders`).

> ⚠️ Importante: no Pagar.me v5, **homologação e produção usam a MESMA URL** (`https://api.pagar.me`). O que
> distingue teste de produção é a **chave de API** (`sk_test_*` vs `sk_*`), enviada no header `Authorization`.
> Por isso só existe uma URL no código. A nossa fake vai assumir o papel dessa URL única em ambiente de teste.

Todas as operações de cartão convergem para `makeRequest`:

| Operação no sistema | Método do gateway | Verbo HTTP | Rota (`$resource`) |
|---|---|---|---|
| Venda com captura | `makeAuthAndCapture()` | `POST` | `/core/v5/orders` |
| Pré-autorização (sem captura) | `makeAuth()` | `POST` | `/core/v5/orders` |
| Captura posterior | `makeCapture()` | `POST` | `/core/v5/charges/{charge_id}/capture` |
| Cancelamento / estorno | `makeCancel()` | `DELETE` | `/core/v5/charges/{charge_id}` |
| Tokenização de cartão | `tokenizeCreditCard()` | `POST` | `/core/v5/tokens?appId={public_key}` |

Implementando essas 5 rotas, o fluxo inteiro de cartão do `CreditCardTransaction.php` funciona contra a fake.

---

## 2. Autenticação

O sistema envia em **todas** as requisições autenticadas:

```
accept: application/json
content-type: application/json
authorization: Basic base64("<api_key>:")
```

- O token é `pagarme_api_key` da `payment_settings` (a chave de teste `sk_test_...`), ou um `storeKey` específico.
- O formato é HTTP Basic com **usuário = chave** e **senha vazia**: `base64(api_key + ":")`.

**A fake deve aceitar/ignorar o header `Authorization`** (não precisa validar a chave). Opcionalmente, pode validar
que o header existe e começa com `Basic ` para devolver `401` em testes de erro de auth.

---

## 3. Regras de decisão do parser (a parte crítica)

O sistema **não olha o HTTP status** para decidir aprovação — ele lê o **corpo (body)** da resposta. Entender estas
regras é o que faz a fake funcionar.

### 3.1 Quando o sistema considera SUCESSO

Após `POST /core/v5/orders`, o método `isResponseWithError()` roda sobre o body **cru** (snake_case). Para ser
considerado **sucesso**, o body precisa satisfazer TODAS as condições:

1. `status` (nível raiz) **diferente** de `"failed"`.
2. `charges[0].last_transaction.status` **diferente** de `"with_error"`.
3. `charges[0].last_transaction.success` **diferente** de `false` (use `true`).

Se qualquer uma falhar, o sistema trata como erro/recusa (retorna `PaymentResponse(false)`).

### 3.2 Status válidos

Valores de status usados (do enum `App\Domain\Gateway\PagarMe\PaymentStatus`):

```
failed                        → falha geral do pedido (raiz)
authorized_pending_capture    → APROVADO sem captura (pré-autorização / auth_only)
captured                      → APROVADO e capturado (auth_and_capture) ✅ caso mais comum
not_authorized                → recusado pela operadora
with_error                    → erro na transação
waiting_capture               → aguardando captura
refunded / voided             → estornado / cancelado
```

- **Aprovado com captura:** `last_transaction.status = "captured"`.
- **Aprovado sem captura (auth only):** `last_transaction.status = "authorized_pending_capture"`.
- **Recusado:** `last_transaction.status = "not_authorized"` + `success = false`.
- **Erro:** `last_transaction.status = "with_error"`.

> Internamente o sistema converte esses status para PascalCase ao salvar (`captured` → `Captured`), mas **a fake
> sempre devolve em snake_case** — a conversão é feita pelo sistema.

### 3.3 HTTP status que a fake deve retornar

- **Sucesso, recusa e erro de negócio** (aprovado / not_authorized / with_error): retornar **HTTP 200**.
  O resultado é determinado pelo BODY, não pelo status. Se a fake devolver 4xx aqui, o cliente Guzzle lança
  exceção e o sistema cai no tratamento de erro de infra (não no parsing de negócio que queremos testar).
- **Simular indisponibilidade / erro de infra do Pagar.me**: retornar **HTTP 5xx** (ex.: 500/503). O sistema
  trata via `RequestException` e devolve `PaymentResponse(false)` com o status code recebido.
- **Erro de autenticação** (opcional): **HTTP 401**.

---

## 4. Endpoints

### 4.1 `POST /core/v5/orders` — Criar pedido (venda / pré-autorização)

**Quando é chamado:** toda venda de cartão. `operation_type` no request indica se é com ou sem captura.

#### Request (enviado pelo sistema)

```json
{
  "payments": [
    {
      "amount": 1990,
      "payment_method": "credit_card",
      "credit_card": {
        "card": {
          "number": "4000000000000010",
          "holder_name": "FULANO DE TAL",
          "exp_month": 12,
          "exp_year": 30,
          "cvv": "123",
          "billing_address": {
            "country": "br",
            "state": "SP",
            "city": "Sao Paulo",
            "zip_code": "01001000",
            "line_1": "100, Praca da Se, Se"
          }
        },
        "operation_type": "auth_and_capture",
        "installments": 1,
        "statement_descriptor": "APPMAX*LOJA"
      }
    }
  ],
  "code": "PREFIXO_12345_a1b2c",
  "customer": {
    "name": "Fulano De Tal",
    "type": "individual",
    "country": "br",
    "document": "12345678909",
    "document_type": "CPF",
    "phones": { "mobile_phone": { "country_code": "55", "area_code": "11", "number": "999999999" } },
    "email": "fulano@example.com",
    "address": { "country": "br", "state": "SP", "city": "Sao Paulo", "zip_code": "01001000", "line_1": "..." }
  },
  "items": [
    { "code": "1", "description": "Produto X", "amount": 1990, "quantity": 1 }
  ],
  "metadata": { "site": "Minha Loja" },
  "SubMerchant": {
    "Merchant_Category_Code": "0000",
    "Payment_Facilitator_Code": "0000",
    "Code": "...", "Name": "...", "Document": "...", "Type": "...", "Address": {}
  },
  "closed": true
}
```

**Variações do `credit_card`** (a fake deve aceitar qualquer uma):
- Cartão novo (acima): `credit_card.card` com `number`, `holder_name`, `exp_month`, `exp_year`, `cvv`.
- Cartão tokenizado por id: `credit_card.card_id` = `"card_xxx"`.
- Cartão tokenizado por token: `credit_card.card_token` = `"token_xxx"`.

**Campos garantidos no request:** `number` (sem espaços), `holder_name`, `cvv` não vazios; `exp_month` entre 1–12;
`exp_year` >= ano atual. O sistema valida isso antes de enviar (`RequestValidate`), então a fake pode confiar nesses
campos quando recebe cartão novo.

#### Response de SUCESSO (HTTP 200) — venda com captura

Campos marcados com ⭐ são **lidos pelo sistema depois** (captura/cancelamento/registro). Não omita.

```json
{
  "id": "or_fake_0001",
  "code": "PREFIXO_12345_a1b2c",
  "status": "paid",
  "amount": 1990,
  "currency": "BRL",
  "closed": true,
  "customer": { "id": "cus_fake_0001", "name": "Fulano De Tal", "email": "fulano@example.com" },
  "charges": [
    {
      "id": "ch_fake_0001",
      "code": "PREFIXO_12345_a1b2c",
      "amount": 1990,
      "status": "paid",
      "payment_method": "credit_card",
      "last_transaction": {
        "id": "tran_fake_0001",
        "transaction_type": "credit_card",
        "amount": 1990,
        "status": "captured",
        "success": true,
        "installments": 1,
        "operation_type": "auth_and_capture",
        "statement_descriptor": "APPMAX*LOJA",
        "acquirer_name": "cielo",
        "acquirer_tid": "1234567890",
        "acquirer_nsu": "123456",
        "acquirer_auth_code": "123456",
        "acquirer_return_code": "00",
        "gateway_id": "...",
        "card": {
          "id": "card_fake_0001",
          "first_six_digits": "400000",
          "last_four_digits": "0010",
          "brand": "Visa",
          "holder_name": "FULANO DE TAL",
          "exp_month": 12,
          "exp_year": 30
        }
      }
    }
  ],
  "metadata": { "site": "Minha Loja" }
}
```

**Por que cada campo ⭐ importa:**
- `id` (raiz) e `code` → usados como identificador da transação (`getIdentifier`, `getTransactionToken`).
- `charges[0].id` → usado por `makeCapture` e `makeCancel` para montar a rota seguinte (`/charges/{id}/...`).
- `charges[0].amount` → enviado no body da captura.
- `last_transaction.status` = `captured` e `success` = `true` → definem aprovação (ver §3.1).
- `last_transaction.card.id` → vira o token do cartão (instant buy key) para upsell/one-click.
- `last_transaction.acquirer_*` → usados para NSU, TID, código de autorização e mensagens de recusa.
- `metadata.site` → o sistema usa para resolver o `pagarme_api_key` (store token). Mantenha presente.

#### Response de SUCESSO (HTTP 200) — pré-autorização (sem captura)

Igual ao anterior, mas com:
- `status` (raiz): `"authorized_pending_capture"` (ou `"pending"`)
- `charges[0].status`: `"authorized_pending_capture"`
- `last_transaction.status`: `"authorized_pending_capture"`
- `last_transaction.operation_type`: `"auth_only"`
- `last_transaction.success`: `true`

> O sistema dispara `makeAuth()` (sem captura) quando `operation_type` do request = `auth_only`. Depois pode chamar
> `POST /core/v5/charges/{id}/capture` para capturar.

#### Response de RECUSA (HTTP 200)

```json
{
  "id": "or_fake_0002",
  "code": "PREFIXO_12345_x9y8z",
  "status": "failed",
  "amount": 1990,
  "charges": [
    {
      "id": "ch_fake_0002",
      "amount": 1990,
      "status": "failed",
      "payment_method": "credit_card",
      "last_transaction": {
        "id": "tran_fake_0002",
        "transaction_type": "credit_card",
        "amount": 1990,
        "status": "not_authorized",
        "success": false,
        "acquirer_name": "cielo",
        "acquirer_return_code": "57",
        "gateway_response": { "code": "57", "errors": [{ "message": "Transação não autorizada" }] },
        "card": { "id": "card_fake_0002", "first_six_digits": "400000", "last_four_digits": "0002", "brand": "Visa" }
      }
    }
  ],
  "metadata": { "site": "Minha Loja" }
}
```

- `success: false` faz o sistema tratar como recusa.
- `acquirer_name` + `acquirer_return_code` são usados para montar a mensagem de recusa exibida ao cliente.

#### Response de ERRO DE TRANSAÇÃO (HTTP 200)

Igual à recusa, mas `last_transaction.status = "with_error"` (e `success: false`).

#### Response de INDISPONIBILIDADE / erro de infra (HTTP 5xx)

Retornar HTTP 500/503 com qualquer body JSON (ex.: `{ "message": "service unavailable" }`). Útil para testar o
comportamento do sistema quando o gateway está fora.

---

### 4.2 `POST /core/v5/charges/{charge_id}/capture` — Capturar cobrança

**Quando é chamado:** captura de uma pré-autorização, e em retentativas de captura.

#### Request

```json
{ "amount": 1990 }
```

(`charge_id` vem na URL; `amount` vem do `charges[0].amount` salvo na venda.)

#### Response de SUCESSO (HTTP 200)

A resposta de captura é um **objeto charge** (não vem dentro de `charges[]`). O parser checa
`last_transaction` no nível raiz:

```json
{
  "id": "ch_fake_0001",
  "code": "PREFIXO_12345_a1b2c",
  "amount": 1990,
  "status": "paid",
  "payment_method": "credit_card",
  "last_transaction": {
    "id": "tran_capture_0001",
    "transaction_type": "credit_card",
    "amount": 1990,
    "status": "captured",
    "success": true,
    "operation_type": "capture",
    "acquirer_name": "cielo",
    "acquirer_return_code": "00",
    "acquirer_tid": "1234567890",
    "acquirer_nsu": "123456",
    "card": { "id": "card_fake_0001", "first_six_digits": "400000", "last_four_digits": "0010", "brand": "Visa" }
  }
}
```

Regras de sucesso (sobre o body cru): `status` (raiz) != `failed`, `last_transaction.status` != `with_error`,
`last_transaction.success` != `false`.

#### Response de FALHA na captura (HTTP 200)

`last_transaction.status = "with_error"` e `success = false`. O sistema tem retry de captura (Redis/RMQ); para
testes simples basta devolver erro de negócio.

---

### 4.3 `DELETE /core/v5/charges/{charge_id}` — Cancelar / estornar cobrança

**Quando é chamado:** estorno (`refundOrder`), cancelamento em fluxos de upsell e em `auto_refund`.

#### Request

- Cancelamento total: **sem body** (ou body vazio).
- Cancelamento/estorno parcial: `{ "amount": 1990 }`.

#### Response de SUCESSO (HTTP 200)

Objeto charge com `last_transaction` no nível raiz:

```json
{
  "id": "ch_fake_0001",
  "code": "PREFIXO_12345_a1b2c",
  "amount": 1990,
  "status": "canceled",
  "payment_method": "credit_card",
  "canceled_amount": 1990,
  "last_transaction": {
    "id": "tran_cancel_0001",
    "transaction_type": "credit_card",
    "amount": 1990,
    "status": "voided",
    "success": true,
    "operation_type": "void",
    "acquirer_name": "cielo",
    "acquirer_return_code": "00"
  }
}
```

- Use `status: "voided"` (cancelamento) ou `"refunded"` (estorno) no `last_transaction`.
- `canceled_amount` / `refunded_amount` ajudam o sistema a registrar o valor estornado.
- `success: true` para não ser tratado como erro.

---

### 4.4 `POST /core/v5/tokens?appId={public_key}` — Tokenizar cartão

**Quando é chamado:** `tokenizeCreditCard()` (salvar cartão / one-click). `appId` (query string) é a
`pagarme_public_api_key`.

#### Request

```json
{
  "card": {
    "number": "4000000000000010",
    "holder_name": "FULANO DE TAL",
    "exp_month": 12,
    "exp_year": 30,
    "cvv": "123"
  },
  "type": "card"
}
```

#### Response de SUCESSO (HTTP 200/201)

```json
{
  "id": "token_fake_0001",
  "type": "card",
  "created_at": "2026-05-29T12:00:00Z",
  "expires_at": "2026-05-29T13:00:00Z",
  "card": {
    "id": "card_fake_0001",
    "first_six_digits": "400000",
    "last_four_digits": "0010",
    "brand": "Visa",
    "holder_name": "FULANO DE TAL",
    "exp_month": 12,
    "exp_year": 30
  }
}
```

#### Response de ERRO (HTTP 4xx)

Retornar `400/422` com body de erro faz o sistema cair no tratamento de `RequestException` da tokenização.

---

## 5. Comportamento por "cartão mágico" (sugestão)

Para testar os diferentes ramos sem alterar a fake a cada cenário, sugere-se decidir o resultado pelo **número do
cartão** recebido (ou pelo `card_id`/`card_token`). Convenção sugerida (livre para ajustar):

| Número do cartão | Cenário | Response |
|---|---|---|
| `4000000000000010` | Aprovado + capturado | `200`, `last_transaction.status = captured`, `success: true` |
| `4000000000000028` | Aprovado sem captura | `200`, `status = authorized_pending_capture`, `success: true` |
| `4000000000000002` | Recusado pela operadora | `200`, `status = not_authorized`, `success: false`, `acquirer_return_code = "57"` |
| `4000000000000036` | Erro na transação | `200`, `last_transaction.status = with_error`, `success: false` |
| `4000000000000044` | Pedido falhou (raiz) | `200`, `status (raiz) = failed` |
| `4000000000009999` | Indisponibilidade (infra) | `500` ou `503` |

> Para `card_id`/`card_token` (fluxos tokenizados), defina ids mágicos análogos (ex.: `card_approved`, `card_refused`).
> Sempre devolva os mesmos `charges[0].id` e `card.id` ao longo do ciclo de vida de um mesmo pedido para que
> captura/cancelamento subsequentes encontrem os ids.

---

## 6. Estado interno da fake (recomendado)

Para suportar o ciclo venda → captura → cancelamento de forma coerente:

- Guardar em memória (ou arquivo) os pedidos criados, indexados por `charge_id`.
- Na criação (`/orders`), gerar `id` (`or_...`), `charge_id` (`ch_...`), `card.id` (`card_...`) e persistir.
- Em `/charges/{id}/capture` e `DELETE /charges/{id}`, localizar o pedido pelo `charge_id` e atualizar o status.
- IDs podem ser sequenciais/determinísticos para facilitar asserts em testes.

Não há necessidade de banco de dados; um `Map`/dicionário em memória basta. Persistência opcional para sobreviver a
restart.

---

## 7. Como conectar no sistema (alteração necessária no repositório)

Hoje a URL é fixa. Para apontar para a fake **só em homologação/teste** e manter produção intacta, tornar a URL
configurável via env. Duas mudanças:

**1. `config/pagarme.php`** — adicionar a chave:

```php
'api_url' => env('PAGARME_API_URL', 'https://api.pagar.me'),
```

**2. `app/Services/Gateways/Pagarme.php`** (método `setApiUrl()`, ~linha 127) — ler do config:

```php
protected function setApiUrl()
{
    return config('pagarme.api_url', 'https://api.pagar.me');
}
```

**3. `.env` de homologação/local** — apontar para a fake:

```
PAGARME_API_URL=http://localhost:8088
```

Em produção, **não definir** `PAGARME_API_URL` (cai no default `https://api.pagar.me`). Lembrar de rodar
`php artisan config:clear` após alterar.

> Observação: a fake responde nas rotas com prefixo `/core/v5/...`, exatamente como o Pagar.me real, porque o
> sistema concatena `apiUrl + resource` e os `resource` já incluem `/core/v5/...`. Ou seja, a fake escutando em
> `http://localhost:8088` precisa responder em `http://localhost:8088/core/v5/orders`, etc.

---

## 8. Checklist de campos obrigatórios por resposta

Resumo do mínimo que cada response precisa conter para o sistema não quebrar:

**`POST /core/v5/orders` (sucesso):**
- [ ] `id` (raiz)
- [ ] `code` (ecoar o `code` recebido no request)
- [ ] `status` (raiz) — não pode ser `failed` para sucesso
- [ ] `charges[0].id`
- [ ] `charges[0].amount`
- [ ] `charges[0].last_transaction.status` (`captured` ou `authorized_pending_capture`)
- [ ] `charges[0].last_transaction.success: true`
- [ ] `charges[0].last_transaction.card.id`
- [ ] `charges[0].last_transaction.acquirer_name` + `acquirer_return_code`
- [ ] `metadata.site`

**`POST /core/v5/charges/{id}/capture` (sucesso):**
- [ ] `id` (charge id)
- [ ] `status` != `failed`
- [ ] `last_transaction.status: captured`, `success: true`

**`DELETE /core/v5/charges/{id}` (sucesso):**
- [ ] `id` (charge id)
- [ ] `last_transaction.status: voided` (ou `refunded`), `success: true`
- [ ] `canceled_amount` / `refunded_amount` (recomendado)

**`POST /core/v5/tokens` (sucesso):**
- [ ] `id` (token id)
- [ ] `card.id`, `card.first_six_digits`, `card.last_four_digits`, `card.brand`

---

## 9. Resumo executivo

1. A fake precisa implementar **5 rotas** com prefixo `/core/v5/`: criar pedido, capturar, cancelar e tokenizar.
2. Aprovação/recusa é decidida pelo **body** (`last_transaction.status` + `success`), não pelo HTTP status —
   devolver **200** para resultados de negócio e **5xx** só para simular indisponibilidade.
3. Os campos `charges[0].id`, `charges[0].amount`, `card.id`, `code`, `metadata.site` e os `acquirer_*` são lidos
   em etapas posteriores — não podem faltar.
4. Conectar exige **3 ajustes**: `config/pagarme.php`, `setApiUrl()` e `PAGARME_API_URL` no `.env` de teste.
5. Em produção, sem `PAGARME_API_URL`, nada muda — continua batendo em `https://api.pagar.me`.
