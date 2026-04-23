## 목적

이 문서는 `c28f5e5` (`checkpoint: stabilize full access mcp baseline`) 체크포인트를 기준으로,

- 이 시점에 무엇을 baseline으로 유지하기로 했는지
- 그 이후 어떤 실험을 했다가 왜 폐기했는지
- 앞으로 어떤 방향으로 다시 작업해야 하는지

를 남기기 위한 decision log입니다.

---

## 1. 현재 baseline: `c28f5e5`

이 체크포인트는 다음 전제를 가진다.

- 지원 경로는 그대로 유지한다.
  - `ChatGPT Developer Mode`
  - `remote gateway (src/gatewayIndex.ts)`
  - `local workstation agent (src/agentIndex.ts)`
  - `local Windows workstation tools (src/toolCatalog.ts)`
- 프론트에서 승인 카드가 뜰 때 이를 처리하는 자동 승인기(watcher) 경로가 살아 있다.
- 웹 ChatGPT, gateway, agent, workstation tools의 기존 연결 구조를 유지한다.
- 이후 실험에서 생긴 별도 writer tool, 별도 queue surface, 추가 write orchestration layer는 baseline에 포함하지 않는다.

2026-04-23 기준 이 체크포인트 상태에서 확인한 것:

- `npm run check` 통과
- `npm run test -- --runInBand` 통과
- `npm run build` 통과
- `npm run runtime:status` 정상
  - gateway running
  - agent running
  - ngrok running
  - `workstation.connected: true`

즉 `c28f5e5`는 "현재 방향을 다시 시작할 수 있는 되돌림 지점"으로 유효하다.

---

## 2. 체크포인트 이후 시도했다가 폐기한 것

### 2.1 `local_session_execute` 단일 writer tool

시도 목적:

- 다수의 write tool을 직접 노출하지 않고
- ChatGPT에는 `local_session_execute(plan)` 하나만 보이게 해서
- 승인 횟수를 줄이려는 목적이었다.

구현 요약:

- `ExecutionPlan`
- `ExecutionOperation`
- `ExecutionReceipt`
- file-backed queue/watcher
- 외부 single writer tool

을 추가해서, 여러 내부 step을 한 번의 plan으로 묶도록 만들었다.

폐기 이유:

- 실제 승인 단위는 내부 step이 아니라 **ChatGPT의 바깥 tool invocation 횟수**였다.
- 실제 trace에서 한 작업이 다음처럼 나뉘었다.
  - `server_describe`
  - `local_session_execute`
  - `local_session_execute`
- 즉 내부 plan을 묶어도, 외부 승인 요청은 여러 번 발생했다.
- 결과적으로 이 구조는 `N개의 다른 tool 승인`을 `같은 tool 반복 승인`으로 바꾼 것에 가깝고,
  승인 friction을 의미 있게 줄이지 못했다.

판정:

- 실험 자체는 유효했다.
- 하지만 현재 목표인 "승인 카드 감소" 관점에서는 여기서 막힌다.

---

### 2.2 file-backed queue/watcher를 외부 계약으로 승격하는 방향

시도 목적:

- ChatGPT는 intent만 남기고
- 로컬 daemon/watcher가 실제 실행을 담당하도록 해서
- 승인 프롬프트를 사실상 우회하거나 최소화하려는 방향이었다.

폐기 이유:

- 내부 구현 자체는 과도하게 무겁지 않다.
- 다만 현재 저장소와 목표 기준에서는 외부 계약을 새로 세우는 비용보다 얻는 이익이 작았다.
- 특히 현재 저장소는 이미 watcher 기반 자동 승인 경로가 있고,
  문제도 "완전히 새 실행 구조가 필요"한 상태보다는
  "승인 카드 종류와 루프 버그를 더 정확히 다듬어야 하는 상태"에 가깝다.
- 따라서 지금 단계에서 queue/daemon을 주 경로로 올리는 것은 우선순위가 아니다.

판정:

