# Botball 2026 Cube Stack Scoring Rules

These notes capture the clarified cube stack rules for the planned 2026 GCER scoresheet update.
They are implementation notes only; the current scoring templates have not yet been changed to use repeatable stack rows.

## Stack Definition

A cube stack must touch the surface of the warehouse floor or a loading dock.

The lowest piece in the stack must be either a pallet or a cube.
Only cubes may be stacked on top of that lowest piece.

All other cubes that touch the topmost surface of the stack below count as part of the same stack.

## Cube Sorting

Cubes only count as sorted when they are on a pallet.
Cubes are sorted by color.

### Large Cube Values

Large green and large red cubes are each worth four small cubes of the same color.
They do not count as sorted until they are part of a stack (and, per the sorting rule, on a pallet).
That is, a lone large green or red cube counts as four unsorted cubes.

Large brown cubes are worth eight small cubes.
Brown is a color wildcard when it is part of a stack with another color: it counts as eight cubes of that other color.

Brown cubes must be stacked to count as sorted.
A lone brown cube counts as eight unsorted cubes.

### Sorted And Unsorted Examples

- Any stack that does not begin with a pallet is not sorted.
- A sorted stack must contain at least two physical objects.
- One small cube on a pallet counts as one unsorted cube.
- One large green cube counts as four unsorted cubes.
- One large green cube plus three small green cubes counts as seven sorted green cubes.
- One large brown cube plus two small red cubes counts as ten sorted red cubes.
- One lone large brown cube counts as eight unsorted cubes.
- One large green cube plus one large brown cube counts as twelve sorted green cubes.
- A stack containing both red and green cubes is unsorted.
- A stack containing multiple sortable colors is fully unsorted, but still scores as unsorted cube equivalents. For example, one small red cube and one small green cube count as two unsorted cubes.

## Planned Repeatable Stack Implementation

Implement this as a generic scoresheet capability with an isolated Botball scoring helper:

1. Add a reusable `repeatableGroup` field type to scoresheet schemas.
2. Use one `repeatableGroup` per cube-stack scoring area, such as `Internal Loading Dock Stacks` and `External Loading Dock Stacks`.
3. Keep the scoring area in the schema because cube stack point values differ by area.
4. Store each physical stack as one row. The judge enters the exact cube colors and sizes present in that stack.
5. Automatically append a new blank row when the last row has any cube value.
6. Ignore or prune fully blank rows during calculation and submission.
7. Derive sorted cube equivalents, unsorted cube equivalents, per-row status, and subtotal from the row contents.
8. Store the raw stack rows and per-row derived metadata on the repeatable group submission entry so admin review can see exactly what the judge entered.
9. Also publish derived totals as normal top-level score fields so existing formulas, totals, rankings, and admin review flows can keep consuming field IDs such as `side_a_ild_sorted_cubes`, `side_a_ild_unsorted_cubes`, and `side_a_ild_subtotal`.
10. Replace the current manual cube and pallet fields for the affected Botball cube-stack areas. Do not keep the old `*_pallets_mult` fields beside the repeatable stack group unless final rules confirm an additional area multiplier independent of per-stack pallet state.
11. All template updates should take place in the new `templates/botball-gcer-2026-scoring-fields.json`.

The `repeatableGroup` field should remain generic. Botball-specific logic should live in a pure helper, tentatively `scoreBotballCubeStacks`, so the color, size, brown wildcard, and all-or-nothing sorting rules are easy to test outside React.

Use `has_pallet` for each row because pallet presence is a binary property of the physical stack. Use explicit color and size field IDs (`small_yellow`, `large_brown`) so submitted data is unambiguous and matches the helper contract.

Example schema shape:

