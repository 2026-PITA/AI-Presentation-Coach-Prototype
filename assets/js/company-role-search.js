// 회사/직무 자동완성 데이터 레이어.
// 현재는 정적 목록으로 동작하지만, 백엔드 연동 시 companies()/roles() 내부만
// fetch("/.netlify/functions/search-companies" | "search-roles") 호출로 교체하면 되고
// UI 쪽(company-role-search를 호출하는 코드)은 수정할 필요가 없습니다.
(function attachPitaSearchClient(global) {
  const COMPANIES = [
    "네이버", "카카오", "카카오뱅크", "카카오페이", "카카오엔터프라이즈", "카카오모빌리티",
    "라인", "쿠팡", "배달의민족", "당근", "토스", "토스뱅크", "토스증권",
    "삼성전자", "SK하이닉스", "LG전자", "현대자동차", "포스코",
    "우아한형제들", "쏘카", "야놀자", "직방", "무신사",
    "NHN", "넥슨", "넷마블", "크래프톤", "엔씨소프트", "스마일게이트",
  ];

  const ROLES = [
    "기획/PM", "서비스 기획자", "UI/UX 디자이너", "브랜드 디자이너",
    "프로덕트(제품) 디자이너", "그래픽 디자이너",
    "프론트엔드 개발자", "백엔드 개발자", "풀스택 개발자",
    "데이터 분석가", "데이터 엔지니어", "머신러닝 엔지니어",
    "마케팅 매니저", "퍼포먼스 마케터", "콘텐츠 마케터",
    "영업 관리자", "인사(HR) 담당자", "회계·재무 담당자", "고객 성공(CS) 매니저",
  ];

  function findMatches(list, query, limit = 8) {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return list.filter((item) => item.toLowerCase().includes(q)).slice(0, limit);
  }

  async function companies(query) {
    return findMatches(COMPANIES, query);
  }

  async function roles(query) {
    return findMatches(ROLES, query);
  }

  global.PitaSearch = Object.freeze({ companies, roles });
})(window);
