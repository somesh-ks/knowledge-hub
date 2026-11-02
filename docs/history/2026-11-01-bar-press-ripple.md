# 2026-11-01: a press ripple on the bottom bar (D286)

The owner asked for the bottom bar's touch feedback to show the touch area as a Material-style ripple, and said it was instant and should ease, calm. He picked option C of three recordings: a wave over the whole tab, the pill's press layer easing in beneath it.

- Cause of the instant feel: the press was one frame of a 12% layer on `:active`, and `:active` waits out the browser's press delay on a phone, so a quick tap showed nothing at all.
- Change: a Ripple in the design system (`Ripple.astro`, `ripple.ts`, `ripple.css`; it joined the rolling DS PR #525). A control with `data-ripple` holds a `.ripple-area`; a wave grows from the finger to the farthest corner over 300 ms on the hover curve and fades after the lift (a quick tap lets it play half its growth first). The press state is its own attribute, `data-ripple-pressed`, set on the first touch. The wave carries across the page move on the animation clock. The bar sets the touch area's reach through its padding and edges as `--ripple-reach-*` custom properties, so no page restyles the component.
- Reviews (CodeRabbit, then a code review) found real defects in the first build: a mouse press drew a wave; reduced motion still drew one; a global `data-pressed` clear broke a topics confirm state; one lift re-faded every wave; the press was never cleared so a later swap replayed it; any finger's lift ended the ripple. Each press is now its own, with its pointer id, control and waves.
- Checked: a journey test (`navSpeed.spec.ts`) that a quick tap marks its tab on touch and the wave is still going on the new page (red without the carry), and that another finger lifting does not end the press (red against a lift that ignores the pointer); gate and both browser suites; recordings in light and dark with the owner.
- Left: nothing felt on a real phone yet. Other controls keep the 100 ms press; a calmer press for all buttons is the owner's call (the `--duration-press-in` token).

## 2026-11-02: the double pill, and the tab a podcast is opened under

- Owner: a tap on a bottom tab "double ripples", the pill too, and the latest podcast opened from the Library shakes the bar and switches to Latest.
- Cause 1: the new bar's pill was started from a count of milliseconds taken at the swap's start, so it was taken back by the swap's length (167 ms in a test with a slow swap) and grew again. It now takes the old pill's animation start time.
- Cause 2: a finger already drew the pill (grey, in place, D286); the page then drew a second, smaller one that grew from nothing as the tab became current. A touch arrival now eases the same pill to the current tone.
- Cause 3: the latest briefing at its dated address is Today, so the Library's card for it lit Latest, with no Back and a pill grown from nothing. A briefing or episode now keeps the tab it was opened under (`navigation.ts`, sessionStorage per visit); its Back is rendered hidden on the latest briefing and shown then.
- Same pass: a menu pick no longer sounds the menu closing on top of the pick (the "triple tap"), and a sheet opened by a menu pick does not focus its note on a phone. The flash between the menu's scrim and the sheet's is the menu's own scrim (design system), handed to that thread.
