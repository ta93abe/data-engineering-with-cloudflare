with flight_bookings as (
    select * from {{ ref('stg_flight_bookings') }}
)

select
    flight_booking_id,
    traveler_id,
    airline_id,
    origin_id,
    destination_id,
    booking_date,
    flight_amount
from flight_bookings
