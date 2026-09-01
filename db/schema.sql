-- 고르게 MVP — Supabase(Postgres) 스키마
-- DRI: A(수경).  상태: PR 리뷰 반영본
-- 기획서 9-1 "MVP 테이블 7개" + 확정 결정 D2(settlement_term), D1-a(expected_date_source)
--
-- 적용: Supabase 대시보드 > SQL Editor에 이 파일을 그대로 붙여넣기 (최초 1회)
-- MVP는 인증을 건너뛰므로 RLS 정책이 전체 허용이다. 아래 "RLS" 절 필독.
--
-- ⚠️ 재실행하려면 이 파일이 아니라 반드시 reset.sql을 먼저 실행할 것.
-- 이 파일 자체에는 DROP 구문이 없다. 두 번째 실행 시 "type already exists"가
-- 나는 게 정상이며, 그건 안전장치다 — 실수로 프로덕션 데이터를 날리지 않기 위함.
create type contract_status as enum
  ('waiting','delayed','risk','completed','cancelled');

create type classification_status as enum
  ('ai_candidate','needs_review','user_confirmed','actual_confirmed');

create type income_type as enum
  ('business_personal_service','qualifying_other_income',
   'employment_income','no_withholding','needs_review');

create type settlement_term as enum
  ('ON_COMPLETION','SAME_MONTH_END','NEXT_MONTH_END',
   'NEXT_MONTH_DAY','NET_DAYS','UNKNOWN');

create type expected_date_source as enum ('calculated','manual');
create type status_source        as enum ('system','user');
create type outflow_recurrence   as enum ('monthly','once');
create type savings_kind         as enum ('wish','tax');
create type savings_status       as enum
  ('waiting','active','completed','paused','cancelled');
create type spend_class          as enum
  ('essential','hobby','stress','unclassified');

