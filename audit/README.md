# PoC-харнесс аудита безопасности — TON Wallet V4 R2 + subscription plugin

Этот каталог содержит воспроизводимое окружение для аудита безопасности контрактов
`func/wallet-v4-code.fc` и `func/simple-subscription-plugin.fc` по запросу
[issue #1](https://github.com/xlabtg/wallet-contract/issues/1) в рамках
[TON Bug Bounty Program](https://github.com/ton-blockchain/bug-bounty).

Полный отчёт с находками, методологией и вердиктом: **[`REPORT.md`](./REPORT.md)**.

> ⚠️ **Все эксперименты выполняются только в локальном TON Sandbox.** Ни один PoC не
> деплоится и не исполняется в mainnet или testnet (требование issue).

---

## Требования

- Node.js 18+ и npm.
- Доступ в сеть для `npm install` (тянет `@ton/*` и `@ton-community/func-js`).

## Установка и запуск

```bash
cd audit
npm install
npm run build   # компилирует контракты в build/*.cell.base64
npm test        # запускает все PoC-наборы (jest --runInBand)
```

Ожидаемый результат: **сборка успешна, 30 тестов / 7 наборов — зелёные**.

### О компиляции

`compile.ts` читает исходные `.fc` из `../func`, удаляет строку `#pragma version =0.2.0;`
**в памяти** (несовместима с используемым `func` 0.4.x) и компилирует код вместе со
stdlib в base64-ячейку. **Файлы на диске не изменяются** — аудируется ровно тот код, что
лежит в репозитории.

---

## Структура

| Путь | Назначение |
| --- | --- |
| `REPORT.md` | Полный отчёт по аудиту (RU): методология, свойства безопасности, находки B1–B5, by-design, вердикт. |
| `compile.ts` | Компиляция контрактов (func-js) в `build/`. |
| `wrappers/` | TS-обёртки `WalletV4`, `SubscriptionPlugin`, загрузка скомпилированного кода. |
| `tests/` | PoC-наборы Jest (см. ниже). |
| `build/` | Артефакты компиляции (в `.gitignore`). |
| `node_modules/` | Зависимости (в `.gitignore`). |

### Карта тестов

| Файл | Что доказывает |
| --- | --- |
| `tests/00-sanity.spec.ts` | Геттеры; валидная подпись двигает `seqno`; неверный ключ отвергнут (exit 35). |
| `tests/01-audit-poc.spec.ts` | Свойства плагина: forward к beneficiary (by-design); гейт оплаты по `op`+источнику; защита от двойной оплаты (exit 49); B4 + MITIGATION; B5 (bounce инертен); B2 (period==0). |
| `tests/02-deploy-sweep.spec.ts` | By-design: stray-переводы пересылаются beneficiary; PoC к B1 (остаток ~0.067 TON). |
| `tests/03-double-and-misc.spec.ts` | Двойной запрос (1-й платит, 2-й отскакивает); happy path; оплата в следующем периоде; extra-currency dict. |
| `tests/04-timeslot-arith.spec.ts` | B3 (ранняя активация) + CONTROL (корректный init устраняет) + CHECK (штатный первый платёж). |
| `tests/98-lifecycle.spec.ts` | LC1 (деплой+установка op1); LC2 (только сам плагин удаляет себя; спуфинг невозможен). |
| `tests/99-audit-probe.spec.ts` | PROBE1–7 по кошельку: auth, порядок проверок, неизвестный op, replay, commit-семантика, контроль баланса, отсутствие malleability. |

---

## Итог аудита (кратко)

**Уязвимостей Critical / High / Medium не обнаружено.** По кошельку Wallet V4 (однозначно
in-scope) уязвимостей нет. По плагину подписки — 5 наблюдений Low/Informational, ни одно из
которых не квалифицируется как принимаемая находка bounty.

| ID | Severity | Описание | Управляется атакующим? |
| --- | --- | --- | --- |
| B1 | Informational | README обещает «1 Toncoin», код резервирует ~0.067 TON | Нет (документация) |
| B2 | Low (hardening) | `period == 0` не валидируется → деление на ноль | Нет (init владельца) |
| B3 | Low (init-contingent) | `start_time` в будущем + `last_payment_time=0` → ранняя активация | Нет (зависит от init) |
| B4 | Low | `failed_attempts` считается по запросам, а не по периодам | Триггер да, импакт нет |
| B5 | Informational | `recv_internal` не проверяет `flags & 1` (bounced) | Нет (сейчас инертно) |

Подробности, PoC-привязки и рекомендации — в [`REPORT.md`](./REPORT.md).

> **Замечание по области.** Официальный bounty относит *«Wallet plugins (for all versions)»*
> к out-of-scope, отдельно оставляя in-scope *«Wallet V4 and subscription smart contracts»*.
> Плагин подписки технически является «wallet plugin», поэтому находки B1–B5 (все по плагину)
> с высокой вероятностью вне области bounty. См. §10 отчёта.
