# Library card menu on long press

2026-10-31. The owner asked to drop the ⋮ on phone cards and open the sheet on a hold (D264).

## What happened

The button was the source of the card's alignment work. On touch it is now hidden and unpressable, the reserves around the title go, and `cardHold.ts` opens the existing popover after 450 ms. Three things broke on the way, in this order: the click that ends a hold opened the card; the lift light-dismissed the sheet; the compat mousedown focused the link and `heroMenu.ts` closed the sheet as a tab-out. Pointer capture on the sheet and a cancelled touchend fixed all three.

## Tests

Seven tests opened the menu by clicking the ⋮, which a phone can no longer press. They use `openRowMenu` (a hold on touch, the button with a mouse). The three-dots no-shake test moved to desktop, where the button lives. One new test holds a card and checks the sheet stays and the card does not open.

## Left

A real phone, iOS especially: the focus ring on the sheet's first row shows in the CDP harness after a hold.
