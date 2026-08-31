-- reset.sql — 개발 환경 초기화 전용
-- DRI: A(수경)
--
-- ⚠️ 이 파일은 테이블·데이터를 전부 삭제한다. 절대 프로덕션에서 실행하지 말 것.
-- 용도: 로컬/개발용 Supabase 프로젝트에서 스키마를 다시 만들 때만 사용.
--
-- 사용법:
--   1. 이 파일을 SQL Editor에서 먼저 실행 (테이블·타입·함수 전부 삭제)
--   2. schema.sql을 실행 (다시 생성)

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
