-- Test: All non-null keys in bridge_unified reference valid PKs in their source tables
-- Returns rows with orphaned keys (should return 0 rows)

with bridge as (
    select * from {{ ref('bridge_unified') }}
),

invalid_traveler_keys as (
    select b.traveler_key
    from bridge as b
    left join {{ ref('dim_traveler') }} as t
        on b.traveler_key = t.traveler_id
    where b.traveler_key is not null
        and t.traveler_id is null
),

invalid_destination_keys as (
    select b.destination_key
    from bridge as b
    left join {{ ref('dim_destination') }} as d
        on b.destination_key = d.destination_id
    where b.destination_key is not null
        and d.destination_id is null
),

invalid_airline_keys as (
    select b.airline_key
    from bridge as b
    left join {{ ref('dim_airline') }} as a
        on b.airline_key = a.airline_id
    where b.airline_key is not null
        and a.airline_id is null
),

invalid_hotel_keys as (
    select b.hotel_key
    from bridge as b
    left join {{ ref('dim_hotel') }} as h
        on b.hotel_key = h.hotel_id
    where b.hotel_key is not null
        and h.hotel_id is null
),

invalid_flight_booking_keys as (
    select b.flight_booking_key
    from bridge as b
    left join {{ ref('fct_flight_bookings') }} as fb
        on b.flight_booking_key = fb.flight_booking_id
    where b.flight_booking_key is not null
        and fb.flight_booking_id is null
),

invalid_hotel_booking_keys as (
    select b.hotel_booking_key
    from bridge as b
    left join {{ ref('fct_hotel_bookings') }} as hb
        on b.hotel_booking_key = hb.hotel_booking_id
    where b.hotel_booking_key is not null
        and hb.hotel_booking_id is null
),

invalid_rate_keys as (
    select b.rate_key
    from bridge as b
    left join {{ ref('stg_hotel_rate_history') }} as rh
        on b.rate_key = rh.rate_id
    where b.rate_key is not null
        and rh.rate_id is null
)

select 'traveler' as key_type, traveler_key as invalid_key
from invalid_traveler_keys
union all
select 'destination', destination_key
from invalid_destination_keys
union all
select 'airline', airline_key
from invalid_airline_keys
union all
select 'hotel', hotel_key
from invalid_hotel_keys
union all
select 'flight_booking', flight_booking_key
from invalid_flight_booking_keys
union all
select 'hotel_booking', hotel_booking_key
from invalid_hotel_booking_keys
union all
select 'rate', rate_key
from invalid_rate_keys
