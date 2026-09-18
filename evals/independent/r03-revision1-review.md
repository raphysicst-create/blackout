# R3 revision 1 — REVISE

2026-09-17. humanStatus=not_run. 최초 REVISE 및 사본 보존. 제품 수정 없음.

styles.css SHA-256 `58a0fb82df32cbb18bc28f08803056fd3c1a5dece49242609ff953dcc1437ebd`. 최초 R3 대비 제품 변경은 CSS 하나뿐이다. 다른 제품/Node 검사 입력 해시는 동일하여 기존 Node45/45·케이블5/5 증거를 재사용했다. 사본은 `r03-revision1/site`, manifest는 같은 부모 폴더.

실제 기본 브라우저에서 3해법 승리와 자원 회계 기능 13개를 모두 재실행해 통과했다. 반응형 경계 8개 중 5개 통과, 3개 실패. 합계 **18/21**. 판정 **REVISE** — R3-F01은 부분 해소 상태다.

| 명목 iframe 크기 | 결과 |
|---|---|
| 600×380 | 통과, 기존 약11.2px 중첩 해소 |
| 640×480 | 통과 |
| 740×500 | 통과 |
| 600×520 | 실패: hint-title y411.2..428, cable-note y416.8..432 → 11.2px 겹침 |
| 760×550 | 실패: hint-title y410.1..431.7, cable-value y426.2..442.2; hint-detail y441.7..460.4, cable-note y447.2..462.4 |
| 761×380 | 실패: hint-detail y293..310, cable-value y307..323.8 → 3px 겹침 |
| 390×844 | hint/cable 상호 중첩 없음 |
| 1280×720 | 통과 |

실제 DOM 텍스트 bounding rect의 x·y 교집합을 검사했다. 픽셀 스케일에 따라 iframe CSS 크기와 내부 viewport가 소수 픽셀 차이를 보일 수 있으므로 breakpoint의 정확한 포함 여부보다 실제 관측된 중첩을 반례로 삼는다. 검증 URL `http://127.0.0.1:4193/evals/independent-r3.html`.

수정 요구: max-height500만 덮는 예외로는 max-height550의 기존 힌트 규칙과 width760 경계 양쪽을 다루지 못한다. 케이블/힌트 두 텍스트 그룹을 화면 크기에 걸쳐 분리해야 한다. 반응형 수리 후 동일 기능과 경계를 다시 검사한다. 인간 지표와 실제 터치 미실행 상태는 유지한다.
