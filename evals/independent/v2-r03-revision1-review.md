# V2-R3 수정 1 — REVISE

humanStatus: not_run · 인간 참가자 0명 · 제품 수정 없음.

F01의 안내·전압 외곽 박스 겹침은 여섯 화면에서 해결됐다. 그러나 **F02 (P2): 짧은 화면의 280px 안내문에 white-space:nowrap이 남아 문장이 잘린다.** 실제 761×380 스크린샷과 DOM Range에서 요소 x465..745에 비해 글자 x465..807.4로, 끝46.4px가 화면 밖이다. clientWidth280, scrollWidth342. 줄바꿈된 실제 높이를 포함해 배치해야 한다.

6/6 외곽 박스 검사만으로 채택하지 않았다. 원본 결과를 repair-layout-box-only.json/html에 보존하고 실제 글자 Range 및 화면 밖 잘림 검사로 보강했다. 재현 수치는 clipped-hint.json. 문법 통과, 이전 행동9/9·undo열4/4·실제 삭제/취소/재연결 증거는 변경없어 재사용한다.

game.js: f81042f1e4117d41b43e795f369523ba5c1bd0d7f3210bbd0148278616f6d5bb

styles.css: 7f0eda6dda292614f4fbe7e5531d51c75669bb679811048e06d9314fe1dcf581

스냅샷 manifest.json과 integrity.json 보존. 실제 글자의 줄바꿈·잘림과 인접 표시에 대한 영향만 재평가하면 된다.
실제 글자 영역 재검사 결과: 4/6 통과, 600×320 및 761×380 잘림 확정(repair-layout.json).