-- ── 1. users ─────────────────────────────────────────────
create table users (
  id                    uuid primary key default gen_random_uuid(),
  total_balance         bigint not null check (total_balance >= 0),
  monthly_fixed_outflow bigint not null check (monthly_fixed_outflow >= 0),
  safety_buffer         bigint not null default 0 check (safety_buffer >= 0),
  tax_reserve_rate      numeric(4,3) not null default 0.120
                          check (tax_reserve_rate between 0 and 0.5),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

-- ── 2. clients ───────────────────────────────────────────
create table clients (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references users(id) on delete cascade,
  name              text not null,
  completed_count   int  not null default 0 check (completed_count >= 0),
  median_delay_days int,
  p90_delay_days    int,
  created_at        timestamptz not null default now(),
  -- 이력 3건 미만이면 통계값은 null이어야 한다 (기획서 4-4)
  constraint client_stats_consistency check (
    (completed_count >= 3) or (median_delay_days is null and p90_delay_days is null)
  )
);
create index idx_clients_user on clients(user_id);

-- ── 3. contracts ─────────────────────────────────────────
create table contracts (
  id                      uuid primary key default gen_random_uuid(),
  user_id                 uuid not null references users(id) on delete cascade,
  client_id               uuid not null references clients(id) on delete restrict,

  gross_amount            bigint not null check (gross_amount > 0),
  completion_date         date   not null,
  invoice_date            date,

  -- [확정 D2] 예정입금일 재계산을 위해 저장
  settlement_term         settlement_term not null default 'UNKNOWN',
  settlement_day          int check (settlement_day between 1 and 365),

  expected_date           date,
  -- [확정 D1-a] manual이면 엔진이 덮어쓰지 않는다
  expected_date_source    expected_date_source not null default 'calculated',
  actual_date             date,

  income_type             income_type           not null default 'needs_review',
  -- [주의] 기본값을 'ai_candidate'로 두면 아래 chk_no_unconfirmed_save를 위반해
  -- classification_status를 명시하지 않은 INSERT가 전부 실패한다. 반드시 needs_review로 둔다.
  classification_status   classification_status not null default 'needs_review',

  -- 공제율 3종. 절대 혼용하지 않는다 (기획서 9-3)
  reference_rate          numeric(5,4),
  confirmed_expected_rate numeric(5,4),
  actual_rate             numeric(5,4),

  expected_net_amount     bigint,
  actual_net_amount       bigint,

  status            contract_status not null default 'waiting',
  status_source     status_source   not null default 'system',
  status_reason     text,
  status_updated_at timestamptz not null default now(),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- ── 기획서 9-3 무결성 원칙을 DB 레벨에서 강제 ──
  constraint chk_actual_pair check (
    (actual_date is null and actual_net_amount is null)
    or (actual_date is not null and actual_net_amount is not null)
  ),
  constraint chk_no_unconfirmed_save check (
    classification_status <> 'ai_candidate'
  ),
  constraint chk_user_status_reason check (
    status_source = 'system' or status_reason is not null
  ),
  constraint chk_settlement_day check (
    (settlement_term in ('NEXT_MONTH_DAY','NET_DAYS') and settlement_day is not null)
    or (settlement_term not in ('NEXT_MONTH_DAY','NET_DAYS'))
  ),
  constraint chk_net_le_gross check (
    (expected_net_amount is null or expected_net_amount <= gross_amount)
    and (actual_net_amount is null or actual_net_amount <= gross_amount)
  )
);
create index idx_contracts_user     on contracts(user_id);
create index idx_contracts_status   on contracts(user_id, status);
create index idx_contracts_expected on contracts(user_id, expected_date);

-- ── 4. outflows ──────────────────────────────────────────
create table outflows (
  id                   uuid primary key default gen_random_uuid(),
  user_id              uuid not null references users(id) on delete cascade,
  kind                 text not null,
  name                 text not null,
  amount               bigint not null check (amount > 0),
  due_date             date   not null,
  recurrence           outflow_recurrence not null default 'monthly',
  -- true면 monthly_fixed_outflow에 이미 포함 -> 개별 차감 금지 (기획서 9-3)
  included_in_baseline boolean not null default false,
  created_at           timestamptz not null default now()
);
create index idx_outflows_user on outflows(user_id, due_date);

-- ── 5. transactions ──────────────────────────────────────
create table transactions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references users(id) on delete cascade,
  amount      bigint not null,
  occurred_at timestamptz not null,
  category    text,
  spend_class spend_class not null default 'unclassified',
  note        text,
  created_at  timestamptz not null default now()
);
create index idx_transactions_user on transactions(user_id, occurred_at desc);

-- ── 6. savings (P1) ──────────────────────────────────────
create table savings (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references users(id) on delete cascade,
  kind            savings_kind not null,
  name            text not null,
  target_amount   bigint check (target_amount > 0),
  weekly_amount   bigint check (weekly_amount > 0),
  planned_amount  bigint not null default 0 check (planned_amount  >= 0),
  reserved_amount bigint not null default 0 check (reserved_amount >= 0),
  spent_amount    bigint not null default 0 check (spent_amount    >= 0),
  status          savings_status not null default 'waiting',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint chk_spent_le_reserved check (spent_amount <= reserved_amount)
);
create index idx_savings_user on savings(user_id, kind);

-- ── 7. savings_checks ────────────────────────────────────
create table savings_checks (
  id                 uuid primary key default gen_random_uuid(),
  saving_id          uuid not null references savings(id) on delete cascade,
  checked_at         timestamptz not null default now(),
  amount             bigint not null check (amount > 0),
  -- 앱은 계좌이체를 실행하지 않는다. 사용자 체크만 기록 (기획서 7장)
  transfer_confirmed boolean not null default false
);
create index idx_savings_checks on savings_checks(saving_id, checked_at desc);

-- reserved_amount는 체크 이력 합계를 초과할 수 없다 (기획서 9-3)
-- CHECK로는 표현 불가하므로 트리거로 강제한다.
create or replace function assert_reserved_within_checks()
returns trigger language plpgsql as $$
declare check_total bigint;
begin
  select coalesce(sum(amount), 0) into check_total
    from savings_checks where saving_id = new.id;
  if new.reserved_amount > check_total then
    raise exception
      'reserved_amount(%)가 체크 이력 합계(%)를 초과합니다 [기획서 9-3]',
      new.reserved_amount, check_total;
  end if;
  return new;
