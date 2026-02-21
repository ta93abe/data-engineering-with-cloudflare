-- Chasm Trap comparison: per-traveler flight + hotel totals
-- traditional_total will be WRONG (inflated) for travelers with multiple bookings in both facts
-- bridge_total and ground_truth will match

with

-- Ground truth: aggregate each fact independently, then join
flight_totals as (
    select
        traveler_id,
        sum(flight_amount) as total_flight_amount
    from {{ ref('fct_flight_bookings') }}
    group by traveler_id
),

hotel_totals as (
    select
        traveler_id,
        sum(hotel_amount) as total_hotel_amount
    from {{ ref('fct_hotel_bookings') }}
    group by traveler_id
),

ground_truth as (
    select
        coalesce(f.traveler_id, h.traveler_id) as traveler_id,
        coalesce(f.total_flight_amount, 0) as ground_truth_flight,
        coalesce(h.total_hotel_amount, 0) as ground_truth_hotel,
        coalesce(f.total_flight_amount, 0)
            + coalesce(h.total_hotel_amount, 0) as ground_truth_total
    from flight_totals as f
    full outer join hotel_totals as h
        on f.traveler_id = h.traveler_id
),

-- Traditional (naive) JOIN: traveler -> flights -> hotels causes cross-product
traditional as (
    select
        t.traveler_id,
        sum(fb.flight_amount) as traditional_flight,
        sum(hb.hotel_amount) as traditional_hotel,
        coalesce(sum(fb.flight_amount), 0)
            + coalesce(sum(hb.hotel_amount), 0) as traditional_total
    from {{ ref('dim_traveler') }} as t
    left join {{ ref('fct_flight_bookings') }} as fb
        on t.traveler_id = fb.traveler_id
    left join {{ ref('fct_hotel_bookings') }} as hb
        on t.traveler_id = hb.traveler_id
    group by t.traveler_id
),

-- Bridge: join each fact through bridge keys (no cross-product)
bridge_flights as (
    select
        b.traveler_key as traveler_id,
        sum(fb.flight_amount) as bridge_flight_amount
    from {{ ref('bridge_unified') }} as b
    inner join {{ ref('fct_flight_bookings') }} as fb
        on b.flight_booking_key = fb.flight_booking_id
    where b.stage = 'fct_flight_bookings'
    group by b.traveler_key
),

bridge_hotels as (
    select
        b.traveler_key as traveler_id,
        sum(hb.hotel_amount) as bridge_hotel_amount
    from {{ ref('bridge_unified') }} as b
    inner join {{ ref('fct_hotel_bookings') }} as hb
        on b.hotel_booking_key = hb.hotel_booking_id
    where b.stage = 'fct_hotel_bookings'
    group by b.traveler_key
),

bridge_result as (
    select
        coalesce(bf.traveler_id, bh.traveler_id) as traveler_id,
        coalesce(bf.bridge_flight_amount, 0) as bridge_flight,
        coalesce(bh.bridge_hotel_amount, 0) as bridge_hotel,
        coalesce(bf.bridge_flight_amount, 0)
            + coalesce(bh.bridge_hotel_amount, 0) as bridge_total
    from bridge_flights as bf
    full outer join bridge_hotels as bh
        on bf.traveler_id = bh.traveler_id
)

select
    ground_truth.traveler_id,
    ground_truth.ground_truth_flight,
    ground_truth.ground_truth_hotel,
    ground_truth.ground_truth_total,
    traditional.traditional_flight,
    traditional.traditional_hotel,
    traditional.traditional_total,
    bridge_result.bridge_flight,
    bridge_result.bridge_hotel,
    bridge_result.bridge_total,
    traditional.traditional_total != ground_truth.ground_truth_total as has_chasm_trap,
    bridge_result.bridge_total = ground_truth.ground_truth_total as bridge_is_correct
from ground_truth
left join traditional
    on ground_truth.traveler_id = traditional.traveler_id
left join bridge_result
    on ground_truth.traveler_id = bridge_result.traveler_id
order by ground_truth.traveler_id
