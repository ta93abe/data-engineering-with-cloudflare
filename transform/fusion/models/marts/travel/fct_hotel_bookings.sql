with hotel_bookings as (
    select * from {{ ref('stg_hotel_bookings') }}
)

select
    hotel_booking_id,
    traveler_id,
    hotel_id,
    check_in,
    check_out,
    hotel_amount
from hotel_bookings
