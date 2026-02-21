-- Test: Bridge-based totals match ground truth for every traveler (no Chasm Trap)
-- Returns rows where bridge_total != ground_truth_total (should return 0 rows)

select
    traveler_id,
    ground_truth_total,
    bridge_total
from {{ ref('compare_chasm_trap') }}
where bridge_total != ground_truth_total
