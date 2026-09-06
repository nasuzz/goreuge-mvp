#!/usr/bin/env bash
# scripts/deploy.sh — docs/release.md 런북(1~4장)의 수동 절차를 한 명령으로 묶은 것.
# DRI: C. 이슈 #43.
#
# 사용법은 --help 참고. 이 스크립트는 vercel/node/npm CLI가 PATH에 있어야 한다.
set -euo pipefail

usage() {
  cat <<'USAGE'
사용법:
  scripts/deploy.sh --check
      로컬 release check만 실행한다: 루트 verify, web build/typecheck/lint, 비밀값·개인정보 스캔.

  scripts/deploy.sh --prod --smoke
      저장소 루트에서 Vercel production 배포 후(Root Directory=web은 Vercel 프로젝트
      설정이 처리한다) 배포 URL에 API smoke를 실행한다.

  scripts/deploy.sh --api-base https://<배포url> --smoke
      이미 배포된 URL만 검증한다 (배포는 하지 않는다).

옵션:
  --check           로컬 검증(verify·web build/typecheck/lint·비밀값 스캔)만 실행
  --prod            저장소 루트에서 `vercel --prod` 배포 (Root Directory는 Vercel 프로젝트 설정을 따름)
  --smoke           test/api-smoke.mjs 실행 (기본은 --skip-mutating)
  --mutating-smoke  smoke를 전체 모드로 실행 (데모 데이터를 실제로 바꾼다. docs/release.md 2-2 재시드 필요)
  --api-base <url>  smoke 대상 URL을 직접 지정한다 (--prod 없이도 사용 가능, --prod와는 같이 못 씀)
  -h, --help        이 도움말 출력

옵션 없이 실행하면 이 도움말을 출력하고 종료한다(코드 1).
USAGE
}

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

DO_CHECK=0
DO_PROD=0
DO_SMOKE=0
MUTATING_SMOKE=0
API_BASE=""

while [ $# -gt 0 ]; do
  case "$1" in
    --check) DO_CHECK=1; shift ;;
    --prod) DO_PROD=1; shift ;;
    --smoke) DO_SMOKE=1; shift ;;
    --mutating-smoke) MUTATING_SMOKE=1; shift ;;
    --api-base)
      if [ $# -lt 2 ] || [ -z "$2" ]; then
        echo "오류: --api-base 뒤에 URL이 필요합니다" >&2
        exit 1
      fi
      API_BASE="$2"
      shift 2
      ;;
    -h|--help) usage; exit 0 ;;
    *) echo "알 수 없는 옵션: $1" >&2; usage; exit 1 ;;
  esac
done

if [ "$DO_CHECK" -eq 0 ] && [ "$DO_PROD" -eq 0 ] && [ "$DO_SMOKE" -eq 0 ]; then
  usage
  exit 1
fi

if [ "$DO_PROD" -eq 1 ] && [ -n "$API_BASE" ]; then
  echo "오류: --prod와 --api-base는 같이 쓸 수 없습니다 (배포 대상이 모호합니다)" >&2
  exit 1
fi

if [ "$DO_SMOKE" -eq 1 ] && [ "$DO_PROD" -eq 0 ] && [ -z "$API_BASE" ]; then
  echo "오류: --smoke는 --prod 또는 --api-base <url>과 함께 써야 합니다" >&2
  exit 1
fi

# ── 1. 로컬 release check (docs/release.md 4장) ────────────────────────

