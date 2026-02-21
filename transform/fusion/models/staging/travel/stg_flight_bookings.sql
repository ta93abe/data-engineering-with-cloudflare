with source as (
    select * from {{ ref('raw_flight_bookings') }}
),

renamed as (
    select
        flight_booking_id,
        traveler_id,
        airline_id,
        origin_id,
        destination_id,
        cast(booking_date as date) as booking_date,
        amount as flight_amount
    from source
)

select * from renamed
