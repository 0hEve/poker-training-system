# No-Limit Texas Hold’em table rules

## 1. Table state, seats and blinds

- Use integer chip units, with 1 as the smallest unit and `0 < SB < BB`. Keep amounts and sums within the safe integer range.
- Seats have a fixed clockwise order. “Left of” a seat means the next seat clockwise, wrapping at the end. Freeze seating, participants and blind amounts for each hand.
- At hand start, deal in occupied, opted-in seats with positive stacks. Empty seats, opted-out seats and zero stacks are skipped. Require 2–22 participants for a 52-card deck with three burns.
- Persist stacks between hands and app reloads. Initialize each player’s configured starting stack once. An explicit global reset cancels any hand and restores configured starting stacks and the initial button state. If saving an in-progress hand, commit its ledger and stacks together so a reload cannot lose or double-award chips.
- Keep `actor` (the seat legally due to act) separate from `activeViewer` (the seat selected by the operator). Switching viewers leaves action order intact. Hide the outgoing hand before showing the incoming viewer’s own two cards. Accept a betting command only for the current actor while that actor is selected. Only tabled showdown cards are public. Players choose every betting action.
- Use a **simple moving-button house rule**. Pick the first button randomly from eligible seats. On later hands move it clockwise from the previous button’s seat to the next eligible seat. With 3+ players, the next two eligible seats after the button post SB and BB in that order.
- With two players, the button posts SB and the other seat posts BB. On transition from 3+ players to two, if the previous BB survives, make that player the button so they avoid consecutive BBs. If the previous BB is absent, use normal button movement. On subsequent heads-up hands, alternate positions while the same two players remain.
- This house rule can skip a blind obligation when seats drop out. A dead-button system instead assigns BB to the player due for it and positions the SB and button accordingly, potentially on empty seats. Use the simple rule without missed-blind accounting or makeup blinds.
- Post `min(stack, assignedBlind)` and mark the player all-in if their stack reaches zero. A short blind still gets cards. Posting a blind is forced and does not count as acting. The configured BB remains the normal preflop bring-in and minimum raise increment.