run_check() {
  echo "== [1/3] 루트 verify =="
  npm run verify

  echo "== [2/3] web build / typecheck / lint =="
  (
    cd web
    # 빌드를 먼저 돌린다 — Next.js가 라우트별 앰비언트 타입(.next/types의
    # LayoutProps/PageProps 등)을 빌드 시점에 생성하므로, 빌드 전에 lint나
    # tsc를 돌리면 이 타입들을 못 찾아 가짜 타입 에러가 난다(실제로 재현 확인).
    npm run build
    npx tsc --noEmit
    npm run lint
  )

  echo "== [3/3] 비밀값·개인정보 스캔 (현재 작업트리 기준 — --prod가 실제로 업로드하는 대상과 동일) =="
  git fetch origin --quiet

  # [이슈 #43·PR #44 리뷰 반영, lyoonji]
  #  - 원래 origin/main을 스캔했는데, `vercel --prod`는 로컬 작업트리를 그대로
  #    올린다(git push로 트리거되는 배포가 아니다). 그래서 origin/main에 없는
  #    아직 커밋 전 변경이나 로컬 전용 브랜치의 키가 있어도 origin/main 스캔은
  #    깨끗하다고 통과시키고 그 코드는 그대로 배포됐다. 스캔 대상을 실제
  #    업로드 대상(현재 작업트리)으로 맞췄다.
  #  - docs/release.md 전체를 스캔에서 빼면(예전 방식) 그 파일에 진짜 키가
  #    들어와도 못 잡는 사각지대가 생긴다. 대신 그 파일이 이 정규식 자체를
  #    예시로 문서화해 둔 "그 한 줄"만 결과에서 걸러낸다.
  #  - 이 스크립트 자신(scripts/deploy.sh)도 같은 정규식 문자열을 코드로
  #    담고 있어서(바로 이 줄) origin/main 제외를 걷어내자 새로 자기 자신에게
  #    걸리는 게 실제로 재현됐다. docs/release.md와 달리 이건 "예시 한 줄"이
  #    아니라 패턴 정의 자체라 줄 단위로 거르기 어려워, 파일 전체를 뺀다 —
  #    탐지 로직을 담은 파일이니 진짜 비밀값이 여기 섞일 일은 없다.
  local secret_hits
  secret_hits="$(git grep -nIE \
    "(eyJ[A-Za-z0-9_-]{30,})|(sk-[A-Za-z0-9]{20,})|(sb_secret_[A-Za-z0-9_-]{10,})|(service_role)|(-----BEGIN [A-Z ]*PRIVATE KEY)" \
    -- . ':!*.lock' ':!package-lock.json' ':!scripts/deploy.sh' \
    | grep -v 'docs/release\.md:.*git grep -nIE' || true)"
  if [ -n "$secret_hits" ]; then
    echo "$secret_hits"
    echo "오류: 비밀키로 의심되는 패턴이 발견됐습니다. 위 목록을 확인하세요." >&2
    exit 1
  fi

  local env_files
  env_files="$(git ls-files | grep -E '\.env' | grep -v '\.env\.example$' || true)"
  if [ -n "$env_files" ]; then
    echo "$env_files"
    echo "오류: .env 계열 파일이 커밋돼 있습니다 (.env.example 제외)." >&2
    exit 1
  fi

  local env_history
  env_history="$(git log --all --diff-filter=A --name-only --format='' | sort -u | grep -E '\.env($|\.local|\.production)' || true)"
  if [ -n "$env_history" ]; then
    echo "$env_history"
    echo "오류: 히스토리에 .env.local/.env.production이 추가된 적이 있습니다." >&2
    exit 1
  fi

  local pii_hits
  pii_hits="$(git grep -nIE \
    "01[0-9]-[0-9]{3,4}-[0-9]{4}|[A-Za-z0-9._%+-]+@(gmail|naver|daum|kakao|hanmail)\.[a-z]{2,3}" \
    -- . ':!*.lock' ':!package-lock.json' || true)"
  if [ -n "$pii_hits" ]; then
    echo "$pii_hits"
    echo "오류: 개인 전화번호·이메일로 의심되는 패턴이 발견됐습니다." >&2
    exit 1
  fi

  echo "release check 통과."
}

# ── 2. Vercel production 배포 (docs/release.md 1장) ────────────────────

run_prod() {
  echo "== Vercel production 배포 (저장소 루트에서 실행) =="
  command -v vercel >/dev/null 2>&1 || {
    echo "오류: vercel CLI가 필요합니다 (예: npx vercel, 또는 npm i -g vercel)" >&2
    exit 1
  }

  # [PR #44 리뷰 반영, lyoonji — P0] `vercel` CLI는 현재 디렉터리를 그대로
  # 업로드한다. web/에서 실행하면 web/만 올라가는데, 이 앱은 tsconfig의
  # `@/shared/*`·`@/engine/*`·`@/ai/*` 경로 별칭으로 저장소 루트의 ../src를
  # 40곳 넘게 참조한다(web/next.config.ts의 turbopack.root 설정과 같은
  # 이유). web/에서 배포하면 Root Directory 미설정 시 ../src가 안 올라가
  # 빌드가 깨지고, 설정돼 있으면 web/web을 찾아 다른 방식으로 깨진다.
  # 반드시 저장소 루트에서 실행해야 Vercel 프로젝트의 "Root Directory: web"
  # 설정과 맞물린다.
  echo "-- 필수 환경변수 존재 확인 (DEMO_USER_ID) --"
  if ! (vercel env ls production 2>/dev/null | grep -q "DEMO_USER_ID"); then
    echo "경고: Vercel production 환경변수 목록에서 DEMO_USER_ID를 확인하지 못했습니다." >&2
    echo "  미설정 시 데모 화면이 빈 계정으로 뜰 수 있습니다 (docs/release.md 1-2절 참고)." >&2
    if [ -t 0 ]; then
      read -r -p "그래도 계속 배포할까요? [y/N] " reply
      case "$reply" in
        y|Y) ;;
        *) echo "배포를 중단합니다."; exit 1 ;;
      esac
    else
      echo "  비대화형 실행이라 확인 없이 계속 진행합니다." >&2
    fi
  fi

  local deploy_output
  deploy_output="$(vercel --prod --yes)"
  echo "$deploy_output"
  # vercel CLI는 성공 시 마지막 줄에 배포 URL만 출력한다.
  API_BASE="$(echo "$deploy_output" | tail -1)"
  echo "배포 완료: $API_BASE"
}

# ── 3. 배포 후 API smoke (docs/release.md 2-1절) ───────────────────────

run_smoke() {
  echo "== API smoke ($API_BASE) =="
  if [ "$MUTATING_SMOKE" -eq 1 ]; then
    echo "[주의] --mutating-smoke: 데모 계약을 실제로 risk로 바꾸고 임시 유저를 남깁니다."
    echo "       끝난 뒤 docs/release.md 2-2절대로 재시드하세요."
    API_BASE="$API_BASE" node test/api-smoke.mjs
  else
    API_BASE="$API_BASE" node test/api-smoke.mjs --skip-mutating
  fi
}

# ── 실행 ────────────────────────────────────────────────────────────

if [ "$DO_CHECK" -eq 1 ]; then
  run_check
fi

if [ "$DO_PROD" -eq 1 ]; then
  run_prod
fi

if [ "$DO_SMOKE" -eq 1 ]; then
  run_smoke
fi

echo "완료."
