-- Test: Bridge-based booking totals match ground truth for every hotel with bookings (no Fan Trap)
-- Returns rows where bridge_booking_total differs from ground_truth_booking_total (should return 0 rows)

select
    hotel_id,
    ground_truth_booking_total,
    bridge_booking_total
from {{ ref('compare_fan_trap') }}
where bridge_booking_total is distinct from ground_truth_booking_total
