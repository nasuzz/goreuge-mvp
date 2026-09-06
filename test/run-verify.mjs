// test/run-verify.mjs — test/의 검증 스크립트를 전부 순서대로 돌린다.
// 이슈 #60.
//
// 왜 이 파일이 있나.
//
// 원래 package.json의 "verify"는 검증 스크립트 이름을 && 로 이어 붙인 한 줄이었다.
// 기능 PR은 거의 예외 없이 검증 스크립트를 하나 추가하므로, 열려 있는 PR이 전부
// **같은 한 줄**을 고치게 된다. 실측(이슈 #60): 열린 PR 5개(#58·#59·#61·#62·#63)의
// 10개 조합 중 10개가 충돌했고, 그중 9개는 원인이 이 한 줄뿐이었다. 각 PR은
// origin/main과는 깨끗한데 서로 부딪히는 구조라, 하나가 머지될 때마다 나머지 넷이
// 빨간불이 됐다.
//
// 그래서 목록을 파일에서 읽는다. 검증 스크립트를 추가하는 일이 "test/에 파일을 하나
// 만드는 것"으로 끝나고, 공유 파일의 공유 라인을 건드리지 않는다. 새 파일 추가는
// git이 충돌시킬 수 없다.
//
// 규칙
//   - test/ 바로 아래의 .ts 파일은 전부 검증 스크립트로 본다. 실패 시 0이 아닌
//     코드로 종료하면 된다(기존 스크립트들이 이미 그렇게 돼 있다).
//   - 검증 스크립트가 아닌 공용 헬퍼는 test/helpers/ 처럼 하위 디렉터리에 둔다.
//     이 러너는 바로 아래 파일만 보므로 하위 디렉터리는 실행되지 않는다.
//   - .mjs는 tsconfig.build.json의 include("test/**/*.ts")에 걸리지 않아 컴파일되지
//     않는다. 러너가 자기 자신을 실행하는 일이 없다(test/api-smoke.mjs와 같은 방식).
//
// 목록의 기준은 dist/test가 아니라 test/의 소스다. tsc는 outDir를 청소하지 않아서,
// 지워진 검증 스크립트의 .js가 dist/test에 그대로 남는다. dist를 기준으로 삼으면
// 그 유령 파일까지 계속 실행된다(실제로 겪었다 — 브랜치를 갈아탄 뒤 다른 브랜치의
// 검증 스크립트가 돌아 실패했다). 소스에 있는 것만 돌리고, 빌드 산출물이 없으면
// 조용히 넘기지 않고 오류로 세운다.

import { readdirSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const SRC_TEST = "test";
const DIST_TEST = join("dist", "test");

// smoke는 나머지가 기대는 기본 계산(잔액 3단계·기준 D-day 등)을 확인하므로 먼저
// 돌린다. 여기가 깨진 채로 다른 검증이 무더기로 실패하면 원인을 찾기 어렵다.
const RUN_FIRST = ["smoke.js"];

const sources = readdirSync(SRC_TEST, { withFileTypes: true })
  .filter((e) => e.isFile() && e.name.endsWith(".ts"))
  .map((e) => e.name.replace(/\.ts$/, ".js"))
  .sort();

if (sources.length === 0) {
  console.error(`[verify] ${SRC_TEST}/에 검증 스크립트(.ts)가 없습니다.`);
  process.exit(1);
}

const missing = sources.filter((name) => !existsSync(join(DIST_TEST, name)));
if (missing.length > 0) {
  console.error(`[verify] 빌드 산출물이 없습니다: ${missing.join(", ")}`);
  console.error("[verify] npm run build를 먼저 실행하세요.");
  process.exit(1);
}

const ordered = [
  ...RUN_FIRST.filter((name) => sources.includes(name)),
  ...sources.filter((name) => !RUN_FIRST.includes(name)),
];

const failed = [];
for (const name of ordered) {
  console.log(`\n───── ${name} ─────`);
  const result = spawnSync(process.execPath, [join(DIST_TEST, name)], { stdio: "inherit" });
  // 시그널로 죽으면 status가 null이라, 0이 아닌지만 보면 실패를 성공으로 읽는다.
  if (result.status !== 0) {
    failed.push(`${name} (${result.signal ? `signal ${result.signal}` : `exit ${result.status}`})`);
  }
}

console.log(`\n═════ verify: ${ordered.length - failed.length}/${ordered.length} 통과 ═════`);
if (failed.length > 0) {
  for (const f of failed) console.error(`❌ ${f}`);
  process.exit(1);
}
console.log("✅ 전부 통과");
