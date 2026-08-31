-- 고르게 MVP — Supabase(Postgres) 스키마
-- DRI: A(수경).  상태: 1일차 오전 확정본
-- 기획서 9-1 "MVP 테이블 7개" + 확정 결정 D2(settlement_term), D1-a(expected_date_source)
--
-- 적용: Supabase 대시보드 > SQL Editor에 그대로 붙여넣기
-- MVP는 인증을 건너뛰므로 RLS는 열어둔다. 실서비스 전환 시 반드시 잠글 것.

-- ⚠️ 재실행 주의
-- 이 파일은 한 번만 실행하는 것을 전제로 한다. 두 번째부터는
-- "type already exists" 에러가 난다. 처음부터 다시 만들려면
-- 아래 블록의 주석을 풀어서 먼저 실행할 것. (데이터 전부 삭제됨)
--
-- drop table if exists savings_checks, savings, transactions,
--                      outflows, contracts, clients, users cascade;
-- drop function if exists assert_reserved_within_checks() cascade;
-- drop function if exists touch_updated_at() cascade;
-- drop type if exists contract_status, classification_status, income_type,
--                     settlement_term, expected_date_source, status_source,
--                     outflow_recurrence, savings_kind, savings_status,
--                     spend_class cascade;

-- ── 재실행용 리셋 ────────────────────────────────────────
-- 스프린트 중 스키마를 여러 번 갈아엎게 되므로 idempotent하게 만든다.
-- 데이터가 전부 날아가므로 운영 환경에서는 절대 실행하지 말 것.
drop table if exists savings_checks cascade;
drop table if exists savings        cascade;
drop table if exists transactions   cascade;
drop table if exists outflows       cascade;
drop table if exists contracts      cascade;
drop table if exists clients        cascade;
drop table if exists users          cascade;
drop function if exists assert_reserved_within_checks() cascade;
drop function if exists touch_updated_at()              cascade;
drop type if exists contract_status       cascade;
drop type if exists classification_status cascade;
drop type if exists income_type           cascade;
drop type if exists settlement_term       cascade;
drop type if exists expected_date_source  cascade;
drop type if exists status_source         cascade;
drop type if exists outflow_recurrence    cascade;
drop type if exists savings_kind          cascade;
drop type if exists savings_status        cascade;
drop type if exists spend_class           cascade;

-- ── enum 타입 ────────────────────────────────────────────
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

-- ── RLS (MVP: 인증 스킵이므로 전면 허용) ─────────────────
-- 제출 후 실서비스 전환 시 반드시 user_id 기준으로 잠글 것.
alter table users          enable row level security;
alter table clients        enable row level security;
alter table contracts      enable row level security;
alter table outflows       enable row level security;
alter table transactions   enable row level security;
alter table savings        enable row level security;
alter table savings_checks enable row level security;

create policy mvp_open on users          for all using (true) with check (true);
create policy mvp_open on clients        for all using (true) with check (true);
create policy mvp_open on contracts      for all using (true) with check (true);
create policy mvp_open on outflows       for all using (true) with check (true);
create policy mvp_open on transactions   for all using (true) with check (true);
create policy mvp_open on savings        for all using (true) with check (true);
create policy mvp_open on savings_checks for all using (true) with check (true);
