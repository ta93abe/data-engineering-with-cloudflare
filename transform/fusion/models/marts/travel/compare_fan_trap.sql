-- Fan Trap comparison: per-hotel booking total + average rate
-- traditional_total will be WRONG (inflated) for hotels with multiple rate history records
-- bridge_total and ground_truth will match

with

-- Ground truth: aggregate each measure independently, then join
booking_totals as (
    select
        hotel_id,
        sum(hotel_amount) as total_booking_amount,
        count(*) as booking_count
    from {{ ref('fct_hotel_bookings') }}
    group by hotel_id
),

rate_averages as (
    select
        hotel_id,
        avg(rate_per_night) as avg_rate_per_night,
        count(*) as rate_count
    from {{ ref('stg_hotel_rate_history') }}
    group by hotel_id
),

ground_truth as (
    select
        coalesce(bt.hotel_id, ra.hotel_id) as hotel_id,
        bt.total_booking_amount as ground_truth_booking_total,
        ra.avg_rate_per_night as ground_truth_avg_rate,
        bt.booking_count as ground_truth_booking_count,
        ra.rate_count as ground_truth_rate_count
    from booking_totals as bt
    full outer join rate_averages as ra
        on bt.hotel_id = ra.hotel_id
),

-- Traditional (naive) JOIN: hotel_bookings -> rate_history causes fan-out
traditional as (
    select
        hb.hotel_id,
        sum(hb.hotel_amount) as traditional_booking_total,
        avg(rh.rate_per_night) as traditional_avg_rate
    from {{ ref('fct_hotel_bookings') }} as hb
    left join {{ ref('stg_hotel_rate_history') }} as rh
        on hb.hotel_id = rh.hotel_id
    group by hb.hotel_id
),

-- Bridge: join each measure through bridge keys (no fan-out)
bridge_bookings as (
    select
        b.hotel_key as hotel_id,
        sum(hb.hotel_amount) as bridge_booking_total
    from {{ ref('bridge_unified') }} as b
    inner join {{ ref('fct_hotel_bookings') }} as hb
        on b.hotel_booking_key = hb.hotel_booking_id
    where b.stage = 'fct_hotel_bookings'
    group by b.hotel_key
),

bridge_rates as (
    select
        b.hotel_key as hotel_id,
        avg(rh.rate_per_night) as bridge_avg_rate
    from {{ ref('bridge_unified') }} as b
    inner join {{ ref('stg_hotel_rate_history') }} as rh
        on b.rate_key = rh.rate_id
    where b.stage = 'stg_hotel_rate_history'
    group by b.hotel_key
),

bridge_result as (
    select
        coalesce(bb.hotel_id, br.hotel_id) as hotel_id,
        bb.bridge_booking_total,
        br.bridge_avg_rate
    from bridge_bookings as bb
    full outer join bridge_rates as br
        on bb.hotel_id = br.hotel_id
)

select
    ground_truth.hotel_id,
    ground_truth.ground_truth_booking_total,
    ground_truth.ground_truth_avg_rate,
    ground_truth.ground_truth_booking_count,
    ground_truth.ground_truth_rate_count,
    traditional.traditional_booking_total,
    traditional.traditional_avg_rate,
    bridge_result.bridge_booking_total,
    bridge_result.bridge_avg_rate,
    traditional.traditional_booking_total
        != ground_truth.ground_truth_booking_total as has_fan_trap,
    bridge_result.bridge_booking_total
        = ground_truth.ground_truth_booking_total as bridge_is_correct
from ground_truth
left join traditional
    on ground_truth.hotel_id = traditional.hotel_id
left join bridge_result
    on ground_truth.hotel_id = bridge_result.hotel_id
where ground_truth.ground_truth_booking_total is not null
order by ground_truth.hotel_id