end $$;

create trigger trg_reserved_within_checks
  before update of reserved_amount on savings
  for each row execute function assert_reserved_within_checks();

-- ── updated_at 자동 갱신 ─────────────────────────────────
create or replace function touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

create trigger trg_users_touch     before update on users
  for each row execute function touch_updated_at();
create trigger trg_contracts_touch before update on contracts
  for each row execute function touch_updated_at();
create trigger trg_savings_touch   before update on savings
  for each row execute function touch_updated_at();

-- ── RLS ──────────────────────────────────────────────────
--
-- ✅ [PR 리뷰 반영, 팀 확정 — 2026-09-01, A·B·C 합의] 아래 정책은
-- using(true)/with check(true)라 사실상 전체 공개다. anon key가 배포된
-- 프론트에 직접 노출되면(클라이언트에서 Supabase를 바로 호출하면) 프로젝트
-- URL과 anon key를 아는 사람은 누구나 모든 테이블을 읽고/쓰고/지울 수 있다.
--
-- 검토했던 선택지 3가지:
--   (a) Mock-only  : 프론트가 DB를 아예 안 씀. 웹 배포 목표와
--                    "계약 등록 → D-day 갱신" 핵심 흐름 시연에 부적합해 기각.
--   (b) 서버 전용   : 프론트는 Supabase에 직접 붙지 않고, 자체 API 라우트
--                    (Next.js route handler)를 통해서만 DB에 접근한다.
--                    anon key를 클라이언트 번들에 넣지 않는다. → 채택
--   (c) 사용자별 정책: 실제 인증(Supabase Auth) + `using (user_id = auth.uid())`.
--                    인증·계좌 연동·실사용자 데이터는 MVP 범위 제외로 확정,
--                    5일 안에 하기엔 부담이라 P2 로드맵으로 보류.
--
-- ✅ 결정: (b) 서버 전용. DB에 닿는 모든 요청은 프론트가 아니라 서버
-- (Next.js API Route)를 거친다. anon key는 클라이언트 코드/환경변수
-- (NEXT_PUBLIC_* 등)에 절대 넣지 않는다. 이 전제가 지켜지는 한, 아래
-- 정책이 열려 있어도 외부에서 도달할 경로가 없다.
--
-- C 구현 체크리스트:
--   · Supabase 클라이언트 초기화는 서버 코드(API 라우트/서버 컴포넌트)에서만
--   · anon/service key를 .env(서버 전용, NEXT_PUBLIC_ 접두어 없이)로 관리
--   · 프론트에서 fetch("/api/contracts") 형태로만 호출, supabase-js를
--     클라이언트 컴포넌트에서 직접 import하지 않음
--   · 인증·계좌 연동은 이번 MVP 범위에서 완전히 제외 (P2 로드맵)

alter table users          enable row level security;
alter table clients        enable row level security;
alter table contracts      enable row level security;
alter table outflows       enable row level security;
alter table transactions   enable row level security;
alter table savings        enable row level security;
alter table savings_checks enable row level security;

-- ⚠️ 아래 정책은 전면 허용이다. 서버 전용 접근(C 구현 체크리스트)이 지켜지는
-- 한에서만 안전하다. anon key가 어떤 경로로든 클라이언트에 노출되면 위험하다.
create policy mvp_open on users          for all using (true) with check (true);
create policy mvp_open on clients        for all using (true) with check (true);
create policy mvp_open on contracts      for all using (true) with check (true);
create policy mvp_open on outflows       for all using (true) with check (true);
create policy mvp_open on transactions   for all using (true) with check (true);
create policy mvp_open on savings        for all using (true) with check (true);
create policy mvp_open on savings_checks for all using (true) with check (true);
