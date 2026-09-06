-- db/seed-demo.sql — 데모 시드 (이슈 #23)
--
-- ⚠️ 이 파일은 생성물이다. 직접 고치지 말 것.
--    재생성: node db/seed-demo.mjs > db/seed-demo.sql
--    원본:   src/shared/mock-data.json
--
-- 적용: Supabase 대시보드 > SQL Editor에 그대로 붙여넣기.
--       schema.sql(+ 이슈 #16 payer_stated_net_amount 마이그레이션)이 먼저 적용돼 있어야 한다.
--
-- 몇 번을 실행해도 같은 상태가 된다(먼저 지우고 넣는다). 스모크 테스트로
-- 데모 데이터가 바뀐 뒤 원상복구할 때도 이 파일을 다시 실행하면 된다.
--
-- DEMO_USER_ID=a0000000-0000-4000-8000-000000000001
-- 기준일(DEMO_TODAY)=2026-09-01
--
-- 페르소나: 김도현, 31세, 영상편집 프리랜서 5년차. 잔액 80만원, 미수금 912만원.

begin;

-- ── 기존 데모 행 제거 (참조 순서대로) ──────────────────
delete from savings_checks where saving_id in (select id from savings where user_id = 'a0000000-0000-4000-8000-000000000001');
delete from savings      where user_id = 'a0000000-0000-4000-8000-000000000001';
delete from transactions where user_id = 'a0000000-0000-4000-8000-000000000001';
delete from outflows     where user_id = 'a0000000-0000-4000-8000-000000000001';
delete from contracts    where user_id = 'a0000000-0000-4000-8000-000000000001';
delete from clients      where user_id = 'a0000000-0000-4000-8000-000000000001';
delete from users        where id      = 'a0000000-0000-4000-8000-000000000001';

-- ── 1. users ───────────────────────────────────────────
-- 안전예비금 0원: 제안값 1,200,000원이 잔액 800,000원보다 커서
-- 사용자가 '0원으로 시작'을 선택한 케이스(기획서 3-3).
insert into users (id, total_balance, monthly_fixed_outflow, safety_buffer, tax_reserve_rate, created_at, updated_at) values
('a0000000-0000-4000-8000-000000000001', 800000, 1200000, 0, 0.12, '2026-09-01T09:00:00+09:00', '2026-09-01T09:00:00+09:00');

-- ── 2. clients ─────────────────────────────────────────
-- completed_count가 3 미만이면 통계값은 반드시 null이다(client_stats_consistency).
insert into clients (id, user_id, name, completed_count, median_delay_days, p90_delay_days) values
('c0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', 'D에이전시', 5, 5, 14),
('c0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000001', 'K스튜디오', 4, 12, 25),
('c0000000-0000-4000-8000-000000000003', 'a0000000-0000-4000-8000-000000000001', 'M프로덕션', 1, null, null),
('c0000000-0000-4000-8000-000000000004', 'a0000000-0000-4000-8000-000000000001', '신규 거래처', 0, null, null);

-- ── 3. contracts ───────────────────────────────────────
insert into contracts (
  id, user_id, client_id, gross_amount, completion_date, invoice_date,
  settlement_term, settlement_day, expected_date, expected_date_source, actual_date,
  income_type, classification_status,
  reference_rate, confirmed_expected_rate, actual_rate,
  payer_stated_net_amount, expected_net_amount, actual_net_amount,
  status, status_source, status_reason, status_updated_at, created_at, updated_at
) values
  ('d0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001', 2400000, '2026-09-03', null, 'NEXT_MONTH_END', null, '2026-10-31', 'calculated', null, 'business_personal_service', 'user_confirmed', 0.033, 0.033, null, null, 2320800, null, 'waiting', 'system', null, '2026-09-01T09:00:00+09:00', '2026-08-20T09:00:00+09:00', '2026-09-01T09:00:00+09:00'),
  ('d0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000002', 1200000, '2026-07-20', null, 'NEXT_MONTH_END', null, '2026-08-31', 'calculated', null, 'business_personal_service', 'user_confirmed', 0.033, 0.033, null, null, 1160400, null, 'delayed', 'system', null, '2026-09-01T09:00:00+09:00', '2026-07-10T09:00:00+09:00', '2026-09-01T09:00:00+09:00'),
  ('d0000000-0000-4000-8000-000000000003', 'a0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000003', 1800000, '2026-05-15', '2026-05-15', 'NET_DAYS', 30, '2026-06-14', 'calculated', null, 'business_personal_service', 'user_confirmed', 0.033, 0.033, null, null, 1740600, null, 'risk', 'system', null, '2026-09-01T09:00:00+09:00', '2026-05-01T09:00:00+09:00', '2026-09-01T09:00:00+09:00'),
  ('d0000000-0000-4000-8000-000000000004', 'a0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000004', 1720000, '2026-09-20', null, 'NEXT_MONTH_DAY', 15, '2026-10-15', 'calculated', null, 'needs_review', 'needs_review', null, null, null, null, null, null, 'waiting', 'system', null, '2026-09-01T09:00:00+09:00', '2026-08-28T09:00:00+09:00', '2026-09-01T09:00:00+09:00'),
  ('d0000000-0000-4000-8000-000000000005', 'a0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001', 1500000, '2026-07-01', null, 'NEXT_MONTH_END', null, '2026-08-31', 'calculated', '2026-08-25', 'business_personal_service', 'actual_confirmed', 0.033, 0.033, 0.033, null, 1450500, 1450500, 'completed', 'system', null, '2026-08-25T14:00:00+09:00', '2026-06-25T09:00:00+09:00', '2026-08-25T14:00:00+09:00'),
  ('d0000000-0000-4000-8000-000000000006', 'a0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000002', 900000, '2026-09-10', null, 'ON_COMPLETION', null, '2026-09-10', 'calculated', null, 'business_personal_service', 'user_confirmed', 0.033, 0.033, null, null, 870300, null, 'cancelled', 'user', '클라이언트 프로젝트 중단 통보', '2026-08-29T11:00:00+09:00', '2026-08-15T09:00:00+09:00', '2026-08-29T11:00:00+09:00'),
  ('d0000000-0000-4000-8000-000000000007', 'a0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001', 2000000, '2026-10-25', null, 'NEXT_MONTH_DAY', 25, '2026-11-25', 'calculated', null, 'business_personal_service', 'user_confirmed', 0.033, 0.033, null, null, 1934000, null, 'waiting', 'system', null, '2026-09-01T09:00:00+09:00', '2026-08-30T09:00:00+09:00', '2026-09-01T09:00:00+09:00');

-- ── 4. outflows ────────────────────────────────────────
-- included_in_baseline=true는 monthly_fixed_outflow에 이미 포함된 항목이다.
-- 엔진이 개별 차감하면 중복 차감이 된다(기획서 9-3).
insert into outflows (id, user_id, kind, name, amount, due_date, recurrence, included_in_baseline) values
  ('e0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', '월세', '월세', 550000, '2026-09-05', 'monthly', true),
  ('e0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000001', '카드청구', '신용카드 결제', 780000, '2026-09-14', 'monthly', false),
  ('e0000000-0000-4000-8000-000000000003', 'a0000000-0000-4000-8000-000000000001', '구독료', '어도비 CC', 62000, '2026-09-08', 'monthly', true);

-- ── 5. savings (P1) ────────────────────────────────────
insert into savings (id, user_id, kind, name, target_amount, weekly_amount, planned_amount, reserved_amount, spent_amount, status) values
  ('f0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', 'tax', '세금 준비금', null, null, 288000, 0, 0, 'waiting'),
  ('f0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000001', 'wish', '모니터 교체', 600000, 50000, 0, 0, 0, 'waiting');

commit;

-- ── 투입 후 엔진이 내야 하는 값 (src/shared/mock-data.json의 expectedResults) ──
--   미수금            9,120,000원
--   시뮬 시작 잔액    800,000원
--   D-day optimistic  2026-10-24 (53일)
--   D-day baseline    2026-09-30 (29일)
--   D-day pessimistic 2026-09-14 (13일)
--
-- 위 숫자 확인:  node test/api-smoke.mjs
