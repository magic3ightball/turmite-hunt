# 나만의 개미 만들기 — UI 개선 계획 (2026-10-28)

The rule is that behaviour stays the same. Simulation, verdicts, buttons and element IDs are unchanged; only how things look and where they sit changes. The single JS change is highlighting the current item in the header's 3-step guide.

The page had five problems, each with a fix:

| # | Problem (v4 screenshot) | Fix |
|---|---|---|
| 1 | The header was a long sentence, so it was hard to see what to do first. | Three step chips: ① 하얀 칸 ▾ 바꾸기 → ② 🏁 출발 → ③ 결과 보기. The chip for the current step lights up. |
| 2 | The code area was a plain black box with a lot of empty space on the right. | A dotted Scratch-style workspace, with a little more space for the stage (5:6). |
| 3 | The code buttons all looked the same, and "기분 추가" was as prominent as the rest. | A "블록 서랍" (block drawer) toolbar. 색 블록 추가 is the main button. 빼기 and 기분 (advanced) sit in a smaller row. |
| 4 | The stage buttons were all equal. The status and the step sentence were separate lines under the canvas. | 🏁 is a big green button; 멈춤, 한 걸음 and 빨리 are grouped as one segmented button. The step count is a badge on the canvas. The status and step sentence sit together in the ant's speech bubble. |
| 5 | When the result appeared, the stage card ran past the bottom of the screen and the result was cut off. | When a result is showing, the canvas shrinks to fit the screen height. The result is a card with a bigger title, bars and buttons. |
| + | The bottom extras were a plain list. | Card style with icons; focus outlines and reduced-motion support. |

Phone: the same chips, bubble and badge. The bottom bar stays as before.
