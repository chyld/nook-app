---
title: Lisbon trip
tags: [travel, portugal]
created: 2026-11-10
updated: 2026-11-10
font: Source Serif 4
size: 17px
theme: paper
---

# Lisbon trip
{color=indigo}

## Plain Markdown

A **bold** plan, an *italic* mood, ***both at once***, and ~~a cancelled idea~~.
Run `convert --eur` before paying. See [the city guide](https://example.com/lisbon).

> "Saudade" has no exact translation.
> It is closer to a feeling than a word.

---

## The extras

- Underline: ++book by Friday++
- Underline as an attribute: [C++]{underline=yes}
- Highlight: ==pack sunscreen==
- Highlight in another colour: [window seat]{bg=mint}
- Text colour: [flight is delayed]{color=red} or by hex [like this]{color=#2b6cb0}
- Font: [a handwritten postcard line]{font="Caveat"}
- Size: [small print]{size=small}, [large]{size=large}, [exact]{size=22px}
- Combined: [**Do not forget the passport**]{color=white bg=red font="Inter" size=large}
- Mixed: **bold with a [red word]{color=red} inside**, and *italic ++underlined++*
- Two fonts on one line: [Playfair]{font="Playfair Display"} beside [Mono]{font=mono}
- A styled link: [see [the guide](https://example.com)]{color=red}
- Plain brackets in a span: [see note [1] below]{color=gray}

This whole paragraph is grey and small, set by the line below it.
{color=gray size=small}

## Lists

- Pack charger
  - Plug adapter
  - [Spare battery]{color=red}
- Pack ==sunscreen==

1. Book flights
2. Reserve hotel
   1. Near Alfama
   2. Breakfast included

- [x] Passport renewed
- [ ] Travel insurance

## Table

| Item    | Cost (EUR) | Paid               |
|:--------|-----------:|:------------------:|
| Flights |        240 | [yes]{color=green} |
| Hotel   |        510 | ==no==             |

## Code

```python
total = sum([240, 510])
print(f"Total: {total} EUR")
```

## Photos

![Tram 28 at dusk](<Lisbon trip.assets/tram.jpg>)
{width=70%}

![Tiles in Alfama](<Lisbon trip.assets/tiles.jpg>)