[Robert’s Rules of Poker v11, §4 and §14](https://homepokertourney.org/roberts-rules-of-poker.htm) · [Poker TDA 2026, Rule 36](https://www.pokertda.com/view-poker-tda-rules/)

## 2. Deal and street progression

1. Shuffle one standard 52-card deck without jokers per hand. Starting at the first dealt seat left of the button, deal one face-down card per player clockwise, then repeat in the same order. Heads-up, BB receives the first card and the button receives the last. There is no burn before the hole cards.
2. **Preflop** starts immediately left of the BB. Heads-up, this is the button.
3. After preflop betting closes, burn one face-down card and deal three face-up cards for the **flop**.
4. After flop betting closes, burn one and deal one face-up **turn**. After turn betting closes, burn one and deal one face-up **river**.
5. On each postflop street, start at the first seat left of the button with action pending. Heads-up, BB acts first and the button acts last when both can act. Advance clockwise on every street, skipping folded and all-in players.
6. If the hand becomes uncontested, award it immediately. If multiple players remain but betting is finished for the hand, reveal their cards and run out any remaining board streets in order with their normal burns. After the river, settle the hand.

[Robert’s Rules of Poker v11, §5](https://homepokertourney.org/roberts-rules-of-poker.htm) · [Poker TDA 2026, Rules 17, 36 and 40](https://www.pokertda.com/view-poker-tda-rules/)

## 3. Betting state and legal actions

Per dealt player keep `stack`, `streetPut`, `totalPut`, `folded`, `hasActedSinceLastFullRaise` and `betAtLastAction`. A live player is a dealt player who has not folded. A live player with `stack == 0` is all-in. A live player with chips can act. Every commitment subtracts from `stack` and adds the same amount to `streetPut` and `totalPut`. Folded commitments stay in the ledger.

On a new street, set all `streetPut = 0`, all action flags to false, all `betAtLastAction = 0`, `lastFullRaiseSize = BB` and `lastAggressor = none`. On preflop, initialize `currentBet = BB` and then post the blinds. On later streets initialize `currentBet = 0`. `totalPut` starts at zero per hand and carries across streets.

For a player with action pending, let `maxTo = streetPut + stack`. Wager targets are **total chips committed on this street after the action**. Compute the call amount and aggression permission as follows.

```text
actionable = live players with stack > 0
if size(actionable) >= 2:
    callTarget = currentBet
else:  # sole actionable player, with at least one live all-in opponent
    callTarget = max(q.streetPut for other live players q)
toCall = max(0, callTarget - p.streetPut)

raiseRight = !p.hasActedSinceLastFullRaise
    or currentBet - p.betAtLastAction >= lastFullRaiseSize
canIncrease = size(actionable) >= 2 and raiseRight and maxTo > currentBet
minIncreaseTo = currentBet + lastFullRaiseSize
```

The sole player with chips can owe a call to a real wager but cannot create a new wager. The preflop nominal BB is waived in that case. With at least two players able to act, a short BB still sets the call target at the full BB and the initial minimum raise-to at twice the BB.

| Action | Validation and effect |
| --- | --- |
| Check | Require `toCall == 0`. Commit zero. The BB can check their option when the action reaches them unraised. |
| Fold | Require `toCall > 0` in this app. Set `folded = true`, hide the cards and retain all commitments. |
| Call | Require `toCall > 0`. Commit `min(stack, toCall)`. A short call puts the player all-in. |
| Bet to | Require `currentBet == 0`, `canIncrease` and `minIncreaseTo <= target <= maxTo`. Commit `target - streetPut`. |
| Raise to | Require `currentBet > 0`, `canIncrease` and `minIncreaseTo <= target <= maxTo`. Commit `target - streetPut`. This covers the BB’s unraised option to raise. |
| All-in | When facing a call and `stack <= toCall`, treat as a call for the whole stack. Otherwise require `canIncrease` and use `target = maxTo`, even below the minimum. If all-in would overpay a call while raising is unavailable, offer the normal call for the required amount. |

Reject invalid or out-of-turn input without changing state. There is no cap on the number of legal raises. Explicit actions and integer targets avoid live-table chip-gesture interpretation.

### Minimum raises and reopening

Apply the following after validation. Here an increase means the validated bet, raise or aggressive all-in. Increments are measured from the old `currentBet`, including after a short opening all-in. For example, with BB 100 and a postflop all-in opener of 20, an eligible player can call 20 or make a full raise to at least 120.

```text
if action is an increase:
    increment = target - currentBet
    commit(p, target - p.streetPut)
    currentBet = target
    lastAggressor = p.seat
    if increment >= lastFullRaiseSize:
        lastFullRaiseSize = increment
        for each dealt player q:
            q.hasActedSinceLastFullRaise = false
else:
    apply check, call or fold as above

p.hasActedSinceLastFullRaise = true
p.betAtLastAction = currentBet
advance from p.seat
```

A short increase updates the call price but leaves the full-raise size and other players’ flags unchanged. A player who already acted can raise only after a full increase or after consecutive short increases bring the price up by at least `lastFullRaiseSize` since that player’s own latest action. Calling one of the short raises updates that player’s baseline. The cumulative increases do not change the minimum raise increment.

With BB 100, suppose A bets 100, B goes all-in to 150, C calls 150, and D goes all-in to 200. When next due, A can raise to at least 300. If A only calls, C faces 50 more and can call or fold, with no raise. If A raises to 300, C regains the right to raise.

[Robert’s Rules of Poker v11, §14](https://homepokertourney.org/roberts-rules-of-poker.htm) · [Poker TDA 2026, Rules 45, 49 and 50](https://www.pokertda.com/view-poker-tda-rules/)

### Choosing the next actor and closing the street

After posting blinds, at the start of each postflop street and after every action, resolve in this order.

```text
if live.count == 1:
    returnUncalled()
    award all remaining contributions to the lone live player
    finish hand
else:
    actionable = live players with stack > 0
    if actionable.count == 0:
        pending = []
    else if actionable.count == 1:
        p = only actionable player
        pending = [p] if p.streetPut < max(q.streetPut for other live players q)
                  else []
    else:
        pending = [p for p in actionable if
                   !p.hasActedSinceLastFullRaise or p.streetPut < currentBet]

    if pending is nonempty:
        actor = first pending seat clockwise from the action anchor, exclusive
    else:
        returnUncalled()
        if any live player is all-in and fewer than 2 live players have chips:
            table all live hands and run out remaining streets
            settle showdown
        else if street is river:
            settle showdown
        else:
            deal next street and initialize its betting state
```

The action anchor is the BB for initial preflop selection, the button for initial postflop selection, and the last actor thereafter. A short raise can leave a player pending even if their raise right is closed. The round cannot close on a matched BB that still has its option while another player can act.

## 4. Uncalled chips, showdown and pots

**Return uncalled chips** at street close, including a fold win, before clearing street commitments or awarding pots. Find the largest and second-largest `streetPut` across all dealt players, including folded players. If the maximum is unique, return `largest - secondLargest` to that player’s stack and subtract it from both commitment counters. A tied maximum returns zero. Recompute who has chips after the refund. A player can regain chips after an apparent all-in.

**Fold win.** Stop when one live player remains. After the refund, award that player the sum of all remaining contributions. No cards are required to be shown and no more board cards are dealt.

**Showdown.** If any live player is all-in once betting for the hand is finished, table every live hand, including side-pot contenders, before any remaining runout. Otherwise table the river’s last bettor or raiser first. If the river checked through, start at the first live seat left of the button. Continue clockwise among live seats. For this app, table both hole cards of every live hand at showdown and evaluate automatically. Folded hands stay hidden.

**Pot construction.** Use hand totals after uncalled refunds. Form layers by increasing distinct positive contribution levels. Folded players fund each layer they reached. Only live players who reached that layer can win it.

```text
levels = sorted unique positive totalPut values
prev = 0
for level in levels:
    contributors = [p for p in dealt if p.totalPut >= level]
    amount = (level - prev) * count(contributors)
    eligible = [p for p in contributors if !p.folded]
    assert count(contributors) >= 2 and eligible is nonempty
    emit pot(amount, eligible)  # first is main pot, later layers are side pots
    prev = level
```

Before splitting, combine layers with identical eligible sets. A folded player’s contribution cutoff can add a layer without creating a separate contest. Keep every distinct eligibility set as its own pot even if the same players happen to tie across pots.

For each pot, find the highest hand score among its eligible players. Sort all players sharing that score clockwise starting left of the button. Give each `floor(amount / winnerCount)`. Give one extra unit to each of the first `amount % winnerCount` winners in that order. Restart the order for each pot. A pot with one eligible player goes entirely to them, even if they lose a different pot. Apply payouts once and clear the commitment ledger. During a hand, `sum(stack) + sum(totalPut)` is constant. After settlement, the entire sum is back in stacks.

Suppose live A, B and C paid 40, 60 and 100, live E paid 100, and folded D paid 75. The 200 main pot is open to A/B/C/E, the 80 side pot to B/C/E, and the last 95 to C/E (45 + 50 from the final two layers). If C and E split that 95, the first of them left of the button gets 48 and the other gets 47.

[Poker TDA 2026, Rules 12–18, 20, 23 and 67](https://www.pokertda.com/view-poker-tda-rules/)

## 5. Hand evaluation

Score all 21 five-card subsets of the two hole cards and five board cards. Use the maximum score, allowing zero, one or two hole cards. Compare category first, then compare that category’s rank tuple lexicographically from left to right. Ranks run 2–14 (ace high) except that A‑2‑3‑4‑5 is a five-high straight. A straight requires five distinct consecutive ranks or that wheel pattern. Suits determine flushes and never break ties.

| Category, highest first | Tiebreak tuple, highest rank first within each group |
| --- | --- |
| Straight flush (includes ace-high royal flush) | Top straight rank, 5 for a wheel |
| Four of a kind | Quad rank, kicker |
| Full house | Trip rank, pair rank |
| Flush | All five ranks in descending order |
| Straight | Top straight rank, 5 for a wheel |
| Three of a kind | Trip rank, two kickers descending |
| Two pair | Higher pair, lower pair, kicker |
| One pair | Pair rank, three kickers descending |
| High card | All five ranks in descending order |

Identical maximum scores tie, including when players share the best five from the board. Cards outside the best five never break a tie.

[PokerStars Texas Hold’em rules](https://www.pokerstars.com/poker/learn/lesson/texas-holdem-rules/) · [PokerStars hand rankings](https://www.pokerstars.com/poker/games/rules/hand-rankings/)

## 6. Chip display

Use this app palette. Chip colors vary by venue, so label denominations and show the numeric stack total.

| Value | Color |
| ---: | --- |
| 1 | White |
| 5 | Red |
| 10 | Blue |
| 25 | Green |
| 100 | Black |
| 500 | Purple |
| 1,000 | Yellow or orange (choose one consistently) |

For a balance `n`, visit denominations in descending order. Emit `floor(n / denom)` chips of that denomination and continue with `n % denom`. Render large groups with a count label. Zero yields no chips. A balance of 2,643 displays as 2 × 1,000, 1 × 500, 1 × 100, 1 × 25, 1 × 10, 1 × 5 and 3 × 1. Use the integer ledger for all bets, refunds and payouts.

[PokerStars on casino chip color conventions](https://www.pokerstars.com/casino/news/casino-chips-around-the-world-culture-colour-and-design/3154/)
