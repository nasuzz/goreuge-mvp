// 거래처 이름 정규화 — Mock 저장소와 API 라우트가 같은 규칙을 써야 한다.
//
// [PR #25 리뷰 반영] Mock이 trim 후 완전 일치로 비교하는 바람에 "B미디어"와
// "B 미디어"가 서로 다른 거래처로 갈렸다. 거래처가 갈리면 완료 이력 3건 기준
// (medianDelayDays / p90DelayDays)이 무너져 지연 예측이 cold_start로 떨어진다.
//
// 규칙은 #21 API 라우트의 normalizeClientName과 동일하다. 한쪽만 바뀌면 다시
// 어긋나므로 API 라우트도 이 파일을 import하도록 맞추는 것이 좋다.

export function normalizeClientName(name: string): string {
  return name.replace(/\s+/g, "").toLocaleLowerCase("ko-KR");
}
