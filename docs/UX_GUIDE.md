# UX guide

## Design tokens

- **Brand:** factory green `brand-50` to `brand-900`; use `brand-600` for primary actions.
- **Accent:** turmeric `turmeric-50` to `turmeric-700`; reserve for one highlighted action.
- **Neutrals:** slate; page `slate-50`, white surfaces, `slate-200` borders, `slate-900/600/500` text.
- **Semantics:** success green-600, warning amber-500, danger red-600, info sky-600. Never rely on color alone.
- **Type:** Inter Variable, then system sans; page 24/32 semibold, section 18/28 semibold, body 14/20 (salesman 16/24), caption 12/16; tabular numbers.
- **Shape:** 12 px cards/modals, 8 px controls, 1 px borders, soft card/modal shadows, 4 px spacing scale, 24 px page padding (16 px on phones).
- **Motion and focus:** 150 ms ease-out; reduced-motion support; visible 2 px brand focus ring.
- **Icons:** Lucide, tree-shaken; 16 px in controls/tables and 20 px in navigation.

## E. Status labels

| Code | Label | Tone |
| --- | --- | --- |
| SUBMITTED | Submitted | info |
| APPROVED | Approved | success |
| REJECTED | Rejected | danger |
| INVOICED | Invoiced | info |
| DISPATCHED | Dispatched | success |
| CANCELLED | Cancelled | neutral |
| POSTED | Posted | success |
| ISSUED | Issued | info |
| COMPLETED | Completed | success |
| PAID | Paid | success |
| PARTIAL | Partially paid | warning |
| UNPAID | Unpaid | danger |
| FLAGGED | Flagged | danger |

Show sentence-case labels and a status dot; retain the raw code in `title`.