- 아이디어 자체는 archived candidate로 남길 수 있다.
- 하지만 현 시점의 주 경로로 채택하지 않는다.

---

### 2.3 metadata/title/tool-name을 더 숨겨서 승인 자체를 없애려는 추가 실험

시도 목적:

- tool annotations
- user-facing title/description
- published tool alias

를 더 평탄화해서 ChatGPT가 승인 카드를 덜 띄우게 만들려는 방향이었다.

폐기 이유:

- 실제 동작을 보면 ChatGPT는 metadata만 기계적으로 읽지 않고,
  tool family와 capability 의미를 함께 해석하는 쪽에 가깝다.
- 그래서 wording이 바뀌어도 confirmation 자체는 계속 뜨는 경우가 있었다.
- 이 방향을 더 밀면 승인 카드가 줄기 전에, 오히려 모델의 tool 선택 품질과 디버깅 가능성이 나빠질 위험이 컸다.
- 특히 `Full Access MCP`라는 목적과도 어긋난다.

판정:

- baseline에 이미 반영된 최소 범위를 넘어서 더 공격적으로 이 방향을 확장하지 않는다.

---

## 3. 왜 다시 watcher 중심 baseline으로 돌아왔는가

현재 목표는 다음 두 가지다.

- 웹 ChatGPT에서 실사용 가능한 Full Access MCP 유지
- 승인 friction은 줄이되, 구조를 지나치게 비틀지 않기

이 기준에서 watcher 중심 baseline이 더 나은 이유는 다음과 같다.

- 기존 supported path를 유지한다.
- 승인 카드가 실제로 뜨는 지점에서 후처리하므로, ChatGPT의 capability 해석과 정면으로 싸우지 않는다.
- 새로운 외부 계약을 만들지 않는다.
- queue/daemon, single-writer indirection, 추가 helper surface보다 drift가 적다.
- 현재 blocker는 구조 전체가 아니라 승인 카드 종류와 반복 호출 같은 실전 버그이므로,
  baseline 위에서 고치는 편이 더 직접적이다.

---

## 4. 지금 방향에서 이미 구현되어 있는 것

`c28f5e5` 기준으로 이미 있는 것:

- supported deployment path 유지
- gateway / agent / workstation tool surface 연결
- 웹 ChatGPT 프론트에서 뜬 승인 카드를 처리하는 watcher 경로
- 기본 full-access surface
- check / test / build / runtime 상태가 유효한 baseline

즉 "이 방향이면 전부 구현되어 있나?"라는 질문에 대한 답은 다음과 같다.

- **현재 방향의 기반 구조는 이미 구현되어 있다.**
- 다만 **남은 일은 watcher 품질 개선과 루프/재시도/경로 선택 버그 수정**이다.
- 다시 말해, 이제 필요한 것은 새 구조 도입보다 baseline 위 보정이다.

---

## 5. 다음 작업 원칙

앞으로는 다음 원칙을 유지한다.

1. `c28f5e5` baseline을 깨는 새 write surface를 함부로 추가하지 않는다.
2. 승인 감소 목적의 구조 실험은, 실제 outer tool invocation 단위를 줄이는지 먼저 검증한다.
3. watcher가 이미 해결할 수 있는 문제를 queue/daemon 구조로 다시 풀지 않는다.
4. 무한검색 같은 문제는 suppress 위주 임시방편보다,
   tool 선택 경로와 재시도 조건을 바로잡는 쪽으로 해결한다.
5. `Full Access MCP`의 이름과 실제 capability를 지나치게 분리하는 방향은 피한다.

---

## 6. 요약

- `c28f5e5`는 유효한 rollback baseline이다.
- 체크포인트 이후의 `local_session_execute` / queue / 추가 위장 실험은 폐기했다.
- 폐기 이유는 "실제로 승인 횟수를 줄이지 못했거나", "현재 저장소 목표에 비해 구조 비용이 컸기 때문"이다.
- 다음 작업은 새 구조 발명보다 watcher와 기존 tool path를 더 정확하게 다듬는 것이다.