```json
{
  "id": "side_a_ild_cube_stacks",
  "label": "Internal Loading Dock Stacks",
  "type": "repeatableGroup",
  "column": "left",
  "rowLabel": "Stack",
  "minRows": 1,
  "autoAppendBlankRow": true,
  "pruneBlankRows": true,
  "fields": [
    { "id": "has_pallet", "label": "Pallet", "type": "checkbox" },
    {
      "id": "small_red",
      "label": "Small Red",
      "type": "number",
      "min": 0,
      "step": 1
    },
    {
      "id": "small_green",
      "label": "Small Green",
      "type": "number",
      "min": 0,
      "step": 1
    },
    {
      "id": "small_yellow",
      "label": "Small Yellow",
      "type": "number",
      "min": 0,
      "step": 1
    },
    {
      "id": "large_red",
      "label": "Large Red",
      "type": "number",
      "min": 0,
      "step": 1
    },
    {
      "id": "large_green",
      "label": "Large Green",
      "type": "number",
      "min": 0,
      "step": 1
    },
    {
      "id": "large_brown",
      "label": "Large Brown",
      "type": "number",
      "min": 0,
      "step": 1
    }
  ],
  "derived": {
    "type": "botballCubeStacks",
    "sortedValue": 30,
    "unsortedValue": 10,
    "outputs": {
      "sortedEquivalent": "side_a_ild_sorted_cubes",
      "unsortedEquivalent": "side_a_ild_unsorted_cubes",
      "subtotal": "side_a_ild_subtotal"
    }
  }
}
```

External loading dock fields should use the same row structure with area-specific values, for example sorted value `45` and unsorted value `15`.

Example submitted score data shape:

```typescript
scoreData.side_a_ild_cube_stacks = {
  label: 'Internal Loading Dock Stacks',
  type: 'repeatableGroup',
  value: [
    {
      has_pallet: true,
      small_red: 2,
      small_green: 0,
      small_yellow: 0,
      large_red: 0,
      large_green: 0,
      large_brown: 1,
    },
  ],
  derived: {
    sortedEquivalent: 10,
    unsortedEquivalent: 0,
    subtotal: 300,
    rows: [
      {
        sorted: true,
        sortedColor: 'red',
        equivalent: 10,
        subtotal: 300,
      },
    ],
  },
};

scoreData.side_a_ild_sorted_cubes = {
  label: 'Sorted Cubes',
  type: 'number',
  value: 10,
};

scoreData.side_a_ild_unsorted_cubes = {
  label: 'Unsorted Cubes',
  type: 'number',
  value: 0,
};

scoreData.side_a_ild_subtotal = {
  label: 'Subtotal',
  type: 'calculated',
  value: 300,
};
```

Helper behavior:

- Any stack that does not begin with a pallet is not sorted.
- A sorted stack must contain at least two physical objects.
- Small red, green, and yellow cubes count as one cube equivalent each.
- Large red and green cubes count as four cube equivalents of their own color.
- Large brown cubes count as eight cube equivalents.
- Brown acts as a wildcard only when it is in a stack with exactly one sortable color.
- A brown-only stack is unsorted.
- A stack with at least two physical objects, exactly one sortable color, and optional brown cubes is sorted as that color.
- A stack containing more than one sortable color is fully unsorted.
- Fully unsorted stacks still score at the unsorted cube value; they are not worth zero.
- Empty rows do not contribute to sorted or unsorted equivalents.

Suggested helper contract:

```typescript
export interface BotballCubeStackRow {
  has_pallet?: boolean;
  small_red?: number;
  small_green?: number;
  small_yellow?: number;
  large_red?: number;
  large_green?: number;
  large_brown?: number;
}

export interface BotballCubeStackResult {
  sortedEquivalent: number;
  unsortedEquivalent: number;
  subtotal: number;
  rows: Array<{
    sorted: boolean;
    sortedColor: 'red' | 'green' | 'yellow' | null;
    equivalent: number;
    subtotal: number;
  }>;
}
```

Test cases:

- One large green cube counts as four unsorted cube equivalents.
- One small red cube on a pallet counts as one unsorted cube equivalent.
- One large brown cube counts as eight unsorted cube equivalents.
- One small red plus one small green counts as two unsorted cube equivalents.
- One small red plus one small green plus one large brown counts as ten unsorted cube equivalents.
- One large green plus three small green counts as seven sorted green cube equivalents.
- One large brown plus two small red counts as ten sorted red cube equivalents.
- One large green plus one large brown counts as twelve sorted green cube equivalents.
- One small yellow plus one large brown counts as nine sorted yellow cube equivalents.
- One small yellow plus one small red counts as two unsorted cube equivalents.
- Multiple stack rows aggregate sorted equivalents, unsorted equivalents, and subtotal correctly.
