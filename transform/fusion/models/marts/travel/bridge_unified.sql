-- Puppini Bridge (Unified Star Schema)
-- Each row carries only the PKs relevant to its source table; all other keys are NULL.
-- This ensures every JOIN through the bridge is many-to-one, eliminating Fan and Chasm Traps.

select
    'dim_traveler' as stage,
    traveler_id as traveler_key,
    cast(null as string) as destination_key,
    cast(null as string) as airline_key,
    cast(null as string) as hotel_key,
    cast(null as string) as flight_booking_key,
    cast(null as string) as hotel_booking_key,
    cast(null as string) as rate_key
from {{ ref('dim_traveler') }}

union all

select
    'dim_destination' as stage,
    cast(null as string) as traveler_key,
    destination_id as destination_key,
    cast(null as string) as airline_key,
    cast(null as string) as hotel_key,
    cast(null as string) as flight_booking_key,
    cast(null as string) as hotel_booking_key,
    cast(null as string) as rate_key
from {{ ref('dim_destination') }}

union all

select
    'dim_airline' as stage,
    cast(null as string) as traveler_key,
    cast(null as string) as destination_key,
    airline_id as airline_key,
    cast(null as string) as hotel_key,
    cast(null as string) as flight_booking_key,
    cast(null as string) as hotel_booking_key,
    cast(null as string) as rate_key
from {{ ref('dim_airline') }}

union all

select
    'dim_hotel' as stage,
    cast(null as string) as traveler_key,
    destination_id as destination_key,
    cast(null as string) as airline_key,
    hotel_id as hotel_key,
    cast(null as string) as flight_booking_key,
    cast(null as string) as hotel_booking_key,
    cast(null as string) as rate_key
from {{ ref('dim_hotel') }}

union all

select
    'fct_flight_bookings' as stage,
    traveler_id as traveler_key,
    destination_id as destination_key,
    airline_id as airline_key,
    cast(null as string) as hotel_key,
    flight_booking_id as flight_booking_key,
    cast(null as string) as hotel_booking_key,
    cast(null as string) as rate_key
from {{ ref('fct_flight_bookings') }}

union all

select
    'fct_hotel_bookings' as stage,
    traveler_id as traveler_key,
    cast(null as string) as destination_key,
    cast(null as string) as airline_key,
    hotel_id as hotel_key,
    cast(null as string) as flight_booking_key,
    hotel_booking_id as hotel_booking_key,
    cast(null as string) as rate_key
from {{ ref('fct_hotel_bookings') }}

union all

select
    'stg_hotel_rate_history' as stage,
    cast(null as string) as traveler_key,
    cast(null as string) as destination_key,
    cast(null as string) as airline_key,
    hotel_id as hotel_key,
    cast(null as string) as flight_booking_key,
    cast(null as string) as hotel_booking_key,
    rate_id as rate_key
from {{ ref('stg_hotel_rate_history') }}
