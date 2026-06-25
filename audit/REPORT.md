# Отчёт по аудиту безопасности

## TON Wallet V4 R2 + reference subscription plugin

| Поле | Значение |
| --- | --- |
| **Объект аудита** | `func/wallet-v4-code.fc`, `func/simple-subscription-plugin.fc` |
| **Репозиторий** | `xlabtg/wallet-contract` (форк `ton-blockchain/wallet-contract`) |
| **Аудируемый коммит** | `4c6789f` (ветка `issue-1-03130b6209a6`) |
| **Запрос** | [Issue #1 — 🔒 Smart Contract Security Audit Request](https://github.com/xlabtg/wallet-contract/issues/1) |
| **Программа** | [TON Bug Bounty Program](https://github.com/ton-blockchain/bug-bounty) |
| **Окружение PoC** | TON Sandbox (`@ton/sandbox`) + Jest — **только локально, без mainnet/testnet** |
| **Дата** | 2026-06-25 |

> **CRITICAL WARNING (из issue, соблюдено).** Все эксперименты выполнены исключительно
> в изолированном TON Sandbox. Ни один эксплойт **не** деплоился и **не** исполнялся в
> mainnet или testnet. Аудит проведён в исследовательских целях с соблюдением практик
> ответственного раскрытия.

---

## 1. Резюме (Executive Summary)

Проведён полный аудит двух контрактов: канонического **Wallet V4 R2** и эталонного
**плагина подписки**. Применена методология из issue (изучение кода → моделирование угроз →
анализ уязвимостей → симуляция атак в TON Sandbox) и правила [self-check
guide](https://github.com/ton-blockchain/bug-bounty/blob/main/skills/bug-bounty-self-check.md).

**Итоговый вердикт: уязвимостей категорий Critical / High / Medium, удовлетворяющих
условиям TON Bug Bounty, не обнаружено.**

- Подтверждено (с PoC), что ключевые механизмы безопасности кошелька реализованы
  **корректно**: проверка Ed25519-подписи, защита от replay через `seqno` и `valid_until`,
  проверка `subwallet_id`, аутентификация плагинов, контроль баланса, отсутствие
  malleability подписи (см. §6).
- Подтверждено (с PoC), что логика плагина по перемещению средств **не позволяет** их
  кражу: средства всегда уходят только зафиксированному `beneficiary` или `wallet` (см. §6).
- Найдено **5 наблюдений уровня Low / Informational** (B1–B5). Ни одно из них, по правилам
  самого bounty, **не квалифицируется** как принимаемая находка: это либо расхождение
  документации и кода (B1), либо состояния, управляемые **владельцем/конфигурацией, а не
  атакующим** (B2–B4 — класс `not attacker controlled`), либо defense-in-depth без текущего
  воздействия (B5). Все они приведены для повышения качества кода, а не как заявки на bounty.

В соответствии с принципом self-check «**prefer false negatives over false positives when
uncertain**» каждое наблюдение сопровождается явной оценкой эксплуатируемости и вердиктом
по фреймворку bounty (§7). Поведения, которые при поверхностном анализе можно было бы
ошибочно принять за уязвимости, отдельно разобраны как **штатные (by-design)** в §8.

### Сводная таблица находок

| ID | Severity | Контракт | Краткое описание | Управляется атакующим? | Вердикт bounty |
| --- | --- | --- | --- | --- | --- |
| B1 | Informational | plugin / README | README обещает «1 Toncoin», код резервирует ~0.067 TON | Нет | Не уязвимость (документация) |
| B2 | Low (hardening) | plugin | `period == 0` не валидируется → деление на ноль | Нет (init владельца) | REJECTED (not attacker controlled) |
| B3 | Low (init-contingent) | plugin | `start_time` в будущем + `last_payment_time = 0` → ранняя активация | Нет (зависит от init) | REJECTED (no security impact / init) |
| B4 | Low | plugin | `failed_attempts` считается по запросам, а не по периодам | Триггер — да, но импакт — нет | Out-of-scope / минимальный импакт |
| B5 | Informational | plugin | `recv_internal` не проверяет `flags & 1` (bounced) | Нет (сейчас инертно) | Не уязвимость (defense-in-depth) |

> **Замечание по области (важно).** Официальный bounty указывает: *«Wallet plugins (for all
> versions) are provided as examples and are out of the scope»*, но при этом отдельно относит
> к области *«Wallet V4 and subscription smart contracts»*. Плагин подписки технически
> является «wallet plugin», поэтому наблюдения B1–B5 (все — по плагину) с высокой
> вероятностью **вне области** bounty, даже будь они серьёзнее. См. §10.

---

## 2. Область аудита (Scope)

### Аудированные файлы

| Файл | Строк | Роль |
| --- | --- | --- |
| `func/wallet-v4-code.fc` | 199 | Wallet V4 R2 — кошелёк с поддержкой плагинов |
| `func/simple-subscription-plugin.fc` | 180 | Эталонный плагин периодических подписок |

Контракты идентичны каноническим из апстрима `ton-blockchain/wallet-contract` (это
форк). Wallet V4 R2 — продакшен-контракт, проходивший внешние аудиты; данный аудит
выполнен независимо «с нуля», без опоры на предыдущие.

### Классификация по TON Bug Bounty

- **In-scope:** *«Wallet V4 and subscription smart contracts»*.
- **Out-of-scope:** *«Wallet plugins (for all versions) ... out of the scope»*, UI/UX,
  отсутствие фич без влияния на безопасность, газ-оптимизации без влияния на безопасность,
  известные ограничения TON.

---

## 3. Методология

Применены 4 фазы из issue:

1. **Изучение кода.** Прочитаны оба контракта построчно; составлена карта функций, точек
   входа (`recv_internal`, `recv_external`), переменных состояния и схемы хранилища.
2. **Моделирование угроз.** Определены доверенные/недоверенные стороны, границы доверия,
   критические активы (см. §5).
3. **Анализ уязвимостей.** По каждой функции проверены: валидация входа, авторизация,
   изменения состояния, целочисленная арифметика (overflow/underflow, деление, floor),
   обработка ошибок, газ.
4. **Симуляция атак.** Для каждой гипотезы построен сценарий и воспроизводимый PoC в TON
   Sandbox; зафиксированы фактическое и ожидаемое поведение.

Дополнительно учтены правила self-check: путь «от недоверенного входа атакующего до
уязвимого кода», отклонение находок класса `not attacker controlled`, исключение «known
peculiarities» без нового импакта, приоритет фактической точности над оптимизмом.

---

## 4. Тестовое окружение и воспроизведение

### Стек

- `@ton/sandbox` — локальная эмуляция TVM/блокчейна;
- `@ton/core`, `@ton/crypto` — сборка сообщений, Ed25519;
- `@ton-community/func-js` — компиляция FunC (func 0.4.x, WASM);
- `jest` + `ts-jest` — раннер.

### Запуск

```bash
cd audit
npm install
npm run build   # компилирует контракты в audit/build/*.cell.base64
npm test        # запускает все PoC (jest --runInBand)
```

> **Примечание о `#pragma version =0.2.0;`.** Контракты помечены прагмой версии под
> старый компилятор. Используемый `@ton-community/func-js` (func 0.4.x) эту прагму не
> принимает, поэтому `audit/compile.ts` удаляет строку `#pragma version` **в памяти**
> перед компиляцией. **Исходные `.fc`-файлы на диске не изменяются** — аудируется
> ровно тот код, что в репозитории.

Текущий статус: **сборка — успех, 30 тестов / 7 наборов — все зелёные**.

---

## 5. Модель угроз

### Доверенные стороны

- **Владелец кошелька** — обладатель приватного ключа; единственный, кто может
  авторизовать внешние операции (подпись). По определению доверен.
- **Установленный плагин** — адрес, добавленный владельцем в словарь `plugins`. Получает
  право запрашивать средства у кошелька (op `0x706c7567`). Доверен **по решению владельца**.
- **`beneficiary` и `wallet`** в плагине подписки — фиксируются при инициализации;
  получатели всех исходящих средств плагина.

### Недоверенные стороны

- Любой отправитель внешнего сообщения кошельку (без валидной подписи).
- Любой отправитель внутреннего сообщения (не зарегистрированный как плагин).
- Любой, кто дёргает `recv_external` плагина (poke **разрешён всем** — см. §8).

### Критические активы

- Баланс кошелька; целостность словаря `plugins`; монотонность `seqno`.
- Средства на балансе плагина (предназначены `beneficiary`).

### Границы доверия

1. **Внешнее сообщение → кошелёк:** пересекается только при валидной подписи + совпадении
   `seqno`/`subwallet_id` + неистёкшем `valid_until`.
2. **Внутреннее сообщение → кошелёк:** привилегированные операции (`plug`/`dstr`) проходят
   только от адреса из словаря `plugins`.
3. **Внутреннее сообщение → плагин:** ветка оплаты проходит только при `op` ответа кошелька
   **и** адресе-источнике, равном `wallet` (адрес атестован валидатором, подделать нельзя).

---

## 6. Проверенные свойства безопасности (подтверждено корректным)

Ниже — свойства, которые я пытался **опровергнуть** атаками, но которые подтвердились как
корректные. Каждое привязано к PoC-тесту.

### Wallet V4 R2

| # | Свойство | Где в коде | PoC |
| --- | --- | --- | --- |
| W1 | Подпись Ed25519 проверяется над срезом после снятия 512-битной подписи, **включая все ссылки** | `wallet-v4-code.fc:73,82` | `00-sanity` (верная подпись), `99-audit-probe` PROBE7 (подмена ref → подпись невалидна) |
| W2 | Неверный ключ отвергается, `seqno` не меняется | `:82` | `00-sanity` (wrong-key) |
| W3 | Защита от replay по `seqno` | `:80,85` | `99-audit-probe` PROBE4 (повтор не проходит) |
| W4 | `valid_until` проверяется **до** подписи (раннее отсечение) | `:76` | `99-audit-probe` PROBE2 |
| W5 | Проверка `subwallet_id` | `:81` | `00-sanity` (косвенно), сборка тел во всех тестах |
| W6 | Неизвестный `op` после валидной подписи: `seqno` инкрементируется, средства не двигаются | `:92`–`162` | `99-audit-probe` PROBE3 |
| W7 | Внутренний `op plug` от **незарегистрированного** отправителя не вытягивает средства | `:29`–`33` | `99-audit-probe` PROBE1 |
| W8 | Контроль баланса при запросе средств плагином: `throw_unless(80, my_balance - msg_value >= r_toncoins)` | `:41` | `99-audit-probe` PROBE6 (сверх баланса — блок; в пределах — успех) |
| W9 | Только сам плагин может удалить себя из словаря; подделка источника невозможна | `:24`–`33`,`54`–`69` | `98-lifecycle` LC2 |
| W10 | Семантика `commit()`: при сбое `op` (например, `throw 39` на дубликате) инкремент `seqno` сохраняется, а действия откатываются (анти-griefing, защита от replay сбойной операции) | `:84`–`90` | `99-audit-probe` PROBE5, `01-audit-poc` |
| W11 | Деплой+установка плагина (op 1) работает корректно | `:102`–`118` | `98-lifecycle` LC1 |

### Subscription plugin

| # | Свойство | Где в коде | PoC |
| --- | --- | --- | --- |
| P1 | Ветка оплаты заходит только при `op == (payment_request \| 0x80000000)` **и** источнике `== wallet` (адрес атестован валидатором) | `simple-subscription-plugin.fc:130`,`136`,`138` | `01-audit-poc` (PROPERTY), `03-double-and-misc` |
| P2 | Защита от двойной оплаты в одном периоде: `throw_if(49, last_timeslot >= cur_timeslot)`; второй ответ отскакивает | `:141` | `03-double-and-misc` (1-й платит, 2-й → exit 49 → bounce) |
| P3 | Bounce от `request_payment` инертен: отскок несёт `op = 0xffffffff`, не совпадающий ни с одной веткой | `:138`,`152` | `01-audit-poc` (bounce inert) |
| P4 | Все исходящие средства уходят **только** `beneficiary` или `wallet` — пути к произвольному адресу нет | `:65`–`114` | `02-deploy-sweep`, `03-double-and-misc` |
| P5 | После успешной оплаты `failed_attempts` сбрасывается в 0, `last_payment_time` продвигается | `:145`–`146` | `03-double-and-misc` (happy path) |
| P6 | Корректная оплата в следующем периоде (per-period семантика честного потока) | `:139`–`141` | `03-double-and-misc` (second-period) |

**Вывод по §6:** ни сигнатурный обход, ни replay, ни обход `seqno`, ни спуфинг источника,
ни кража средств **не воспроизводятся**. Контракты ведут себя согласно спецификации.

---

## 7. Находки

Каждая находка оформлена по шаблону из issue. Severity и вердикт даны честно, с учётом
правил self-check (`not attacker controlled`, «known peculiarities», приоритет точности).

---

### B1 — Расхождение README и кода: размер резерва на балансе плагина

## Vulnerability Details

**Severity**: Informational
**CVSS Score**: 0.0 (N/A — не уязвимость безопасности, расхождение документации)
**Vulnerability Type**: CWE-1059 (Insufficient/Incorrect Documentation)
**Affected Contract**: `func/simple-subscription-plugin.fc`; `README.md`
**Affected Function**: `forward_funds`, константа `max_reserved_funds`
**Affected Lines**: `simple-subscription-plugin.fc:12,67`; `README.md:25`

## Description
README утверждает: *«Fees are subtracted from transferred amount (payee pays for fees)
including **1 Toncoin which stays on plugin balance** until plugin destruction.»* Фактически
плагин резервирует `max_reserved_funds() = 67108864` нанотон ≈ **0.067 TON**, а не 1 TON:

```func
int max_reserved_funds() asm "67108864 PUSHINT"; ;; 0.0671 TON   // :12
...
raw_reserve(max_reserved_funds(), 2);                            // :67
```

## Root Cause
Текст README не синхронизирован со значением константы.

## Impact
- Финансовый: нет (средства корректно уходят легитимному `beneficiary`).
- Операционный: вводящая в заблуждение документация; интегратор может ошибочно
  рассчитывать на остаток в 1 TON для покрытия storage-fee, тогда как остаётся ~0.067 TON.

## Proof of Concept (PoC)

### Attack Scenario
Атаки нет. Демонстрируется фактический остаток после пересылки средств.

### PoC Code
`audit/tests/02-deploy-sweep.spec.ts` — после перевода средств на плагин баланс плагина
оказывается `< 0.1 TON` (а не ~1 TON): `expect(pluginBal).toBeLessThan(toNano('0.1'))`.

### Expected Behavior
Документация соответствует коду.

### Actual Behavior
README обещает 1 TON, код резервирует ~0.067 TON.

## Remediation
Привести README к коду (≈0.067 TON) **или** при намерении оставлять 1 TON изменить
константу: `int max_reserved_funds() asm "1000000000 PUSHINT"; ;; 1 TON`.

## References
- CWE-1059: https://cwe.mitre.org/data/definitions/1059.html

## Self-Check Validation
- [x] Это не уязвимость безопасности, а расхождение документации
- [x] PoC выполнен в TON Sandbox (не mainnet/testnet)
- [x] Нет ложного срабатывания: классифицировано как Informational
- **Вердикт self-check:** out-of-scope (документация, не security impact).

---

### B2 — Отсутствие валидации `period > 0` (деление на ноль)

## Vulnerability Details

**Severity**: Low (robustness / hardening)
**CVSS Score**: N/A для bounty (класс `not attacker controlled`)
**Vulnerability Type**: CWE-369 (Divide By Zero)
**Affected Contract**: `func/simple-subscription-plugin.fc`
**Affected Function**: `recv_external`, `recv_internal`
**Affected Lines**: `:139`–`140`, `:160`–`161`

## Description
`period` используется делителем без проверки на ноль:

```func
int last_timeslot = (last_payment_time - start_time) / period;  // :160
int cur_timeslot  = (now() - start_time) / period;              // :161
```

При `period == 0` исполнение завершается исключением деления на ноль, и контракт
становится неработоспособным (как `recv_external`, так и ветка оплаты в `recv_internal`).

## Root Cause
В коде контракта отсутствует проверка `period`. Значение задаётся при инициализации
(код `init_state` в репозитории отсутствует; коммиты показывают, что init задаёт
`start_time`). То есть это **операторская конфигурация**, а не вход атакующего.

## Impact
- Финансовый: нет.
- Операционный: при ошибочном `period == 0` подписка «кирпичится». Самостоятельный DoS
  владельца, не вызываемый третьей стороной.

## Proof of Concept (PoC)
`audit/tests/04-timeslot-arith.spec.ts` использует функцию `mk({period})`, позволяющую
задать `period`; при `period = 0` `sendExternalRequest()` падает (деление на ноль).

## Remediation
Гарантировать `period > 0` в `init_state`/конструкторе и/или добавить в `recv_external`:
`throw_unless(<код>, period > 0);` Однако, поскольку `period` не контролируется атакующим,
это **упрочнение**, а не исправление уязвимости.

## References
- CWE-369: https://cwe.mitre.org/data/definitions/369.html
- self-check: класс `not attacker controlled` (operator-controlled configuration).

## Self-Check Validation
- [x] PoC в TON Sandbox
- [x] Триггер — операторская конфигурация, не атакующий
- **Вердикт self-check:** REJECTED (not attacker controlled).

---

### B3 — Ранняя активация при `start_time` в будущем и `last_payment_time = 0`

## Vulnerability Details

**Severity**: Low (init-contingent)
**CVSS Score**: низкий; зависит от кода инициализации (в репозитории отсутствует)
**Vulnerability Type**: CWE-191 (Integer Underflow) → floor-деление отрицательного числителя
**Affected Contract**: `func/simple-subscription-plugin.fc`
**Affected Function**: `recv_external`
**Affected Lines**: `:160`–`162`

## Description
`last_timeslot` вычисляется как floor-деление возможно отрицательного числителя:

```func
int last_timeslot = (last_payment_time - start_time) / period;            // :160
int cur_timeslot  = (now() - start_time) / period;                        // :161
throw_unless(30, (cur_timeslot > last_timeslot) & (last_request_time + timeout < now()));
```

Если `last_payment_time = 0`, а `start_time` — в будущем, числитель `last_timeslot`
равен `-start_time` (минимум). Поскольку `now() > 0`, числитель `cur_timeslot`
(`now() - start_time`) строго больше, поэтому `cur_timeslot >= last_timeslot`, и проверка
`throw_unless(30, ...)` проходит — подписка списывает оплату **до** наступления `start_time`.

## Root Cause
`last_payment_time`, оставленный равным 0 при инициализации, в сочетании с будущим
`start_time` даёт floor-деление отрицательного числа, из-за чего временное окно «открыто»
раньше времени. Поведение зависит от того, как init задаёт `last_payment_time` (код init
в репозитории отсутствует).

## Impact
- Финансовый: оплата уходит **легитимному** `beneficiary`; кражи нет. Воздействие —
  лишь нарушение тайминга (списание раньше `start_time`).
- Атакующий не извлекает выгоды (получатель фиксирован).

## Proof of Concept (PoC)

### Attack Scenario
`now() < start_time`, `last_payment_time = 0` → poke проходит и инициирует платёж.

### PoC Code
`audit/tests/04-timeslot-arith.spec.ts`:
- **FINDING:** будущий `start_time` + `last_payment_time = 0` → платёж до `start_time`
  (`expect(d.lastRequestTime).toBe(START + 5)`, `expect(benAfter).toBeGreaterThan(benBefore)`).
- **CONTROL:** при `last_payment_time = start_time` poke корректно отвергается (exit 30) —
  показывает, что корректная инициализация устраняет проблему.

### Expected Behavior
До `start_time` списаний быть не должно.

### Actual Behavior
При `last_payment_time = 0` списание происходит раньше `start_time`.

## Remediation
Инициализировать `last_payment_time := start_time` (тогда `last_timeslot` стартует
корректно — подтверждено CONTROL-тестом), либо явно проверять `throw_unless(<код>,
now() >= start_time);` в `recv_external`.

## References
- CWE-191: https://cwe.mitre.org/data/definitions/191.html

## Self-Check Validation
- [x] PoC в TON Sandbox
- [x] Зависит от init (код init вне репозитория); кражи нет; атакующий не получает выгоды
- **Вердикт self-check:** REJECTED / out-of-scope (init-contingent, no security impact).

---

### B4 — `failed_attempts` считается по запросам, а не по периодам

## Vulnerability Details

**Severity**: Low
**CVSS Score**: низкий (импакт минимален, триггер требует неплатящего кошелька)
**Vulnerability Type**: CWE-840 (Business Logic Errors)
**Affected Contract**: `func/simple-subscription-plugin.fc`
**Affected Function**: `recv_external`
**Affected Lines**: `:162`–`170`

## Description
`recv_external` разрешён всем (permissionless poke). За каждый poke `failed_attempts`
увеличивается на 1 (`:168`) и сбрасывается в 0 только при успешной оплате (`:146`). Между
poke'ами единственное ограничение — `last_request_time + timeout < now()` (`:162`).
Внутри одного периода (`cur_timeslot > last_timeslot` остаётся истинным, пока кошелёк не
заплатил) можно сделать несколько poke'ов:

```func
throw_unless(30, (cur_timeslot > last_timeslot) & (last_request_time + timeout < now()));
accept_message();
if (failed_attempts >= max_failed_attempts()) { self_destruct(...); }   // max = 2
else { request_payment(...); failed_attempts += 1; }
```

При `max_failed_attempts() == 2` после 2 poke'ов без оплаты третий вызывает `self_destruct`.

## Root Cause
Счётчик отражает число **запросов**, а не число **пропущенных периодов**. Имя переменной
(`failed_attempts`) предполагает учёт неудачных периодов, но реализация считает poke'и.

## Impact (почему Low, а не выше)
- `self_destruct` срабатывает **только если кошелёк не платит** (2 неответа подряд).
- При здоровой подписке первый же платёж в периоде продвигает `last_payment_time`, и
  условие `cur_timeslot > last_timeslot` становится ложным — дальнейшие poke'и в этом
  периоде отвергаются (exit 30). То есть **здоровую подписку нельзя «доуничтожить»**:
  чтобы успеть сделать 2 poke'а до ответа кошелька, нужен крайне малый `timeout` (операторская
  конфигурация) **и** медленный/неплатящий кошелёк.
- `self_destruct` пересылает остаток **легитимному** `beneficiary` и завершает уже
  сбоящую подписку. Кражи нет; выгоды атакующему нет.

## Proof of Concept (PoC)

### PoC Code
`audit/tests/01-audit-poc.spec.ts`:
- **FINDING (Low):** против неотвечающего кошелька 2 poke'а в одном периоде приводят к
  `self_destruct`.
- **MITIGATION:** если кошелёк платит, ответ сбрасывает `failed_attempts`, и преждевременного
  `self_destruct` не происходит.

## Remediation
Считать неудачи по периодам, а не по запросам, например:
```func
;; было: безусловный инкремент за каждый poke
failed_attempts += 1;

;; стало: инкремент только при смене периода относительно последней попытки
if (cur_timeslot > last_attempt_timeslot) { failed_attempts += 1; last_attempt_timeslot = cur_timeslot; }
```
(требует добавления поля в хранилище). Либо опираться на гарантированно достаточный
`timeout >= period`.

## References
- CWE-840: https://cwe.mitre.org/data/definitions/840.html

## Self-Check Validation
- [x] PoC в TON Sandbox
- [x] Импакт минимален; здоровая (платящая) подписка не страдает; кражи нет
- **Вердикт self-check:** out-of-scope / минимальный импакт (плюс §10 — плагин вне области).

---

### B5 — `recv_internal` плагина не проверяет флаг bounced (`flags & 1`)

## Vulnerability Details

**Severity**: Informational (defense-in-depth)
**CVSS Score**: 0.0 (на текущем коде воздействия нет)
**Vulnerability Type**: CWE-940 (Improper Verification of Source of a Communication Channel) — частично; защитная мера
**Affected Contract**: `func/simple-subscription-plugin.fc`
**Affected Function**: `recv_internal`
**Affected Lines**: `:118`–`136`

## Description
`recv_internal` загружает `flags`, но **не** проверяет бит bounced, в отличие от кошелька
(`wallet-v4-code.fc:11` — `if (flags & 1) { return (); }`):

```func
var flags = cs~load_uint(4);    // :119  бит bounced не проверяется далее
slice s_addr = cs~load_msg_addr();
```

## Root Cause
Отсутствует ранний `if (flags & 1) return ();`.

## Impact
**Сейчас воздействия нет.** Единственное bounceable-сообщение, отправляемое плагином, —
`request_payment` (`0x18`). При его отскоке тело начинается с `op = 0xffffffff`, который не
совпадает ни с `(payment_request | 0x80000000)` (`0xf06c7567`), ни с `destruct`
(`0x64737472`) — обе ветки пропускаются, обработчик завершается вхолостую. Сообщения
`forward_funds`/`self_destruct` к получателю — non-bounceable (`0x10`), поэтому не отскакивают.

## Proof of Concept (PoC)
`audit/tests/01-audit-poc.spec.ts` (bounce inert): отскок `request_payment` к плагину не
приводит к движению средств и не меняет состояние.

## Remediation
Добавить в начало `recv_internal` защиту в стиле кошелька:
```func
var flags = cs~load_uint(4);
if (flags & 1) { return (); }   ;; игнорировать bounced
```
Это defense-in-depth: исключит риск при будущих изменениях, делающих какое-либо
исходящее сообщение плагина одновременно bounceable и с «значимым» op.

## References
- CWE-940: https://cwe.mitre.org/data/definitions/940.html

## Self-Check Validation
- [x] PoC в TON Sandbox: отскок инертен
- [x] Текущего воздействия нет → Informational
- **Вердикт self-check:** не уязвимость (defense-in-depth).

---

## 8. Поведение по дизайну (НЕ уязвимости)

Явно фиксирую поведения, которые легко принять за уязвимости, но которые штатны. Это
прямое исполнение требования issue «No false positives» и принципа self-check «prefer false
negatives over false positives».

| Поведение | Почему это НЕ уязвимость | Подтверждение |
| --- | --- | --- |
| **Permissionless poke** (`recv_external` плагина без подписи) | По дизайну: *«anyone can ask to send a subscription payment»* (`:3`). Poke лишь инициирует **запрос**; фактический платёж гейтится регистрацией плагина в кошельке и таймингом. | `03-double-and-misc` |
| **Stray-средства → beneficiary** (перевод от не-wallet/не-beneficiary или с коротким телом пересылается получателю) | Средства уходят **легитимному** `beneficiary`, а не атакующему. Отправитель лишь теряет собственные средства. Плагин — транзитный к получателю. | `02-deploy-sweep` (BY-DESIGN) |
| **Доверенный плагин может «осушить» кошелёк** (op `0x706c7567` тянет до `balance - msg_value`) | Это **суть** плагин-системы: владелец сознательно устанавливает плагин и делегирует ему право запроса средств. Незарегистрированный отправитель заблокирован (W7). | `99-audit-probe` PROBE6 |
| **Кошелёк платит за газ внешнего сообщения** после `accept_message()` | Стандартное поведение кошелька; `accept_message` вызывается **после** проверки подписи (`:82`–`83`). | `99-audit-probe` PROBE2/3 |
| **Сбойная операция «сжигает» seqno** (commit до исполнения op) | Анти-griefing: не даёт повторно проигрывать сбойную внешнюю операцию. Это известная и корректная семантика Wallet V4. | `99-audit-probe` PROBE5 |
| **Двойной запрос в одном периоде** (второй ответ отскакивает) | Защита от двойной оплаты: `throw_if(49, ...)`; средства возвращаются кошельку. | `03-double-and-misc` |

---

## 9. Соответствие чек-листу векторов атак из issue

| Раздел issue | Результат |
| --- | --- |
| **1. Message Handling** | Валидация входа, `op`, аутентификация отправителя, replay (`seqno`/`valid_until`), bounced — проверены. Кошелёк отбрасывает bounced (`:11`) и короткие сообщения (`:15`). По плагину — B5 (defense-in-depth). |
| **2. Signature Verification** | Подпись проверяется для всех привилегированных операций (`:82`); malleability отсутствует (PROBE7); публичный ключ хранится/используется корректно. Пропусков проверки не найдено. |
| **3. State Management** | Инициализация состояния (см. B3 — init-зависимость); гонок в обновлении нет (TON — однопоточная модель сообщений); консистентность после операций подтверждена; утечек состояния нет. |
| **4. Fund Management** | Контроль баланса до перевода (`:41`, W8); overflow в суммах не найден; TON vs Jetton — плагин работает только с TON и extra-currency dict (корректно, `03-double-and-misc`); dust-атак нет (stray → beneficiary). |
| **5. TVM-Specific** | Газ: `accept_message` после проверок; примитивы TVM использованы корректно; обработка cell/slice корректна (`load_bits(512)`, `slice_hash`); исключения обрабатываются (`throw_*`). Деление на ноль — B2 (operator-controlled). |
| **6. Wallet-Specific** | Инкремент `seqno` (`:85`,`:157`); `valid_until` (`:76`); мультиподпись — н/п (single-sig); обработка `subwallet_id` (`:81`) — корректны. |

Разделы 7–10 (multisig, token, DNS, nominator) — вне состава данного репозитория.

---

## 10. Замечание по области Bug Bounty

Официальные документы bounty дают двойственный сигнал:

- README: *«Wallet V4 and subscription smart contracts»* — **in-scope**; одновременно
  *«Wallet plugins (for all versions) are provided as examples and are out of the scope»*.
- self-check: *«Wallet V4 and subscription contracts (`ton-blockchain/wallet-contract`)»* — in-scope.

`simple-subscription-plugin.fc` технически является «wallet plugin», поэтому все находки
B1–B5 (все по плагину) с высокой вероятностью **вне области** bounty, даже будь они выше по
severity. **По кошельку Wallet V4 (однозначно in-scope) уязвимостей не найдено.** Находки по
плагину приведены для полноты аудита по запросу issue и как рекомендации по качеству кода.

---

## 11. Итоговый вердикт

| Объект | Вердикт |
| --- | --- |
| **Wallet V4 R2** (in-scope) | **Уязвимостей не обнаружено.** Подпись, replay-защита, `seqno`, `subwallet_id`, аутентификация плагинов, контроль баланса — корректны (§6). |
| **Subscription plugin** (вероятно out-of-scope) | Critical/High/Medium не обнаружено. 5 наблюдений Low/Info (B1–B5), ни одно не квалифицируется как принимаемая находка bounty (документация / operator-controlled / defense-in-depth). |

Применяя фреймворк self-check, **ни одно** наблюдение не получает статус `correct` +
вердикт `PASS` как заявка на bounty. Это согласуется с тем, что аудируемый код —
канонический, прошедший продакшен-проверку Wallet V4 R2 и эталонный плагин.

---

## Приложение A. Карта PoC-тестов

| Файл | Что доказывает |
| --- | --- |
| `tests/00-sanity.spec.ts` | Базовая корректность: геттеры; валидная подпись двигает `seqno`; неверный ключ отвергнут. |
| `tests/01-audit-poc.spec.ts` | Свойства плагина: forward к beneficiary (by-design); гейт оплаты по `op`+источнику; защита от двойной оплаты (exit 49); B4 (failed_attempts) + MITIGATION; B5 (bounce inert); B2 (period==0). |
| `tests/02-deploy-sweep.spec.ts` | By-design: stray-переводы пересылаются beneficiary; PoC к B1 (остаток ~0.067 TON, не 1 TON). |
| `tests/03-double-and-misc.spec.ts` | Двойной запрос (1 платит, 2-й отскакивает); happy path; оплата в следующем периоде; раскладка extra-currency dict. |
| `tests/04-timeslot-arith.spec.ts` | B3 (ранняя активация при future `start_time`) + CONTROL (корректный init устраняет) + CHECK (штатный первый платёж). |
| `tests/98-lifecycle.spec.ts` | LC1 (деплой+установка op1); LC2 (только сам плагин удаляет себя; спуфинг невозможен). |
| `tests/99-audit-probe.spec.ts` | PROBE1–7 по кошельку: auth, порядок проверок, неизвестный op, replay, commit-семантика, контроль баланса, отсутствие malleability. |

**Статус прогона:** сборка — успех; **30 тестов / 7 наборов — все зелёные**.
